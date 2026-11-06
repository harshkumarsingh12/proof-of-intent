import { describe, expect, test } from "vitest";
import { CartApproval, CartMandate, IntentMandate, PaymentMandate } from "@poi/contracts";
import {
  compliantCart,
  greyJacketIntent,
  MERCHANT_ID,
  NOW,
  overreachingCart,
  partialCart,
} from "@poi/contracts/fixtures";
import { createKeyRegistry, keyIdFor, mandateHash, publicEs256Jwk, verifyMandate } from "@poi/mandates";
import { evaluate } from "@poi/policy-engine";
import { intentFromJws } from "./agent-server";
import { paymentMandate, proposeCart } from "./cart";
import { CATALOG, CATEGORIES, PRESETS, productsIn } from "./catalog";
import { canApprove, isStepUpToken, stepUpApproval } from "./stepup";
import { buildIntent, CLOCK_SKEW_MS, dollarsToCents, type IntentForm } from "./intent";
import {
  generateShopperKey,
  jwsPayloadText,
  KEY_ALGORITHM,
  publicJwk,
  sha256Hex,
  signCompact,
  type ShopperKey,
} from "./signing";

// Browser code under Node's WebCrypto, which is the same API. A Playwright smoke test of the page itself is
// still to come; these cover everything the page does with keys, hashes and mandates.

const form: IntentForm = {
  description: greyJacketIntent.natural_language_description,
  maxPrice: "80",
  category: "running-jacket",
  color: "grey",
  validDays: 7,
  confirmEachCart: false,
};

/** A browser key registered the way POST /keys/shopper does it: kid = thumbprint of the public JWK. */
async function registeredShopper() {
  const key = await generateShopperKey();
  const jwk = publicEs256Jwk(await publicJwk(key));
  const kid = await keyIdFor("shp", jwk);
  const registry = createKeyRegistry();
  registry.register(kid, jwk, "shopper-1");
  return { key, kid, registry };
}

const intentFor = (kid: string, over: Partial<IntentForm> = {}, now = new Date(NOW)) =>
  buildIntent(
    { ...form, ...over },
    { kid, merchantId: MERCHANT_ID, now, mandateId: crypto.randomUUID(), nonce: "n-0123456789abcdef" },
  );

describe("browser signing key (spec 0001)", () => {
  test("signing key is generated as non-extractable WebCrypto ES256", async () => {
    expect(KEY_ALGORITHM).toEqual({ name: "ECDSA", namedCurve: "P-256" });
    const key: ShopperKey = await generateShopperKey();
    expect(key.privateKey.extractable).toBe(false);
    expect(key.privateKey.algorithm).toMatchObject(KEY_ALGORITHM);
    await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey("pkcs8", key.privateKey)).rejects.toThrow();
  });

  test("the public JWK has only what /keys/shopper accepts", async () => {
    const jwk = await publicJwk(await generateShopperKey());
    expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect(() => publicEs256Jwk(jwk)).not.toThrow();
  });

  test("a mandate signed in the browser verifies on the server, with the exact canonical bytes", async () => {
    const { key, kid, registry } = await registeredShopper();
    const intent = intentFor(kid);
    const jws = await signCompact(intent, key.privateKey, kid);

    const res = await verifyMandate(jws, (k) => registry.resolve(k, intent.created_at));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.kid).toBe(kid);
    expect(IntentMandate.parse(res.payload)).toEqual(intent);
    expect(res.canonical).toBe(jwsPayloadText(jws));
    // The hash the page shows is the hash the merchant stores.
    expect(await sha256Hex(res.canonical)).toBe(mandateHash(intent));
  });

  test("a tampered browser signature, or another browser's key, doesn't verify", async () => {
    const { key, kid, registry } = await registeredShopper();
    const jws = await signCompact(intentFor(kid), key.privateKey, kid);
    const [h, p, s] = jws.split(".");
    const flipped = `${h}.${p}.${s!.slice(0, -2)}${s!.endsWith("AA") ? "BA" : "AA"}`;
    expect(await verifyMandate(flipped, (k) => registry.resolve(k, NOW))).toEqual({
      ok: false,
      reason: "SIGNATURE_INVALID",
    });
    const other = await generateShopperKey();
    const forged = await signCompact(intentFor(kid), other.privateKey, kid);
    expect((await verifyMandate(forged, (k) => registry.resolve(k, NOW))).ok).toBe(false);
  });

  test("the countersignature is a CartApproval over the hash of the Cart Mandate the merchant signed", async () => {
    const { key, kid, registry } = await registeredShopper();
    const merchantCartJws = await signCompact(compliantCart, key.privateKey, "merchant-1"); // stand-in signer
    const cartHash = await sha256Hex(jwsPayloadText(merchantCartJws));
    expect(cartHash).toBe(mandateHash(compliantCart));
    const approval = await signCompact(
      { order_id: "ord_1", cart_mandate_hash: cartHash, approved_at: NOW },
      key.privateKey,
      kid,
    );
    const res = await verifyMandate(approval, (k) => registry.resolve(k, NOW));
    expect(res.ok && CartApproval.parse(res.payload)).toEqual({
      order_id: "ord_1",
      cart_mandate_hash: mandateHash(compliantCart),
      approved_at: NOW,
    });
  });
});

