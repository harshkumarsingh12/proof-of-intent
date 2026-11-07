/**
 * Saving a PayPal wallet from the shop (docs/specs/0004 §Vault, #17). The merchant only acts on a proof signed by
 * the key this browser holds, so the page signs one for each of the two steps and PayPal does the approving.
 */
import type { VaultProof } from "@poi/contracts";

/** What PayPal puts on the return URL is untrusted text: only an id-shaped value is passed on. */
export const isSetupTokenId = (id: string): boolean => /^[A-Za-z0-9_-]{6,128}$/.test(id);

/** The setup token PayPal sends the shopper back with (`approval_token_id`), or undefined if it isn't one. */
export function setupTokenFromQuery(search: string): string | undefined {
  const id = new URLSearchParams(search).get("approval_token_id");
  return id !== null && isSetupTokenId(id) ? id : undefined;
}

export const setupProof = (now: Date): VaultProof => ({
  purpose: "vault.setup",
  issued_at: now.toISOString(),
});

export const saveProof = (setupTokenId: string, now: Date): VaultProof => ({
  purpose: "vault.save",
  setup_token_id: setupTokenId,
  issued_at: now.toISOString(),
});

/** A shopper key id: `shp_` plus the key's thumbprint. Checked before it goes into a URL. */
export const isShopperKid = (kid: string): boolean => /^shp_[A-Za-z0-9_-]{20,100}$/.test(kid);

export const removeProof = (now: Date): VaultProof => ({
  purpose: "vault.remove",
  issued_at: now.toISOString(),
});
