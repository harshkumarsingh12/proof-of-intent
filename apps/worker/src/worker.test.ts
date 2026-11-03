import { beforeAll, describe, expect, test } from "vitest";
import { compliantCart, greyJacketIntent, NOW } from "@poi/contracts/fixtures";
import { ledger } from "@poi/ledger";
import {
  customId,
  generateSigningKeyPair,
  mandateHash,
  signMandate,
  type VerifyKey,
} from "@poi/mandates";
import {
  buildEvidencePackage,
  InMemoryEvidenceDataLoader,
  recommend,
  setDefaultEvidenceDataLoader,
  setDefaultKeyResolver,
  type CaptureRecord,
} from "./pipeline";

describe("dispute copilot (unbuilt)", () => {
  let expectedHash: string;
  let expectedCustomId: string;

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateSigningKeyPair();
    const keyMap = new Map<string, VerifyKey>([["shopper-key-1", publicKey]]);
    const signedIntentJws = await signMandate(greyJacketIntent, privateKey, "shopper-key-1");
    expectedHash = mandateHash(greyJacketIntent);
    expectedCustomId = customId(greyJacketIntent.mandate_id, expectedHash);

    const captureRecord: CaptureRecord = {
      captureId: "cap_compliant",
      orderId: "ord_compliant",
      capturedAt: NOW,
      amount: compliantCart.contents.total,
      customId: expectedCustomId,
    };

    const loader = new InMemoryEvidenceDataLoader(
      [
        {
          disputeId: "fixture-compliant",
          orderId: "ord_compliant",
          status: "WAITING_FOR_SELLER_RESPONSE",
          reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        },
      ],
      [
        {
          orderId: "ord_compliant",
          customId: expectedCustomId,
          intent: greyJacketIntent,
          cart: compliantCart,
          signedIntentJws,
          capturedAt: NOW,
          captureRecord,
        },
      ],
      [captureRecord],
    );

    setDefaultEvidenceDataLoader(loader);
    setDefaultKeyResolver(async (kid: string) => keyMap.get(kid));
  });

  ledger("M2", "hoursgotviral-dev", "a dispute on the overreaching fixture order is AGENT_OVERREACH → accept", async () => {
    const rec = await recommend("fixture-overreach");
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
  });

  ledger("M2", "hoursgotviral-dev", "a dispute on the compliant fixture order is MANDATE_COMPLIANT → evidence", async () => {
    const rec = await recommend("fixture-compliant");
    expect(rec.class).toBe("MANDATE_COMPLIANT");
  });

  test("evidence package PDF carries the same hash as the PayPal custom_id", async () => {
    const pkg = await buildEvidencePackage("fixture-compliant");
    const pdfText = new TextDecoder().decode(pkg.pdf);
    expect(pdfText).toContain(expectedHash);
    const hashPrefix = expectedCustomId.split(":")[2];
    expect(hashPrefix).toBeTruthy();
    expect(expectedHash.slice(0, 16)).toBe(hashPrefix);
    expect(pdfText).toContain(expectedCustomId);
  });
});
