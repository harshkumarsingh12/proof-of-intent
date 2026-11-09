import { createHash, randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import { MERCHANT_ID, compliantCart, greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
import {
  canonicalJson,
  customId,
  generateSigningKeyPair,
  keyIdFor,
  mandateHash,
  signMandate,
} from "@poi/mandates";
import { POLICY_VERSION } from "@poi/policy-engine";
import { exportJWK } from "jose";
import { buildProofPackage, PROOF_SCHEMA_VERSION, verifyProofPackage, type ProofPackage } from "./index";

const PAID_AT = "2026-11-02T10:00:00.000Z"; // inside the fixtures' validity window

async function party(prefix: "shp" | "agt" | "merchant") {
  const { privateKey, publicKey } = await generateSigningKeyPair();
  const exported = await exportJWK(publicKey);
  const kid = prefix === "merchant" ? "merchant-test" : await keyIdFor(prefix, exported);
  return { privateKey, jwk: { ...exported } as Record<string, unknown>, kid };
}

/** A real signed purchase: the shopper's intent, the merchant's cart and the agent's payment, each signed by its own key. */
async function purchase(
  opts: {
    cart?: CartMandate;
    intent?: IntentMandate;
    humanPresent?: boolean;
    paymentOverrides?: Partial<PaymentMandate>;
  } = {},
) {
  const shopper = await party("shp");
  const agent = await party("agt");
  const merchant = await party("merchant");
  const intent = opts.intent ?? greyJacketIntent;
  const intentHash = mandateHash(intent);
  const cart: CartMandate = {
    ...(opts.cart ?? compliantCart),
    intent_mandate_id: intent.mandate_id,
    intent_mandate_hash: intentHash,
  };
  const payment: PaymentMandate = {
    payment_mandate_id: randomUUID(),
    cart_mandate_hash: mandateHash(cart),
    intent_mandate_hash: intentHash,
    agent_key_id: agent.kid,
    agent_platform: "Northstar",
    human_present: opts.humanPresent ?? true,
    timestamp: PAID_AT,
    ...opts.paymentOverrides,
  };
  const input = {
    createdAt: "2026-11-09T12:00:00.000Z",
    intentJws: await signMandate(intent, shopper.privateKey, shopper.kid),
    paymentJws: await signMandate(payment, agent.privateKey, agent.kid),
    cartJws: await signMandate(cart, merchant.privateKey, merchant.kid),
    keys: [
      { role: "shopper" as const, kid: shopper.kid, publicJwk: shopper.jwk },
      { role: "agent" as const, kid: agent.kid, publicJwk: agent.jwk, platform: "Northstar" },
      { role: "merchant" as const, kid: merchant.kid, publicJwk: merchant.jwk },
    ],
    references: {
      order_id: "ord_test",
      merchant_id: MERCHANT_ID,
      custom_id: customId(intent.mandate_id, intentHash),
      paypal_order_id: "PP-ORDER-1",
      capture_id: "CAP-1",
      order_status: "CAPTURED",
      agent_platform: "Northstar",
      human_present: payment.human_present,
    },
  };
  return { input, pkg: buildProofPackage(input), shopper, agent, merchant, intent, cart, payment };
}

/** What a careful forger would do after editing the file: recompute the manifest so it matches. The signatures are what stop them. */
const digest = (v: unknown) => createHash("sha256").update(canonicalJson(v), "utf8").digest("hex");
function reseal(pkg: ProofPackage): ProofPackage {
  const entries = {
    header: digest({ schema_version: pkg.schema_version, created_at: pkg.created_at }),
    mandates: digest(pkg.mandates),
    keys: digest(pkg.keys),
    references: digest(pkg.references),
    policy: digest(pkg.policy),
  };
  return { ...pkg, manifest: { algorithm: "sha256", entries, package_hash: digest(entries) } };
}

const byId = (report: Awaited<ReturnType<typeof verifyProofPackage>>) =>
  Object.fromEntries(report.checks.map((c) => [c.id, c]));
const failed = (report: Awaited<ReturnType<typeof verifyProofPackage>>) =>
  report.checks.filter((c) => !c.passed).map((c) => c.id);

describe("a genuine proof package", () => {
  test("verifies, and every check says why it passed", async () => {
    const { pkg } = await purchase();
    const report = await verifyProofPackage(pkg);
    expect(failed(report)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual([
      "package.schema",
      "manifest.integrity",
      "keys.kid_binding",
      "sig.intent",
      "sig.payment",
      "sig.cart",
      "schema.mandates",
      "bind.payment_intent",
      "bind.payment_cart",
      "bind.cart_intent",
      "bind.agent_key",
      "paypal.pointer",
      "policy.replay",
    ]);
    expect(report.checks.every((c) => c.detail.length > 0)).toBe(true);
  });

  test("still verifies after going through JSON, which is how it is exported and read back", async () => {
    const { pkg } = await purchase();
    const report = await verifyProofPackage(JSON.parse(JSON.stringify(pkg)));
    expect(report.ok).toBe(true);
  });

  test("records the schema version, the policy version, the three signed strings and the PayPal references", async () => {
    const { pkg, input } = await purchase();
    expect(pkg.schema_version).toBe(PROOF_SCHEMA_VERSION);
    expect(pkg.policy).toEqual({ version: POLICY_VERSION, engine: "@poi/policy-engine" });
    expect(pkg.mandates.intent.jws).toBe(input.intentJws);
    expect(pkg.mandates.payment.jws).toBe(input.paymentJws);
    expect(pkg.mandates.cart.jws).toBe(input.cartJws);
    expect(pkg.keys.map((k) => k.role).sort()).toEqual(["agent", "merchant", "shopper"]);
    expect(pkg.references).toMatchObject({
      order_id: "ord_test",
      paypal_order_id: "PP-ORDER-1",
      capture_id: "CAP-1",
    });
  });

  test("holds no private key material", async () => {
    const { pkg } = await purchase();
    expect(JSON.stringify(pkg)).not.toMatch(/"d"\s*:/);
  });

  test("is deterministic: the same inputs give the same manifest", async () => {
    const { input } = await purchase();
    expect(buildProofPackage(input).manifest).toEqual(buildProofPackage(input).manifest);
  });

  test("always carries what a pass does not prove", async () => {
    const report = await verifyProofPackage((await purchase()).pkg);
    expect(report.notes.join(" ")).toMatch(/does not show who holds it/);
    expect(report.notes.join(" ")).toMatch(/Look the order and capture up in PayPal/);
    expect(report.notes.join(" ")).toMatch(/not a signature/);
  });
});

describe("tampering is caught, by the right check", () => {
  test("an edited reference breaks the manifest and nothing else: signatures still hold", async () => {
    const { pkg } = await purchase();
    const forged = { ...pkg, references: { ...pkg.references, capture_id: "CAP-FAKE" } };
    const report = await verifyProofPackage(forged);
    expect(report.ok).toBe(false);
    expect(failed(report)).toEqual(["manifest.integrity"]);
    expect(byId(report)["manifest.integrity"]!.detail).toContain("references");
  });

  test("the manifest is not authentication: a forger who re-seals the file is still caught by the pointer", async () => {
    const { pkg } = await purchase();
    const forged = reseal({
      ...pkg,
      references: { ...pkg.references, custom_id: "poi:someone-else:0000000000000000" },
    });
    const report = await verifyProofPackage(forged);
    expect(byId(report)["manifest.integrity"]!.passed).toBe(true); // the forger fixed the manifest
    expect(failed(report)).toEqual(["paypal.pointer"]);
  });

  test("a signed payload edited after signing fails its signature, even when the file is re-sealed", async () => {
    const { pkg, shopper, intent } = await purchase();
    const [h, , sig] = pkg.mandates.intent.jws.split(".") as [string, string, string];
    const edited = {
      ...intent,
      constraints: { ...intent.constraints, amount_max: { value: 999_999, currency: "USD" } },
    };
    const payload = Buffer.from(canonicalJson(edited)).toString("base64url");
    const forged = reseal({
      ...pkg,
      mandates: {
        ...pkg.mandates,
        intent: { jws: `${h}.${payload}.${sig}`, hash: mandateHash(edited), kid: shopper.kid },
      },
    });
    const report = await verifyProofPackage(forged);
    expect(report.ok).toBe(false);
    expect(byId(report)["sig.intent"]).toMatchObject({ passed: false });
    expect(byId(report)["sig.intent"]!.detail).toContain("does not verify");
  });

  test("a genuine signature with the wrong declared hash or key id is refused, even when the file is re-sealed", async () => {
    const { pkg } = await purchase();
    const wrongHash = reseal({
      ...pkg,
      mandates: { ...pkg.mandates, cart: { ...pkg.mandates.cart, hash: "c".repeat(64) } },
    });
    const a = await verifyProofPackage(wrongHash);
    expect(byId(a)["sig.cart"]).toMatchObject({ passed: false });
    expect(byId(a)["sig.cart"]!.detail).toContain("declared hash");
    const wrongKid = reseal({
      ...pkg,
      mandates: { ...pkg.mandates, intent: { ...pkg.mandates.intent, kid: "shp_other" } },
    });
    expect(byId(await verifyProofPackage(wrongKid))["sig.intent"]!.passed).toBe(false);
  });

  test("swapping the shopper's key for the forger's is caught by the key id binding and the signature", async () => {
    const { pkg } = await purchase();
    const forger = await party("shp");
    const swapped = reseal({
      ...pkg,
      keys: pkg.keys.map((k) =>
        k.role === "shopper"
          ? { ...k, public_jwk: forger.jwk as ProofPackage["keys"][number]["public_jwk"] }
          : k,
      ),
    });
    const report = await verifyProofPackage(swapped);
    expect(failed(report)).toEqual(expect.arrayContaining(["keys.kid_binding", "sig.intent"]));
    expect(report.ok).toBe(false);
  });

  test("a payment that commits to a different cart is refused", async () => {
    const { pkg } = await purchase({ paymentOverrides: { cart_mandate_hash: "a".repeat(64) } });
    const report = await verifyProofPackage(pkg);
    expect(failed(report)).toEqual(["bind.payment_cart"]);
  });

  test("a payment that commits to a different intent is refused", async () => {
    const { pkg } = await purchase({ paymentOverrides: { intent_mandate_hash: "b".repeat(64) } });
    expect(failed(await verifyProofPackage(pkg))).toEqual(["bind.payment_intent"]);
  });

  test("a payment that names a different agent key is refused", async () => {
    const { pkg } = await purchase({ paymentOverrides: { agent_key_id: "agt_someone_else" } });
    expect(failed(await verifyProofPackage(pkg))).toEqual(["bind.agent_key"]);
  });

  test("a cart signed by a key that is not in the package cannot be verified, and says so", async () => {
    const { pkg } = await purchase();
    const noMerchant = reseal({ ...pkg, keys: pkg.keys.filter((k) => k.role !== "merchant") });
    const report = await verifyProofPackage(noMerchant);
    expect(byId(report)["sig.cart"]).toMatchObject({ passed: false });
    expect(byId(report)["sig.cart"]!.detail).toContain("no merchant key");
  });

  test("a key in the wrong role does not verify the mandate: an agent key cannot stand in for the shopper", async () => {
    const { pkg, shopper } = await purchase();
    const relabelled = reseal({
      ...pkg,
      keys: pkg.keys.map((k) => (k.kid === shopper.kid ? { ...k, role: "agent" as const } : k)),
    });
    expect(byId(await verifyProofPackage(relabelled))["sig.intent"]!.passed).toBe(false);
  });
});

describe("the verifier never claims a pass it did not earn", () => {
  test("when a signature fails, the checks that depend on it say 'not checked' and fail", async () => {
    const { pkg } = await purchase();
    const bad = reseal({
      ...pkg,
      mandates: {
        ...pkg.mandates,
        intent: { ...pkg.mandates.intent, jws: pkg.mandates.intent.jws.slice(0, -4) + "AAAA" },
      },
    });
    const report = await verifyProofPackage(bad);
    const checks = byId(report);
    expect(checks["sig.intent"]!.passed).toBe(false);
    for (const id of [
      "bind.payment_intent",
      "bind.payment_cart",
      "bind.cart_intent",
      "bind.agent_key",
      "paypal.pointer",
      "policy.replay",
    ]) {
      expect(checks[id]!.passed, id).toBe(false);
      expect(checks[id]!.detail, id).toMatch(/^not checked/);
    }
    expect(report.ok).toBe(false);
  });

  test.each([undefined, null, 42, "text", [], {}, { schema_version: "poi-proof/9" }])(
    "something that is not a proof package (%j) is one failed check, not a crash",
    async (input) => {
      const report = await verifyProofPackage(input);
      expect(report.ok).toBe(false);
      expect(report.checks).toHaveLength(1);
      expect(report.checks[0]).toMatchObject({ id: "package.schema", passed: false });
      expect(report.notes.length).toBeGreaterThan(0);
    },
  );
});

describe("the policy replay explains why a purchase did not follow the signed limits", () => {
  test("an over-limit cart has valid signatures and still fails the hard rules, naming them", async () => {
    const { pkg } = await purchase({ cart: overreachingCart });
    const report = await verifyProofPackage(pkg);
    const checks = byId(report);
    expect(
      ["sig.intent", "sig.payment", "sig.cart", "bind.payment_cart"].every((id) => checks[id]!.passed),
    ).toBe(true);
    expect(checks["policy.replay"]!.passed).toBe(false);
    expect(checks["policy.replay"]!.detail).toContain("AMOUNT_EXCEEDS_MAX");
    expect(checks["policy.replay"]!.detail).toContain("ATTRIBUTE_MISMATCH");
    expect(report.ok).toBe(false);
  });

  test("a payment made after the intent expired fails the freshness rule", async () => {
    const { pkg } = await purchase({ paymentOverrides: { timestamp: "2026-11-20T00:00:00.000Z" } });
    expect(byId(await verifyProofPackage(pkg))["policy.replay"]!.detail).toContain("MANDATE_EXPIRED");
  });

  test("an agent paying alone needs the shopper's signed permission, and without it the proof fails", async () => {
    const { pkg } = await purchase({ humanPresent: false });
    const report = await verifyProofPackage(pkg);
    expect(failed(report)).toEqual(["policy.unattended"]);
  });

  test("with the permission signed into the intent, paying alone passes (and an unlisted platform does not)", async () => {
    const permitted: IntentMandate = {
      ...greyJacketIntent,
      constraints: {
        ...greyJacketIntent.constraints,
        unattended_payment: { allowed_agent_platforms: ["Northstar"] },
      },
    };
    expect(
      (await verifyProofPackage((await purchase({ intent: permitted, humanPresent: false })).pkg)).ok,
    ).toBe(true);
    const wrongPlatform: IntentMandate = {
      ...greyJacketIntent,
      constraints: {
        ...greyJacketIntent.constraints,
        unattended_payment: { allowed_agent_platforms: ["Wayfinder"] },
      },
    };
    const report = await verifyProofPackage(
      (await purchase({ intent: wrongPlatform, humanPresent: false })).pkg,
    );
    expect(failed(report)).toEqual(["policy.unattended"]);
  });

  test("the check for paying alone does not appear when the shopper was present", async () => {
    const report = await verifyProofPackage((await purchase()).pkg);
    expect(report.checks.some((c) => c.id === "policy.unattended")).toBe(false);
  });
});

describe("notes the reader should see", () => {
  test("a package made under another policy version says the rules may differ, and still verifies", async () => {
    const { pkg } = await purchase();
    const older = reseal({ ...pkg, policy: { ...pkg.policy, version: "poi-policy/0.0" } });
    const report = await verifyProofPackage(older);
    expect(report.ok).toBe(true);
    expect(report.notes.join(" ")).toContain("poi-policy/0.0");
  });

  test("a retired key is flagged, since the package cannot say when the merchant first saw the mandate", async () => {
    const { input } = await purchase();
    const withRetired = buildProofPackage({
      ...input,
      keys: input.keys.map((k) =>
        k.role === "shopper" ? { ...k, retiredAt: "2026-11-05T00:00:00.000Z" } : k,
      ),
    });
    const report = await verifyProofPackage(withRetired);
    expect(report.ok).toBe(true);
    expect(report.notes.join(" ")).toContain("was retired at 2026-11-05");
  });
});

describe("building", () => {
  test("refuses a key that carries private material", async () => {
    const { input } = await purchase();
    const withPrivate = {
      ...input.keys[0]!,
      publicJwk: { ...input.keys[0]!.publicJwk, d: "secret" } as Record<string, unknown>,
    };
    expect(() => buildProofPackage({ ...input, keys: [withPrivate] })).toThrow(/private key/);
  });

  test("refuses a mandate that is not a compact JWS", async () => {
    const { input } = await purchase();
    expect(() => buildProofPackage({ ...input, intentJws: "not-a-jws" })).toThrow(/compact JWS/);
  });

  test("a package built from a bad signature is built, and the verifier is what refuses it", async () => {
    const { input } = await purchase();
    const pkg = buildProofPackage({ ...input, intentJws: input.intentJws.slice(0, -4) + "AAAA" });
    expect((await verifyProofPackage(pkg)).ok).toBe(false);
  });
});
