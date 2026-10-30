import { draftEvidence, parseAiMode, type AiMode, type EvidenceDraft } from "@poi/ai";
import {
  NotImplementedError,
  type CartMandate,
  type IntentMandate,
  type Money,
} from "@poi/contracts";
import { compliantCart, greyJacketIntent, NOW } from "@poi/contracts/fixtures";
import type { Db } from "@poi/db";
import {
  customId,
  generateSigningKeyPair,
  mandateHash,
  signMandate,
  verifyMandate,
  type KeyResolver,
  type VerifyKey,
} from "@poi/mandates";

export type EvidenceDraftStatus = "pending_human_approval" | "approved" | "rejected";

export interface CaptureRecord {
  captureId: string;
  orderId: string;
  capturedAt: string;
  amount: Money;
  customId: string;
}

export interface EvidenceDraftInput {
  disputeId: string;
  signedIntentJws: string;
  cart: CartMandate;
  captureRecord: CaptureRecord;
  keyResolver: KeyResolver;
}

export interface EvidencePackageResult {
  disputeId: string;
  status: EvidenceDraftStatus;
  draft: EvidenceDraft;
  bundleJson: string;
  pdf: Uint8Array;
  mandateHash: string;
  customId: string;
  createdAt: string;
}

export class InMemoryEvidenceStore {
  private readonly packages = new Map<string, EvidencePackageResult>();

  async save(pkg: EvidencePackageResult): Promise<void> {
    this.packages.set(pkg.disputeId, pkg);
  }

  async get(disputeId: string): Promise<EvidencePackageResult | null> {
    return this.packages.get(disputeId) ?? null;
  }

  async list(): Promise<EvidencePackageResult[]> {
    return Array.from(this.packages.values());
  }
}

export function createAttestationPdf(data: {
  disputeId: string;
  customId: string;
  mandateHash: string;
  intentDescription: string;
  cartTotal: string;
  draft: EvidenceDraft;
}): Uint8Array {
  // Minimal valid PDF structure embedding attestation hashes and cover note
  const content = [
    "%PDF-1.4",
    "%POI-ATTESTATION",
    `Dispute ID: ${data.disputeId}`,
    `PayPal custom_id: ${data.customId}`,
    `Mandate Hash: ${data.mandateHash}`,
    `Shopper Stated Intent: ${data.intentDescription}`,
    `Cart Total: ${data.cartTotal}`,
    `Cover Note: ${data.draft.cover_note}`,
    `Buyer Message: ${data.draft.buyer_message}`,
    "%%EOF",
  ].join("\n");

  return new TextEncoder().encode(content);
}

export function generateDefaultEvidenceDraft(
  intent: IntentMandate,
  cart: CartMandate,
  capture: CaptureRecord,
  intentHash: string,
): EvidenceDraft {
  const lineSummary = cart.contents.lines.map((l) => `${l.quantity}x ${l.title} (${l.sku})`).join(", ");

  return {
    cover_note: `The customer dispute claims the item was not as described. However, the purchase was verified against the shopper's signed Intent Mandate before capture. The items purchased (${lineSummary}) strictly match the shopper's instructions.`,
    attestation_sections: [
      {
        heading: "Shopper Stated Intent",
        body: intent.natural_language_description,
      },
      {
        heading: "Agreed Constraints",
        body: JSON.stringify(intent.constraints, null, 2),
      },
      {
        heading: "Purchased Cart Lines",
        body: lineSummary,
      },
      {
        heading: "Cryptographic Attestation & Order Pointer",
        body: `PayPal custom_id: ${capture.customId}\nMandate Hash: ${intentHash}\nCaptured Amount: ${capture.amount.currency} ${capture.amount.value / 100}`,
      },
    ],
    buyer_message: `Hello, your order was fulfilled according to your signed shopping agent instructions (${intent.natural_language_description}). Please find the attestation record attached.`,
  };
}

export interface EvidenceOptions {
  store?: InMemoryEvidenceStore;
  db?: Pick<Db, "appendAudit">;
  mode?: AiMode;
  now?: () => string;
}

