import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SemanticFit } from "@poi/ai";
import type { CartMandate, StepUpView } from "@poi/contracts";
import { greyJacketIntent, MERCHANT_ID, NOW, partialCart } from "@poi/contracts/fixtures";
import { createDb, type Db } from "@poi/db";
import { generateSigningKeyPair, signMandate } from "@poi/mandates";
import { createMockClient } from "@poi/paypal";
import pg from "pg";
import { buildApp } from "./app";
import type { StepUpLink } from "./checkout";
import { memoryDb, party, signedCheckout, type Party } from "./test-helpers";

let shopper: Party;
let agent: Party;
let merchantKey: Awaited<ReturnType<typeof generateSigningKeyPair>>;

beforeAll(async () => {
  shopper = await party("shopper-key-1");
  agent = await party("agent-key-1");
  merchantKey = await generateSigningKeyPair();
});

const fit = (f: SemanticFit["fit"], confidence: number) => async (): Promise<SemanticFit> => ({
  fit: f,
  confidence,
  reasons: [],
  matched_attributes: [],
  conflicting_attributes: [],
});

/** The rain shell (J1 partial) with a cart that stays valid for days, so the 24 h link limit is what applies. */
const shellCart: CartMandate = {
  ...partialCart,
  contents: { ...partialCart.contents, cart_expiry: "2026-11-05T00:00:00Z" },
};
const HOUR = 3_600_000;
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();

function setup(opts: { vaultId?: string; db?: Db } = {}) {
  const mem = memoryDb();
  const db = opts.db ?? mem.db;
  if (!opts.db) {
    mem.keys.set(shopper.kid, {
      kind: "shopper",
      kid: shopper.kid,
      publicJwk: shopper.publicJwk,
      shopperId: "shopper-1",
      ...(opts.vaultId ? { vaultId: opts.vaultId } : {}),
    });
    mem.keys.set(agent.kid, {
      kind: "agent",
      kid: agent.kid,
      publicJwk: agent.publicJwk,
      platform: "Northstar",
    });
  }
  const paypal = createMockClient();
  const createOrder = vi.spyOn(paypal, "createOrder");
  const links: StepUpLink[] = [];
  const clock = { now: NOW };
  const semanticFit = vi.fn(fit("partial", 0.9));
  const app = buildApp({
    paypal,
    db,
    merchant: { id: MERCHANT_ID, kid: "merchant-1", privateKey: merchantKey.privateKey },
    semanticFit,
    now: () => clock.now,
    stepUp: { linkBase: "https://shop.example/", send: async (l) => void links.push(l) },
  });
  const checkout = (body: unknown) =>
    app.inject({ method: "POST", url: "/checkout", payload: body as object });
  const token = (i = 0) => links[i]!.url.split("/approve/")[1]!;
  const view = async (i = 0) => (await app.inject(`/stepup/${token(i)}`)).json() as StepUpView;
  const approve = (approval_jws: string, i = 0) =>
    app.inject({ method: "POST", url: `/stepup/${token(i)}/approve`, payload: { approval_jws } });
  /** What the buyer app's /approve page signs, with the browser's key. */
  const sign = (v: StepUpView, key: Party = shopper, over: object = {}) =>
    signMandate(
      { order_id: v.stepup_id, cart_mandate_hash: v.cart_mandate_hash, approved_at: clock.now, ...over },
      key.privateKey,
      key.kid,
    );
  /** An agent-alone checkout that J1 sends to the shopper. */
  const stepUp = async (cart: CartMandate = shellCart, intent = greyJacketIntent) => {
    const res = await checkout(
      (await signedCheckout({ shopper, agent, intent, cart, humanPresent: false })).body,
    );
    expect(res.json().verdict).toEqual({ outcome: "STEP_UP", reasons: ["SEMANTIC_UNCERTAIN"] });
    return res;
  };
  return {
    app,
    mem,
    db,
    createOrder,
    links,
    clock,
    semanticFit,
    checkout,
    token,
    view,
    approve,
    sign,
    stepUp,
  };
}