describe("intent form → Intent Mandate", () => {
  test("the demo form gives the same limits as the grey jacket fixture", () => {
    const intent = intentFor("shp_x");
    expect(intent.constraints).toMatchObject({
      amount_max: { value: 8000, currency: "USD" },
      merchant_allowlist: [MERCHANT_ID],
      attributes: { category: "running-jacket", color: "grey" },
      quantity_max: { per_line: 1, per_order: 1 },
    });
    expect(intent.issuer).toBe("shp_x");
    expect(intent.natural_language_description).toBe(greyJacketIntent.natural_language_description);
  });

  test("it starts a little in the past for clock skew and expires after the chosen days", () => {
    const now = new Date(NOW);
    const intent = intentFor("shp_x", { validDays: 3 }, now);
    expect(Date.parse(intent.constraints.valid_from)).toBe(now.getTime() - CLOCK_SKEW_MS);
    expect(intent.created_at).toBe(intent.constraints.valid_from);
    expect(Date.parse(intent.intent_expiry)).toBe(now.getTime() + 3 * 86_400_000);
  });

  test("prices are parsed to cents; nonsense is refused", () => {
    expect(dollarsToCents("80")).toBe(8000);
    expect(dollarsToCents("$79.9")).toBe(7990);
    expect(dollarsToCents(" 79.99 ")).toBe(7999);
    for (const bad of ["", "0", "-5", "80.999", "eighty", "1e3"]) expect(() => dollarsToCents(bad)).toThrow();
  });

  test("an empty description is refused; confirm-every-cart sets the AP2 flag", () => {
    expect(() => intentFor("shp_x", { description: "  " })).toThrow();
    expect(intentFor("shp_x", { confirmEachCart: true }).user_cart_confirmation_required).toBe(true);
  });
});

