import { beforeAll, describe, expect, test, vi } from "vitest";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { generateSigningKeyPair, signMandate } from "@poi/mandates";
import { createMockClient, PayPalError, type PayPalClient } from "@poi/paypal";
import { buildApp } from "./app";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

let shopper: Party;
let other: Party;
let stranger: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;

beforeAll(async () => {
  shopper = await party("shp_one");
  other = await party("shp_two");
  stranger = await party("shp_unregistered");
  agent = await party("agent-key-1");
  merchantKey = await generateSigningKeyPair();
});

function setup(paypal: PayPalClient = createMockClient()) {
  const mem = memoryDb();
  for (const [p, id] of [
    [shopper, "shopper-1"],
    [other, "shopper-2"],
  ] as const) {
    mem.keys.set(p.kid, { kind: "shopper", kid: p.kid, publicJwk: p.publicJwk, shopperId: id });
  }
  mem.keys.set(agent.kid, {
    kind: "agent",
    kid: agent.kid,
    publicJwk: agent.publicJwk,
    platform: "Northstar",
  });
  const app = buildApp({
    paypal,
    db: mem.db,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit: async () =>
      ({ fit: "match", confidence: 0.95, reasons: [], prompt_version: "test" }) as never,
    now: () => NOW,
    stepUp: { linkBase: "https://shop.example" },
  });
  const proof = (who: Party, payload: object) => signMandate(payload, who.privateKey, who.kid);
  const setupProof = (who = shopper, issued_at = NOW) => proof(who, { purpose: "vault.setup", issued_at });
  const saveProof = (setup_token_id: string, who = shopper, issued_at = NOW) =>
    proof(who, { purpose: "vault.save", setup_token_id, issued_at });
  const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
  return { app, mem, paypal, setupProof, saveProof, post };
}

describe("POST /vault/setup", () => {
  test("a signed proof gets PayPal's approval link, and the setup token is remembered for that shopper", async () => {
    const s = setup();
    const create = vi.spyOn(s.paypal, "createVaultSetupToken");
    const res = await s.post("/vault/setup", { proof_jws: await s.setupProof() });
    expect(res.statusCode).toBe(200);
    const { setup_token_id, approval_url } = res.json();
    expect(create).toHaveBeenCalledWith({
      returnUrl: "https://shop.example/shop/wallet",
      cancelUrl: "https://shop.example/shop",
    });
    expect(approval_url).toContain(`approval_token_id=${setup_token_id}`);
    expect(s.mem.vaultSetups.get(setup_token_id)).toEqual({ shopperId: "shopper-1", claimed: false });
    expect(s.mem.audit.map((a) => a.action)).toEqual(["vault.setup"]);
  });

  test.each([
    ["an unregistered key", async (s: ReturnType<typeof setup>) => s.setupProof(stranger), "UNKNOWN_KEY"],
    [
      "a proof for another purpose",
      async (s: ReturnType<typeof setup>) => s.saveProof("SETUP-X"),
      "MANDATE_MISMATCH",
    ],
    ["garbage", async () => "not.a.jws", "SIGNATURE_INVALID"],
  ])("refuses %s before any PayPal call", async (_name, makeProof, reason) => {
    const s = setup();
    const create = vi.spyOn(s.paypal, "createVaultSetupToken");
    const res = await s.post("/vault/setup", { proof_jws: await makeProof(s) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "proof_invalid", reasons: [reason] });
    expect(create).not.toHaveBeenCalled();
  });

  test("a tampered proof is refused", async () => {
    const s = setup();
    const [h, , sig] = (await s.setupProof()).split(".");
    const forged = Buffer.from(JSON.stringify({ purpose: "vault.setup", issued_at: NOW, extra: 1 })).toString(
      "base64url",
    );
    const res = await s.post("/vault/setup", { proof_jws: `${h}.${forged}.${sig}` });
    expect(res.json().reasons).toEqual(["SIGNATURE_INVALID"]);
  });

  test("an old proof, or one from the future, is refused", async () => {
    const s = setup();
    const old = new Date(Date.parse(NOW) - 6 * 60_000).toISOString();
    const future = new Date(Date.parse(NOW) + 2 * 60_000).toISOString();
    for (const at of [old, future]) {
      const res = await s.post("/vault/setup", { proof_jws: await s.setupProof(shopper, at) });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("proof_expired");
    }
    const fresh = new Date(Date.parse(NOW) - 4 * 60_000).toISOString();
    expect((await s.post("/vault/setup", { proof_jws: await s.setupProof(shopper, fresh) })).statusCode).toBe(
      200,
    );
  });

  test("a retired key can't start a save", async () => {
    const s = setup();
    s.mem.keys.get(shopper.kid)!.retiredAt = "2026-11-01T00:00:00Z";
    const res = await s.post("/vault/setup", { proof_jws: await s.setupProof() });
    expect(res.json().reasons).toEqual(["UNKNOWN_KEY"]);
  });

  test("a malformed body is a 400; PayPal refusing is 409; PayPal down is 503", async () => {
    const s = setup();
    expect((await s.post("/vault/setup", {})).statusCode).toBe(400);

    const refusing = createMockClient();
    refusing.createVaultSetupToken = async () => {
      throw new PayPalError(403, "PERMISSION_DENIED", "dbg", "no vault");
    };
    const r = setup(refusing);
    const res = await r.post("/vault/setup", { proof_jws: await r.setupProof() });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "paypal_refused", issue: "PERMISSION_DENIED" });
    expect(r.mem.vaultSetups.size).toBe(0);

    const down = createMockClient();
    down.createVaultSetupToken = async () => {
      throw new Error("getaddrinfo EAI_AGAIN");
    };
    const d = setup(down);
    expect((await d.post("/vault/setup", { proof_jws: await d.setupProof() })).statusCode).toBe(503);
  });
});

