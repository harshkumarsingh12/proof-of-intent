import { describe, expect, it } from "vitest";
import { compliantCart, greyJacketIntent, NOW } from "@poi/contracts/fixtures";
import type { AuditEntry } from "@poi/db";
import {
  customId,
  generateSigningKeyPair,
  mandateHash,
  signMandate,
  type VerifyKey,
} from "@poi/mandates";
import {
  buildEvidencePackage,
  draftEvidenceForDefend,
  InMemoryEvidenceStore,
  type CaptureRecord,
  type EvidenceDraftInput,
} from "./evidence";

describe("evidence drafting for defend disputes", () => {
  async function setupKeysAndMandate() {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const keyMap = new Map<string, VerifyKey>([["shopper-key-1", publicKey]]);
    const signedIntentJws = await signMandate(greyJacketIntent, privateKey, "shopper-key-1");
    const hash = mandateHash(greyJacketIntent);
    const orderPointer = customId(greyJacketIntent.mandate_id, hash);

    const captureRecord: CaptureRecord = {
      captureId: "cap_1001",
      orderId: "ord_1001",
      capturedAt: NOW,
      amount: compliantCart.contents.total,
      customId: orderPointer,
    };

    const keyResolver = async (kid: string) => keyMap.get(kid);

    return { signedIntentJws, captureRecord, keyResolver, hash, orderPointer, privateKey };
  }

  it("verifies mandate signature and drafts evidence as pending human approval", async () => {
    const { signedIntentJws, captureRecord, keyResolver, hash, orderPointer } =
      await setupKeysAndMandate();

    const store = new InMemoryEvidenceStore();
    const auditLogs: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditLogs.push(entry);
      },
    };

    const input: EvidenceDraftInput = {
      disputeId: "PP-D-1001",
      signedIntentJws,
      cart: compliantCart,
      captureRecord,
      keyResolver,
    };

    const res = await draftEvidenceForDefend(input, { store, db });

    expect(res.status).toBe("pending_human_approval");
    expect(res.disputeId).toBe("PP-D-1001");
    expect(res.mandateHash).toBe(hash);
    expect(res.customId).toBe(orderPointer);
    expect(res.bundleJson).toContain(hash);
    expect(res.draft.cover_note.length).toBeGreaterThan(20);
    expect(res.draft.attestation_sections.length).toBeGreaterThan(0);

    const saved = await store.get("PP-D-1001");
    expect(saved?.status).toBe("pending_human_approval");

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("evidence.drafted");
    expect(auditLogs[0]?.subjectId).toBe("PP-D-1001");
  });

  it("fails verification when mandate signature is invalid or tampered", async () => {
    const { signedIntentJws, captureRecord, keyResolver } = await setupKeysAndMandate();

    const [header, , sig] = signedIntentJws.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...greyJacketIntent, natural_language_description: "tampered text" }),
    ).toString("base64url");
    const forgedJws = `${header}.${tamperedPayload}.${sig}`;

    const input: EvidenceDraftInput = {
      disputeId: "PP-D-1002",
      signedIntentJws: forgedJws,
      cart: compliantCart,
      captureRecord,
      keyResolver,
    };

    await expect(draftEvidenceForDefend(input)).rejects.toThrow(
      "Mandate signature verification failed: SIGNATURE_INVALID",
    );
  });

  it("fails when order custom_id does not match the verified mandate hash", async () => {
    const { signedIntentJws, captureRecord, keyResolver } = await setupKeysAndMandate();

    const mismatchedCapture: CaptureRecord = {
      ...captureRecord,
      customId: `poi:${greyJacketIntent.mandate_id}:deadbeef00000000`,
    };

    const input: EvidenceDraftInput = {
      disputeId: "PP-D-1003",
      signedIntentJws,
      cart: compliantCart,
      captureRecord: mismatchedCapture,
      keyResolver,
    };

    await expect(draftEvidenceForDefend(input)).rejects.toThrow(
      "Order custom_id does not match the verified mandate hash",
    );
  });

  it("buildEvidencePackage fixture generates attestation PDF and bundle JSON with matching hashes", async () => {
    const pkg = await buildEvidencePackage("fixture-compliant");

    expect(pkg.bundleJson).toContain("mandate_hash");
    expect(pkg.bundleJson).toContain("custom_id");

    const pdfText = new TextDecoder().decode(pkg.pdf);
    expect(pdfText).toContain("%PDF-1.4");
    expect(pdfText).toContain("Mandate Hash:");
    expect(pdfText).toContain("PayPal custom_id:");
  });
});