describe("buyer agent: cart and Payment Mandate", () => {
  const merchant = { id: MERCHANT_ID, name: "Trailhead Outfitters" };
  const now = new Date(NOW);
  const intent = intentFor("shp_x");

  test("the catalog starts with the three fixture jackets, unchanged (tests, video and scripted disputes)", () => {
    expect(CATALOG.slice(0, 3).map((p) => p.line)).toEqual([
      compliantCart.contents.lines[0],
      partialCart.contents.lines[0],
      overreachingCart.contents.lines[0],
    ]);
  });

  test("every product is a valid one-unit cart line, SKUs are unique, every category has demo words", () => {
    expect(CATALOG).toHaveLength(12);
    expect(new Set(CATALOG.map((p) => p.line.sku)).size).toBe(CATALOG.length);
    for (const p of CATALOG) {
      expect(CartMandate.shape.contents.shape.lines.element.parse(p.line)).toEqual(p.line);
      expect(Object.keys(p.line.attributes).sort()).toEqual(["category", "color"]);
      expect(CATEGORIES).toContain(p.line.attributes.category);
    }
    expect(PRESETS.map((p) => p.category)).toEqual(CATEGORIES);
    expect(PRESETS[0]!.description).toBe(greyJacketIntent.natural_language_description);
  });

  test("each category's demo intent: some product of it passes the hard rules, no other category's does", () => {
    for (const preset of PRESETS) {
      const intent = intentFor("shp_x", {
        description: preset.description,
        maxPrice: String(preset.amountMax.value / 100),
        category: preset.category,
        color: preset.color,
      });
      const passes = (sku: string) =>
        evaluate({ intent, cart: proposeCart(intent, sku, { merchant, now, cartId: "c" }), now: NOW }).pass;
      const inside = productsIn(preset.category).map((p) => passes(p.line.sku));
      const outside = CATALOG.filter((p) => p.line.attributes.category !== preset.category).map((p) =>
        passes(p.line.sku),
      );
      expect(inside, preset.category).toContain(true);
      expect(outside, preset.category).not.toContain(true);
    }
  });

  test("a proposed cart is a valid Cart Mandate bound to the intent", () => {
    const cart = proposeCart(intent, "JKT-GRY-M", { merchant, now, cartId: "cart-1" });
    expect(CartMandate.parse(cart)).toEqual(cart);
    expect(cart.intent_mandate_hash).toBe(mandateHash(intent));
    expect(cart.contents.total).toEqual({ value: 7400, currency: "USD" });
    expect(Date.parse(cart.contents.cart_expiry)).toBeGreaterThan(now.getTime());
    expect(() => proposeCart(intent, "NOPE", { merchant, now, cartId: "c" })).toThrow();
  });

  test("the hard rules agree with the demo: grey passes, red fails on price and color", () => {
    const cart = (sku: string) => proposeCart(intent, sku, { merchant, now, cartId: sku });
    expect(evaluate({ intent, cart: cart("JKT-GRY-M"), now: NOW }).pass).toBe(true);
    expect(evaluate({ intent, cart: cart("SHL-GRY-M"), now: NOW }).pass).toBe(true); // J1's call, not the rules'
    expect(evaluate({ intent, cart: cart("JKT-RED-M"), now: NOW }).reasons).toEqual([
      "AMOUNT_EXCEEDS_MAX",
      "ATTRIBUTE_MISMATCH",
    ]);
  });

  test("the Payment Mandate commits to this intent and this cart, as checkout's binding check requires", () => {
    const cart = proposeCart(intent, "JKT-GRY-M", { merchant, now, cartId: "cart-1" });
    const pm = paymentMandate(intent, cart, {
      agentKid: "agt_1",
      platform: "Northstar",
      humanPresent: true,
      now,
      id: crypto.randomUUID(),
    });
    expect(PaymentMandate.parse(pm)).toEqual(pm);
    expect(pm).toMatchObject({
      intent_mandate_hash: mandateHash(intent),
      cart_mandate_hash: mandateHash(cart),
      agent_key_id: "agt_1",
      human_present: true,
    });
  });

  test("the agent reads the intent out of the browser's JWS exactly as signed", async () => {
    const { key, kid } = await registeredShopper();
    const signed = intentFor(kid);
    const jws = await signCompact(signed, key.privateKey, kid);
    expect(intentFromJws(jws)).toEqual(signed);
    expect(mandateHash(intentFromJws(jws))).toBe(mandateHash(signed));
    expect(() => intentFromJws("not-a-jws")).toThrow();
  });
});

describe("step-up approval page (#35)", () => {
  const view = {
    stepup_id: "stp_1",
    status: "PENDING" as const,
    lines: partialCart.contents.lines,
    total: partialCart.contents.total,
    merchant_name: "Trailhead Outfitters",
    agent_platform: "Northstar",
    reasons: ["SEMANTIC_UNCERTAIN" as const],
    cart_mandate_hash: mandateHash(partialCart),
    shopper_kid: "shp_me",
    expires_at: "2026-11-03T10:00:00Z",
  };

  test("the page signs a CartApproval for this step-up and this cart, which the merchant verifies", async () => {
    const { key, kid, registry } = await registeredShopper();
    const mine = { ...view, shopper_kid: kid };
    const jws = await signCompact(stepUpApproval(mine, new Date(NOW)), key.privateKey, kid);
    const res = await verifyMandate(jws, (k) => registry.resolve(k, NOW));
    expect(res.ok && CartApproval.parse(res.payload)).toEqual({
      order_id: "stp_1",
      cart_mandate_hash: mandateHash(partialCart),
      approved_at: new Date(NOW).toISOString(),
    });
  });

  test("only the browser holding the intent's key, on a pending link, gets the approve button", () => {
    expect(canApprove(view, "shp_me")).toBe(true);
    expect(canApprove(view, "shp_other")).toBe(false);
    expect(canApprove(view, undefined)).toBe(false);
    expect(canApprove({ ...view, status: "EXPIRED" }, "shp_me")).toBe(false);
  });

  test("link tokens are checked before they are forwarded", () => {
    expect(isStepUpToken("A".repeat(43))).toBe(true);
    for (const bad of ["", "short", "../keys/agent", "a b c d e f g h i j k l", "x".repeat(200)])
      expect(isStepUpToken(bad)).toBe(false);
  });
});
