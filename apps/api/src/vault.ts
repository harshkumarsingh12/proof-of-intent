/**
 * Saving a shopper's PayPal wallet with Vault v3 (docs/specs/0004 §Vault, #17), the prerequisite for agent-alone
 * checkout. Two steps, each proven with a short-lived signature from the key that signs the shopper's Intent Mandates:
 *
 *   setup  the shopper's browser asks; we make a MERCHANT setup token at PayPal and remember whose it is; the
 *          shopper approves on PayPal and PayPal sends them back with `approval_token_id`
 *   save   the browser names that setup token; we claim it (once, for that shopper only), turn it into the payment
 *          token and store its id as the shopper's `vault_id`
 *
 * Without the proof, anyone who knew a shopper key id could point that shopper at a wallet of their choosing.
 */
import {
  ShopperProof,
  type ReasonCode,
  type VaultRemoveResponse,
  type VaultSaveResponse,
  type VaultSetupResponse,
} from "@poi/contracts";
import type { Db, KeyRecord } from "@poi/db";
import { keyValidAt, verifyMandate } from "@poi/mandates";
import { PayPalError, type PayPalClient } from "@poi/paypal";
import { importJWK, type JWK } from "jose";

export interface VaultDeps {
  db: Db;
  paypal: PayPalClient;
  now: () => string;
  /** The buyer app's origin: PayPal sends the shopper back to `${buyerBase}/shop/wallet`. */
  buyerBase: string;
}

/** A proof is good for five minutes, and one stamped more than a minute ahead of our clock is refused. */
export const PROOF_MAX_AGE_MS = 5 * 60 * 1000;
export const PROOF_MAX_SKEW_MS = 60 * 1000;

export type Failure = {
  status: 403 | 404 | 409 | 502 | 503;
  body: { error: string; message: string; reasons?: ReasonCode[]; issue?: string };
};
export type VaultSetupResult = { status: 200; body: VaultSetupResponse } | Failure;
export type VaultSaveResult = { status: 200; body: VaultSaveResponse } | Failure;
export type VaultRemoveResult = { status: 200; body: VaultRemoveResponse } | Failure;
export type VaultStatusResult = { status: 200; body: { wallet: boolean } } | Failure;

export type Shopper = KeyRecord & { shopperId: string };

/** The shopper behind a valid, fresh proof for `purpose`, or the failure to send back. */
export async function checkProof(
  jws: string,
  purpose: ShopperProof["purpose"],
  deps: Pick<VaultDeps, "db" | "now">,
): Promise<{ shopper: Shopper; proof: ShopperProof } | Failure> {
  const now = deps.now();
  const invalid = (reasons: ReasonCode[], message = "The proof was not signed by a registered shopper key") =>
    ({ status: 403, body: { error: "proof_invalid", message, reasons } }) satisfies Failure;

  let key: KeyRecord | null = null;
  const sig = await verifyMandate(jws, async (kid) => {
    key = await deps.db.findKey("shopper", kid);
    return key ? (importJWK(key.publicJwk as unknown as JWK, "ES256") as Promise<CryptoKey>) : undefined;
  });
  if (!sig.ok) return invalid([sig.reason]);
  const shopper = key as KeyRecord | null;
  if (!shopper?.shopperId || !keyValidAt(shopper, now)) return invalid(["UNKNOWN_KEY"]);

  const proof = ShopperProof.safeParse(sig.payload);
  if (!proof.success) return invalid(["SCHEMA_INVALID"]);
  if (proof.data.purpose !== purpose)
    return invalid(["MANDATE_MISMATCH"], "The proof was signed for something else");

  const age = Date.parse(now) - Date.parse(proof.data.issued_at);
  if (age > PROOF_MAX_AGE_MS || age < -PROOF_MAX_SKEW_MS) {
    return {
      status: 403,
      body: { error: "proof_expired", message: "The proof is too old (or from the future); sign a new one" },
    };
  }
  return { shopper: shopper as Shopper, proof: proof.data };
}

export const isFailure = (r: object): r is Failure => "status" in r;

/** PayPal said no (4xx) or couldn't be reached; the same answers the dispute and checkout routes give. */
function paypalFailure(err: unknown): Failure {
  if (err instanceof PayPalError && err.status < 500) {
    return {
      status: 409,
      body: { error: "paypal_refused", message: `PayPal refused: ${err.issue}`, issue: err.issue },
    };
  }
  return {
    status: 503,
    body: { error: "paypal_unavailable", message: "PayPal did not answer; try again in a moment" },
  };
}