describe("step-up approval links (#35)", () => {
  test("step-up approval link captures only after the shopper approves", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const res = await s.stepUp();

    // Nothing exists at PayPal, and the agent's response carries no link.
    expect(s.createOrder).not.toHaveBeenCalled();
    expect(s.mem.orders.size).toBe(0);
    expect(JSON.stringify(res.json())).not.toContain("approve");
    expect(s.links).toHaveLength(1);
    expect(s.links[0]).toMatchObject({ shopperId: "shopper-1", expiresAt: at(24 * HOUR) });
    expect(s.links[0]!.url).toMatch(/^https:\/\/shop\.example\/approve\/[A-Za-z0-9_-]{43}$/);
    // Only the token's hash is stored.
    const [row] = [...s.mem.stepups.values()];
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(s.token());

    const v = await s.view();
    expect(v).toMatchObject({
      status: "PENDING",
      total: { value: 7900, currency: "USD" },
      lines: [{ sku: partialCart.contents.lines[0]!.sku }],
      agent_platform: "Northstar",
      reasons: ["SEMANTIC_UNCERTAIN"],
      shopper_kid: shopper.kid,
      expires_at: at(24 * HOUR),
    });

    s.clock.now = at(3 * HOUR);
    const ok = await s.approve(await s.sign(v));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: "CAPTURED", order_id: expect.stringMatching(/^ord_/) });
    expect(s.createOrder).toHaveBeenCalledTimes(1);
    expect(s.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "CAPTURE", vaultId: "VAULT-1" }),
    );
    const order = s.mem.orders.get(ok.json().order_id)!;
    expect(order).toMatchObject({
      humanPresent: false,
      status: "COMPLETED",
      captureId: ok.json().capture_id,
    });
    // The order's verdict says how it came to exist: a step-up, approved by the shopper.
    expect(await s.db.orderVerdict(order.id)).toMatchObject({
      outcome: "STEP_UP",
      reasons: ["SEMANTIC_UNCERTAIN"],
    });
    expect(s.mem.audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["stepup.created", "stepup.approved"]),
    );
    expect((await s.view()).status).toBe("APPROVED");

    // Clicking again (or a retry after a dropped response) charges nothing more.
    const again = await s.approve(await s.sign(v));
    expect(again.json()).toEqual(ok.json());
    expect(s.createOrder).toHaveBeenCalledTimes(1);
  });

  test("an expired link creates nothing", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    await s.stepUp();
    const v = await s.view();
    s.clock.now = at(24 * HOUR);
    expect((await s.view()).status).toBe("EXPIRED");
    const res = await s.approve(await s.sign(v));
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("stepup_expired");
    expect(s.createOrder).not.toHaveBeenCalled();
    expect(s.mem.orders.size).toBe(0);
    // Still nothing a second later, and the row now says why.
    s.clock.now = at(25 * HOUR);
    expect((await s.approve(await s.sign(v))).statusCode).toBe(410);
    expect([...s.mem.stepups.values()][0]!.status).toBe("EXPIRED");
  });

  test("the link never outlives the cart it approves", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    await s.stepUp(partialCart); // cart_expiry 15 minutes after NOW
    expect(s.links[0]!.expiresAt).toBe(new Date(partialCart.contents.cart_expiry).toISOString());
    s.clock.now = at(20 * 60_000);
    expect((await s.approve(await s.sign(await s.view()))).statusCode).toBe(410);
    expect(s.createOrder).not.toHaveBeenCalled();
  });

  test("only the shopper's own key, for this step-up and this cart, approves", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    await s.stepUp();
    const v = await s.view();
    const cases: [string, Promise<string>, string][] = [
      ["the agent's key", s.sign(v, agent), "UNKNOWN_KEY"],
      ["another cart", s.sign(v, shopper, { cart_mandate_hash: "0".repeat(64) }), "MANDATE_MISMATCH"],
      ["another step-up", s.sign(v, shopper, { order_id: "stp_other" }), "MANDATE_MISMATCH"],
      ["not a CartApproval", signMandate({ ok: true }, shopper.privateKey, shopper.kid), "SCHEMA_INVALID"],
    ];
    for (const [label, jws, reason] of cases) {
      const res = await s.approve(await jws);
      expect([label, res.statusCode, res.json().reasons]).toEqual([label, 403, [reason]]);
    }
    const tampered = (await s.sign(v)).slice(0, -4) + "AAAA";
    expect((await s.approve(tampered)).json().reasons).toEqual(["SIGNATURE_INVALID"]);
    expect(s.createOrder).not.toHaveBeenCalled();
    // None of that used the link up.
    expect((await s.approve(await s.sign(v))).statusCode).toBe(200);
  });

  test("the hard rules run again at approval: a budget spent in the meantime refuses it", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    const intent = {
      ...greyJacketIntent,
      constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
    };
    await s.stepUp(shellCart, intent); // USD 79 rain shell, waiting for the shopper
    // Meanwhile the agent buys the USD 74 grey jacket under the same intent.
    s.semanticFit.mockImplementation(fit("match", 0.95));
    const bought = await s.checkout(
      (await signedCheckout({ shopper, agent, intent, humanPresent: false })).body,
    );
    expect(bought.json().verdict.outcome).toBe("APPROVE");

    const res = await s.approve(await s.sign(await s.view()));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "stepup_no_longer_valid", reasons: ["BUDGET_EXCEEDED"] });
    expect(s.createOrder).toHaveBeenCalledTimes(1); // the jacket only
    expect((await s.view()).status).toBe("REJECTED");
  });

  test("without a saved wallet nothing is charged, and the link still works once there is one", async () => {
    const s = setup();
    await s.stepUp();
    const v = await s.view();
    const res = await s.approve(await s.sign(v));
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("no_vaulted_wallet");
    expect(s.createOrder).not.toHaveBeenCalled();
    expect((await s.view()).status).toBe("PENDING");

    s.mem.keys.get(shopper.kid)!.vaultId = "VAULT-2";
    const ok = await s.approve(await s.sign(v));
    expect(ok.json().status).toBe("CAPTURED");
    expect(s.createOrder).toHaveBeenCalledWith(expect.objectContaining({ vaultId: "VAULT-2" }));
  });

  test("an unknown or malformed token is a 404; a human-present step-up sends no link", async () => {
    const s = setup({ vaultId: "VAULT-1" });
    expect((await s.app.inject("/stepup/unknown-token-0123456789abcdef")).statusCode).toBe(404);
    expect((await s.app.inject("/stepup/%27%20or%201=1")).statusCode).toBe(404);
    const bad = await s.app.inject({
      method: "POST",
      url: "/stepup/unknown-token-0123456789abcdef/approve",
      payload: { approval_jws: "x.y.z" },
    });
    expect(bad.statusCode).toBe(404);

    // Human present, the warnings show before the PayPal button instead (spec 0003).
    const res = await s.checkout((await signedCheckout({ shopper, agent, cart: shellCart })).body);
    expect(res.json().verdict.outcome).toBe("STEP_UP");
    expect(s.links).toHaveLength(0);
    expect(s.mem.stepups.size).toBe(0);
  });
});

