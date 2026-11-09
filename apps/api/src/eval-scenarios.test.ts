/** Supplemental eval #169: real merchant routes, signed requests and disposable PostgreSQL, mock payments. */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import pg from "pg";
import { semanticFit, type SemanticFit } from "@poi/ai";
import { compliantCart, greyJacketIntent, MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { createDb } from "@poi/db";
import { generateSigningKeyPair, mandateHash, signMandate } from "@poi/mandates";
import { createMockClient } from "@poi/paypal";
import { createGenerate } from "../../../packages/ai/src/runtime";
import { buildApp, type AppDeps } from "./app";
import { party, signedCheckout } from "./test-helpers";

async function scenario(run: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const name = `poi_eval_${randomUUID().replace(/-/g, "")}`;
  const url = new URL(process.env.DATABASE_URL!);
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  const raw = new pg.Pool({ connectionString: url.toString() });
  let s: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    s = await setup(db, raw, url.toString());
    await run(s);
  } finally {
    await raw.end();
    // buildApp owns and closes its database pool. Only close it ourselves if setup never returned an app.
    if (s) await s.app.close();
    else await db.close();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}

async function setup(db: ReturnType<typeof createDb>, raw: pg.Pool, databaseUrl: string) {
  await db.migrate();
  const shopper = await party("shopper-key-1");
  const agent = await party("agent-key-1");
  const merchant = await generateSigningKeyPair();
  await raw.query("INSERT INTO shoppers (id, vault_id) VALUES ('eval-shopper', 'VAULT-EVAL')");
  await raw.query("INSERT INTO shopper_keys (kid, shopper_id, public_jwk) VALUES ($1, 'eval-shopper', $2)", [
    shopper.kid,
    shopper.publicJwk,
  ]);
  await raw.query(
    "INSERT INTO agent_keys (kid, platform, owner, public_jwk) VALUES ($1, 'Northstar', 'eval', $2)",
    [agent.kid, agent.publicJwk],
  );
  const paypal = createMockClient();
  const createOrder = vi.spyOn(paypal, "createOrder");
  const authorize = vi.spyOn(paypal, "authorizeOrder");
  const capture = vi.spyOn(paypal, "captureAuthorization");
  let clock = NOW;
  let fit: AppDeps["semanticFit"] = async (): Promise<SemanticFit> => ({
    fit: "match",
    confidence: 0.99,
    reasons: [],
    matched_attributes: [],
    conflicting_attributes: [],
  });
  const app = buildApp({
    db,
    paypal,
    merchant: { id: MERCHANT_ID, kid: "merchant-eval", privateKey: merchant.privateKey },
    now: () => clock,
    semanticFit: (...args) => fit!(...args),
  });
  const send = async (overrides: Partial<Parameters<typeof signedCheckout>[0]> = {}) => {
    const signed = await signedCheckout({ shopper, agent, ...overrides });
    const response = await app.inject({ method: "POST", url: "/checkout", payload: signed.body });
    return { signed, response, json: response.json() };
  };
  const approve = async (created: Awaited<ReturnType<typeof send>>) => {
    const approval_jws = await signMandate(
      {
        order_id: created.json.order_id,
        cart_mandate_hash: mandateHash(created.signed.cart),
        approved_at: clock,
      },
      shopper.privateKey,
      shopper.kid,
    );
    return app.inject({
      method: "POST",
      url: `/checkout/${created.json.order_id}/approve`,
      payload: { approval_jws },
    });
  };
  return {
    app,
    db,
    raw,
    databaseUrl,
    shopper,
    send,
    approve,
    createOrder,
    authorize,
    capture,
    setClock: (at: string) => {
      clock = at;
    },
    setFit: (next: AppDeps["semanticFit"]) => {
      fit = next;
    },
  };
}

describe.runIf(process.env.DATABASE_URL)("supplemental system eval", () => {
  afterEach(() => vi.unstubAllEnvs());
  test.each(["price", "title", "attributes"])(
    "product-fact manipulation (%s) is refused before AI or payment",
    async (field) => {
      await scenario(async (s) => {
        const line = {
          ...compliantCart.contents.lines[0]!,
          attributes: { ...compliantCart.contents.lines[0]!.attributes },
        };
        if (field === "price") line.unit_price = { value: 100, currency: "USD" };
        if (field === "title") line.title = "An unrelated product";
        if (field === "attributes") line.attributes.color = "blue";
        const fit = vi.fn(async (): Promise<SemanticFit> => ({
          fit: "match",
          confidence: 1,
          reasons: [],
          matched_attributes: [],
          conflicting_attributes: [],
        }));
        s.setFit(fit);
        const { json } = await s.send({
          cart: {
            ...compliantCart,
            contents: { ...compliantCart.contents, lines: [line], total: line.unit_price },
          },
        });
        expect(json.verdict.outcome).toBe("REJECT");
        expect(s.createOrder).not.toHaveBeenCalled();
        expect(fit).not.toHaveBeenCalled();
      });
    },
  );

  test("multi-order spending reserves one budget atomically across concurrent requests", async () => {
    await scenario(async (s) => {
      const intent = {
        ...greyJacketIntent,
        constraints: { ...greyJacketIntent.constraints, budget_cap: { value: 10000, currency: "USD" } },
      };
      const results = await Promise.all(
        [1, 2].map((n) =>
          s.send({
            intent,
            cart: { ...compliantCart, contents: { ...compliantCart.contents, cart_id: `eval-cart-${n}` } },
          }),
        ),
      );
      expect(results.map((r) => r.json.verdict.outcome).sort()).toEqual(["APPROVE", "REJECT"]);
      expect(s.createOrder).toHaveBeenCalledTimes(1);
      expect(s.capture).not.toHaveBeenCalled();
      expect((await s.raw.query("SELECT count(*)::int AS n FROM orders")).rows[0].n).toBe(1);
    });
  });

  test("expired authority creates no payment", async () => {
    await scenario(async (s) => {
      const { json } = await s.send({
        intent: { ...greyJacketIntent, intent_expiry: "2026-11-02T09:59:59Z" },
      });
      expect(json.verdict).toMatchObject({ outcome: "REJECT", reasons: ["MANDATE_EXPIRED"] });
      expect(s.createOrder).not.toHaveBeenCalled();
    });
  });

  test("provider failures on both J1 attempts require confirmation and create no unattended charge", async () => {
    await scenario(async (s) => {
      // Live transport must reserve against this migrated, isolated database, not the administrator database.
      vi.stubEnv("DATABASE_URL", s.databaseUrl);
      vi.stubEnv("AI_DAILY_CALL_LIMIT", "10");
      const network = vi.fn(async () =>
        Response.json({ error: { message: "provider unavailable" } }, { status: 503 }),
      ) as unknown as typeof fetch;
      const generate = createGenerate(
        {
          provider: "nvidia",
          model: "eval-model",
          apiKey: "test-only",
          baseURL: "https://provider.invalid/v1",
        },
        network,
      );
      s.setFit((words, cart) => semanticFit(words, cart, "live", { generate }));
      const { json } = await s.send({ humanPresent: false });
      expect(json.verdict.outcome).toBe("STEP_UP");
      expect(network).toHaveBeenCalledTimes(2);
      expect(s.createOrder).not.toHaveBeenCalled();
      expect(
        (await s.raw.query("SELECT count(*)::int AS n FROM orders WHERE capture_id IS NOT NULL")).rows[0].n,
      ).toBe(0);
    });
  });

  test("a human-present proposal is not a payment; signed approval captures once and persists the outcome", async () => {
    await scenario(async (s) => {
      const created = await s.send();
      expect(created.json.verdict.outcome).toBe("APPROVE");
      expect(s.capture).not.toHaveBeenCalled();
      const paid = await s.approve(created);
      expect(paid.json().status).toBe("CAPTURED");
      expect(paid.json().capture_id).toBeTruthy();
      await s.approve(created);
      expect(s.capture).toHaveBeenCalledTimes(1);
      expect(await s.db.getOrder(created.json.order_id)).toMatchObject({
        status: "CAPTURED",
        captureId: paid.json().capture_id,
      });
      expect((await s.db.mandateLedger(created.signed.intent.mandate_id)).capturedTotal).toBe(7400);
    });
  });

  test("explicit unattended authority completes a vaulted capture with a persisted capture ID", async () => {
    await scenario(async (s) => {
      const paid = await s.send({ humanPresent: false });
      expect(paid.json.capture_id).toBeTruthy();
      expect(paid.json.approval_url).toBeUndefined();
      expect(await s.db.getOrder(paid.json.order_id)).toMatchObject({
        status: "COMPLETED",
        captureId: paid.json.capture_id,
      });
      expect(s.createOrder).toHaveBeenCalledTimes(1);
    });
  });

  test("authority expiring between proposal and approval cannot capture", async () => {
    await scenario(async (s) => {
      const created = await s.send({
        intent: { ...greyJacketIntent, intent_expiry: "2026-11-02T10:01:00Z" },
      });
      s.setClock("2026-11-02T10:02:00Z");
      const result = await s.approve(created);
      expect(result.json()).toMatchObject({ status: "VOIDED", reasons: ["MANDATE_EXPIRED"] });
      expect(s.authorize).not.toHaveBeenCalled();
      expect(s.capture).not.toHaveBeenCalled();
    });
  });

  test("authority revoked after proposal cannot capture", async () => {
    await scenario(async (s) => {
      const created = await s.send();
      await s.db.retireKey("shopper", s.shopper.kid, NOW);
      s.setClock("2026-11-02T10:01:00Z");
      const refused = await s.approve(created);
      expect(refused.statusCode).toBe(403);
      expect(s.authorize).not.toHaveBeenCalled();
      expect(s.capture).not.toHaveBeenCalled();
    });
  });
});
