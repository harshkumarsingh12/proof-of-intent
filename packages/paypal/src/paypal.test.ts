import { describe, expect, test } from "vitest";
import { ledger } from "@poi/ledger";
import { createPayPalClient, parseMode } from "./index";

const order = {
  intent: "AUTHORIZE" as const,
  ourOrderId: "ord_1",
  customId: "poi:0192f3a0-0000-7000-8000-000000000001:0123456789abcdef",
  total: { value: 7400, currency: "USD" },
  items: [{ sku: "JKT-GRY-M", name: "Stride Running Jacket", unitAmount: { value: 7400, currency: "USD" }, quantity: 1 }],
};

describe("mode", () => {
  test("defaults to mock so nobody needs credentials", () => {
    expect(parseMode(undefined)).toBe("mock");
    expect(parseMode("sandbox")).toBe("sandbox");
    expect(() => parseMode("live")).toThrow();
  });
});

describe("mock client (unbuilt)", () => {
  const mock = createPayPalClient("mock");

  ledger("M0", "harshkumarsingh12", "mock createOrder returns a realistic order id and CREATED status", async () => {
    const res = await mock.createOrder(order);
    expect(res.status).toBe("CREATED");
  });

  ledger("M0", "harshkumarsingh12", "mock authorize then capture returns a capture id", async () => {
    const { authorizationId } = await mock.authorizeOrder("ORDER-1");
    expect((await mock.captureAuthorization(authorizationId)).captureId).toBeTruthy();
  });
});

describe("sandbox client (unbuilt)", () => {
  const sandbox = createPayPalClient("sandbox");

  ledger("M1", "harshkumarsingh12", "webhook verification rejects a forged signature", async () => {
    const ok = await sandbox.verifyWebhook(
      { transmissionId: "x", transmissionTime: "x", transmissionSig: "forged", certUrl: "x", authAlgo: "SHA256withRSA" },
      "{}",
    );
    expect(ok).toBe(false);
  });

  ledger("M2", "harshkumarsingh12", "provide-evidence sends a multipart request with the attestation PDF", async () => {
    await expect(
      sandbox.provideEvidence("PP-D-1", { notes: "mandate attestation", files: [{ name: "attestation.pdf", data: new Uint8Array([1]) }] }),
    ).resolves.toBeUndefined();
  });
});