describe("POST /vault/save", () => {
  async function started(s: ReturnType<typeof setup>, who = shopper) {
    const res = await s.post("/vault/setup", { proof_jws: await s.setupProof(who) });
    return res.json().setup_token_id as string;
  }

  test("saves the wallet: the payment token becomes the shopper's vault id, and the status says so", async () => {
    const s = setup();
    const id = await started(s);
    expect((await s.app.inject({ method: "GET", url: `/vault/${shopper.kid}` })).json()).toEqual({
      wallet: false,
    });

    const res = await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ wallet: true });
    expect(s.mem.keys.get(shopper.kid)!.vaultId).toMatch(/^[A-Z0-9]{17}$/);
    expect(s.mem.keys.get(other.kid)!.vaultId).toBeUndefined();
    expect((await s.app.inject({ method: "GET", url: `/vault/${shopper.kid}` })).json()).toEqual({
      wallet: true,
    });
    expect(s.mem.audit.map((a) => a.action)).toEqual(["vault.setup", "vault.saved"]);
  });

  test("the status never reveals the vault id, and an unknown key is a 404", async () => {
    const s = setup();
    const id = await started(s);
    await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id) });
    const res = await s.app.inject({ method: "GET", url: `/vault/${shopper.kid}` });
    expect(res.body).not.toContain(s.mem.keys.get(shopper.kid)!.vaultId!);
    expect((await s.app.inject({ method: "GET", url: "/vault/shp_nobody" })).statusCode).toBe(404);
  });

  test("a setup token is single use: saving twice answers 409 and PayPal is asked once", async () => {
    const s = setup();
    const convert = vi.spyOn(s.paypal, "createVaultPaymentToken");
    const id = await started(s);
    const proof = await s.saveProof(id);
    expect((await s.post("/vault/save", { setup_token_id: id, proof_jws: proof })).statusCode).toBe(200);
    const again = await s.post("/vault/save", { setup_token_id: id, proof_jws: proof });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("setup_not_available");
    expect(convert).toHaveBeenCalledTimes(1);
  });

  test("another shopper can't save onto someone else's setup token", async () => {
    const s = setup();
    const convert = vi.spyOn(s.paypal, "createVaultPaymentToken");
    const id = await started(s, shopper);
    const res = await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id, other) });
    expect(res.statusCode).toBe(409);
    expect(convert).not.toHaveBeenCalled();
    expect(s.mem.keys.get(other.kid)!.vaultId).toBeUndefined();
    expect(s.mem.keys.get(shopper.kid)!.vaultId).toBeUndefined();
  });

  test("the proof must name the setup token it is used with", async () => {
    const s = setup();
    const id = await started(s);
    const res = await s.post("/vault/save", {
      setup_token_id: id,
      proof_jws: await s.saveProof("SOME-OTHER-TOKEN"),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reasons).toEqual(["MANDATE_MISMATCH"]);
    expect(s.mem.vaultSetups.get(id)!.claimed).toBe(false);
  });

  test("a setup proof can't be used to save", async () => {
    const s = setup();
    const id = await started(s);
    const res = await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.setupProof() });
    expect(res.statusCode).toBe(403);
  });

  test("not approved on PayPal yet: refused, nothing saved, and the shopper can approve and try again", async () => {
    const paypal = createMockClient();
    const real = paypal.createVaultPaymentToken;
    let approved = false;
    paypal.createVaultPaymentToken = async (id) => {
      if (!approved) throw new PayPalError(422, "SETUP_TOKEN_NOT_APPROVED", "dbg", "not approved");
      return real(id);
    };
    const s = setup(paypal);
    const id = await started(s);
    const first = await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id) });
    expect(first.statusCode).toBe(409);
    expect(first.json()).toMatchObject({ error: "paypal_refused", issue: "SETUP_TOKEN_NOT_APPROVED" });
    expect(s.mem.keys.get(shopper.kid)!.vaultId).toBeUndefined();

    approved = true;
    const second = await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id) });
    expect(second.statusCode).toBe(200);
    expect(s.mem.keys.get(shopper.kid)!.vaultId).toBeDefined();
  });
});

describe("the saved wallet is what agent-alone checkout charges", () => {
  test("no wallet → 409 and no charge; after saving → a CAPTURE order against the vault id", async () => {
    const s = setup();
    const createOrder = vi.spyOn(s.paypal, "createOrder");
    const alone = async () =>
      s.post("/checkout", (await signedCheckout({ shopper, agent, humanPresent: false })).body);

    const before = await alone();
    expect(before.statusCode).toBe(409);
    expect(before.json().error).toBe("no_vaulted_wallet");
    expect(createOrder).not.toHaveBeenCalled();

    const id = (await s.post("/vault/setup", { proof_jws: await s.setupProof() })).json().setup_token_id;
    await s.post("/vault/save", { setup_token_id: id, proof_jws: await s.saveProof(id) });
    const vaultId = s.mem.keys.get(shopper.kid)!.vaultId;

    const after = await alone();
    expect(after.statusCode).toBe(200);
    expect(after.json().verdict.outcome).toBe("APPROVE");
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ intent: "CAPTURE", vaultId }));
    expect(s.mem.orders.get(after.json().order_id)).toMatchObject({
      humanPresent: false,
      status: "COMPLETED",
    });
  });
});