export async function startWalletSetup(proofJws: string, deps: VaultDeps): Promise<VaultSetupResult> {
  const checked = await checkProof(proofJws, "vault.setup", deps);
  if (isFailure(checked)) return checked;
  const { shopper } = checked;

  const base = deps.buyerBase.replace(/\/+$/, "");
  let setup;
  try {
    setup = await deps.paypal.createVaultSetupToken({
      returnUrl: `${base}/shop/wallet`,
      cancelUrl: `${base}/shop`,
    });
  } catch (err) {
    await deps.db.appendAudit({
      actor: `shopper:${shopper.shopperId}`,
      action: "vault.setup.failed",
      subjectId: shopper.shopperId,
      requestBody: { message: (err as Error).message },
    });
    return paypalFailure(err);
  }
  await deps.db.createVaultSetup(setup.setupTokenId, shopper.shopperId);
  await deps.db.appendAudit({
    actor: `shopper:${shopper.shopperId}`,
    action: "vault.setup",
    subjectId: shopper.shopperId,
    requestBody: { setupTokenId: setup.setupTokenId },
  });
  return { status: 200, body: { setup_token_id: setup.setupTokenId, approval_url: setup.approvalUrl } };
}

export async function saveWallet(
  setupTokenId: string,
  proofJws: string,
  deps: VaultDeps,
): Promise<VaultSaveResult> {
  const checked = await checkProof(proofJws, "vault.save", deps);
  if (isFailure(checked)) return checked;
  const { shopper, proof } = checked;
  if (proof.purpose !== "vault.save" || proof.setup_token_id !== setupTokenId) {
    return {
      status: 403,
      body: {
        error: "proof_invalid",
        message: "The proof names a different setup token",
        reasons: ["MANDATE_MISMATCH"],
      },
    };
  }

  // Exactly one request gets to turn this setup token into a payment token, and only for the shopper it was made for.
  if (!(await deps.db.claimVaultSetup(setupTokenId, shopper.shopperId))) {
    return {
      status: 409,
      body: {
        error: "setup_not_available",
        message: "This wallet setup is unknown, not yours, or already used",
      },
    };
  }
  let vaultId: string;
  try {
    ({ vaultId } = await deps.paypal.createVaultPaymentToken(setupTokenId));
  } catch (err) {
    // Typically "not approved yet": give the setup token back so the shopper can approve and try again.
    await deps.db.releaseVaultSetup(setupTokenId);
    await deps.db.appendAudit({
      actor: `shopper:${shopper.shopperId}`,
      action: "vault.save.failed",
      subjectId: shopper.shopperId,
      requestBody: { setupTokenId, message: (err as Error).message },
    });
    return paypalFailure(err);
  }
  // The audit row first: if saving the id fails after PayPal made the token, the id is still on record.
  await deps.db.appendAudit({
    actor: `shopper:${shopper.shopperId}`,
    action: "vault.saved",
    subjectId: shopper.shopperId,
    requestBody: { setupTokenId, vaultId },
  });
  await deps.db.saveVaultId(shopper.shopperId, vaultId);
  return { status: 200, body: { wallet: true } };
}

/**
 * Forgets the shopper's saved wallet. Our side goes first: the moment this answers, agent-alone checkout can no
 * longer charge, whatever PayPal does next. Then the payment token is revoked at PayPal, unless another shopper row
 * (the same PayPal wallet saved from a new browser key) still holds it; if the revoke fails the token lingers there
 * unused, and the audit row keeps its id so it can be revoked later. Asking again is harmless.
 */
export async function removeWallet(proofJws: string, deps: VaultDeps): Promise<VaultRemoveResult> {
  const checked = await checkProof(proofJws, "vault.remove", deps);
  if (isFailure(checked)) return checked;
  const { shopper } = checked;
  const actor = `shopper:${shopper.shopperId}`;
  const vaultId = shopper.vaultId;
  if (!vaultId) return { status: 200, body: { wallet: false } };

  await deps.db.clearVaultId(shopper.shopperId);
  await deps.db.appendAudit({
    actor,
    action: "vault.removed",
    subjectId: shopper.shopperId,
    requestBody: { vaultId },
  });
  // PayPal gives the same payment token to the same PayPal account, so another browser key of this shopper may hold
  // it too. Revoking it then would break that key's wallet: only the last holder's removal revokes it.
  if ((await deps.db.countVaultHolders(vaultId)) > 0) return { status: 200, body: { wallet: false } };
  try {
    await deps.paypal.deletePaymentToken(vaultId);
  } catch (err) {
    await deps.db.appendAudit({
      actor: "api",
      action: "vault.revoke.failed",
      subjectId: shopper.shopperId,
      requestBody: { vaultId, message: (err as Error).message },
    });
  }
  return { status: 200, body: { wallet: false } };
}

/** Whether this shopper key has a wallet. A yes/no only: the vault id never leaves the server. */
export async function walletStatus(kid: string, deps: Pick<VaultDeps, "db">): Promise<VaultStatusResult> {
  const key = await deps.db.findKey("shopper", kid);
  if (!key) return { status: 404, body: { error: "key_not_found", message: "Unknown shopper key" } };
  return { status: 200, body: { wallet: Boolean(key.vaultId) } };
}