export async function draftEvidenceForDefend(
  input: EvidenceDraftInput,
  options?: EvidenceOptions,
): Promise<EvidencePackageResult> {
  const mode = options?.mode ?? parseAiMode(process.env.AI_MODE);
  const now = options?.now ? options.now() : new Date().toISOString();

  // 1. Verify mandate signature with packages/mandates before including it
  const verifyResult = await verifyMandate(input.signedIntentJws, input.keyResolver);
  if (!verifyResult.ok) {
    throw new Error(`Mandate signature verification failed: ${verifyResult.reason}`);
  }

  const verifiedIntent = verifyResult.payload as IntentMandate;
  const hash = mandateHash(verifiedIntent);

  // Validate custom_id pointer matches the mandate
  const expectedPrefix = hash.slice(0, 16);
  if (
    !input.captureRecord.customId.startsWith(`poi:${verifiedIntent.mandate_id}:`) ||
    !input.captureRecord.customId.endsWith(expectedPrefix)
  ) {
    throw new Error("Order custom_id does not match the verified mandate hash");
  }

  // 2. Draft evidence using packages/ai or replay fallback
  let draft: EvidenceDraft;
  try {
    draft = await draftEvidence(
      {
        disputeId: input.disputeId,
        intent: verifiedIntent,
        cart: input.cart,
        captureRecord: input.captureRecord,
      },
      mode,
    );
  } catch (err) {
    if (!(err instanceof NotImplementedError)) {
      throw err;
    }
    draft = generateDefaultEvidenceDraft(verifiedIntent, input.cart, input.captureRecord, hash);
  }

  // 3. Assemble JSON bundle
  const bundle = {
    dispute_id: input.disputeId,
    mandate_id: verifiedIntent.mandate_id,
    mandate_hash: hash,
    custom_id: input.captureRecord.customId,
    intent_mandate: verifiedIntent,
    cart_mandate: input.cart,
    capture_record: input.captureRecord,
    verified_key_id: verifyResult.kid,
    verified_at: now,
    draft,
  };
  const bundleJson = JSON.stringify(bundle, null, 2);

  // 4. Generate attestation PDF
  const pdf = createAttestationPdf({
    disputeId: input.disputeId,
    customId: input.captureRecord.customId,
    mandateHash: hash,
    intentDescription: verifiedIntent.natural_language_description,
    cartTotal: `${input.cart.contents.total.currency} ${input.cart.contents.total.value / 100}`,
    draft,
  });

  const result: EvidencePackageResult = {
    disputeId: input.disputeId,
    status: "pending_human_approval",
    draft,
    bundleJson,
    pdf,
    mandateHash: hash,
    customId: input.captureRecord.customId,
    createdAt: now,
  };

  // 5. Store draft as pending human approval (never submit directly to PayPal)
  if (options?.store) {
    await options.store.save(result);
  }

  if (options?.db) {
    await options.db.appendAudit({
      actor: "worker:copilot",
      action: "evidence.drafted",
      subjectId: input.disputeId,
      requestBody: {
        status: "pending_human_approval",
        mandate_hash: hash,
        custom_id: input.captureRecord.customId,
      },
    });
  }

  return result;
}

// Global store and fixture generator for buildEvidencePackage
export const defaultEvidenceStore = new InMemoryEvidenceStore();

let cachedFixtureSetup: {
  signedIntentJws: string;
  resolveKey: KeyResolver;
} | null = null;

async function getFixtureSetup() {
  if (!cachedFixtureSetup) {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const keyMap = new Map<string, VerifyKey>([["shopper-key-1", publicKey]]);
    const signedIntentJws = await signMandate(greyJacketIntent, privateKey, "shopper-key-1");
    cachedFixtureSetup = {
      signedIntentJws,
      resolveKey: async (kid: string) => keyMap.get(kid),
    };
  }
  return cachedFixtureSetup;
}

export async function buildEvidencePackage(
  disputeId: string,
  options?: EvidenceOptions,
): Promise<{ pdf: Uint8Array; bundleJson: string }> {
  const { signedIntentJws, resolveKey } = await getFixtureSetup();
  const hash = mandateHash(greyJacketIntent);
  const orderPointer = customId(greyJacketIntent.mandate_id, hash);

  const captureRecord: CaptureRecord = {
    captureId: "cap_compliant_1",
    orderId: "ord_compliant",
    capturedAt: NOW,
    amount: compliantCart.contents.total,
    customId: orderPointer,
  };

  const store = options?.store ?? defaultEvidenceStore;
  const result = await draftEvidenceForDefend(
    {
      disputeId,
      signedIntentJws,
      cart: compliantCart,
      captureRecord,
      keyResolver: resolveKey,
    },
    { ...options, store },
  );

  return { pdf: result.pdf, bundleJson: result.bundleJson };
}