// The same flow against real Postgres, for the SQL behind the in-memory Db (claim, expiry, the token hash).
describe.runIf(process.env.DATABASE_URL)("step-up links with Postgres", () => {
  test("store, view, approve once, and an expired link creates nothing", async () => {
    const name = `poi_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const url = new URL(process.env.DATABASE_URL!);
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`create database ${name}`);
    url.pathname = `/${name}`;
    const db = createDb(url.toString());
    const raw = new pg.Pool({ connectionString: url.toString() });
    try {
      await db.migrate();
      await raw.query("insert into shoppers (id, vault_id) values ('shopper-1', 'VAULT-PG')");
      await raw.query("insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, 'shopper-1', $2)", [
        shopper.kid,
        shopper.publicJwk,
      ]);
      await raw.query(
        "insert into agent_keys (kid, platform, owner, public_jwk) values ($1, 'Northstar', 'test', $2)",
        [agent.kid, agent.publicJwk],
      );
      const s = setup({ db });

      await s.stepUp();
      await s.stepUp({ ...shellCart, contents: { ...shellCart.contents, cart_id: "cart-two" } });
      const rows = (await raw.query("select status, token_hash, order_id from stepups")).rows;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.status === "PENDING" && r.order_id === null)).toBe(true);
      expect((await raw.query("select count(*)::int as n from orders")).rows[0].n).toBe(0);

      // Two approvals at once: one order.
      const v = await s.view(0);
      const jws = await s.sign(v);
      const both = await Promise.all([s.approve(jws, 0), s.approve(jws, 0)]);
      const statuses = both.map((r) => r.statusCode).sort();
      expect(statuses[0]).toBe(200);
      expect((await raw.query("select count(*)::int as n from orders")).rows[0].n).toBe(1);
      expect((await s.view(0)).status).toBe("APPROVED");

      // The second link, a day later: nothing.
      s.clock.now = at(24 * HOUR + 1000);
      const late = await s.approve(await s.sign(await s.view(1)), 1);
      expect(late.statusCode).toBe(410);
      expect((await raw.query("select count(*)::int as n from orders")).rows[0].n).toBe(1);
      expect(
        (await raw.query("select status from stepups order by created_at")).rows.map((r) => r.status),
      ).toEqual(["APPROVED", "EXPIRED"]);
      await s.app.close();
    } finally {
      await raw.end();
      await db.close().catch(() => {});
      for (let i = 0; i < 50; i++) {
        const left = await admin.query("select count(*)::int as n from pg_stat_activity where datname = $1", [
          name,
        ]);
        if (left.rows[0].n === 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    }
  });
});
