import { MockLanguageModelV1 } from "ai/test";
import { describe, expect, test } from "vitest";
import type { IntentMandate } from "@poi/contracts";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { evaluate } from "@poi/policy-engine";
import {
  AgentUnavailableError,
  MAX_CHECKOUTS,
  chooseTools,
  draftIntent,
  draftTools,
  parseAgentMode,
  redact,
  requestCheckout,
  runChoose,
  runDraft,
  scriptedDraft,
  scriptedPicks,
  searchCatalog,
  takeModelCall,
  toolNames,
  withBudget,
  type RunContext,
} from "./agent";
import { proposeCart } from "./cart";
import { CATALOG, PRESETS } from "./catalog";
import { buildIntent, type IntentForm } from "./intent";

const intentFor = (form: IntentForm): IntentMandate =>
  buildIntent(form, {
    kid: "shp_test",
    merchantId: MERCHANT_ID,
    now: new Date(NOW),
    mandateId: "0192f0a0-0000-7000-8000-000000000001",
    nonce: "n".repeat(16),
  });

const presetIntent = (category: string): IntentMandate => {
  const p = PRESETS.find((x) => x.category === category)!;
  return intentFor({
    description: p.description,
    maxPrice: String(p.amountMax.value / 100),
    category: p.category,
    color: p.color,
    validDays: 7,
    confirmEachCart: false,
  });
};

const approve = { status: 200, body: { verdict: { outcome: "APPROVE", reasons: [] } } };
const reject = { status: 200, body: { verdict: { outcome: "REJECT", reasons: ["AMOUNT_EXCEEDS_MAX"] } } };

const ctxWith = (checkout: RunContext["checkout"]): RunContext => ({ checkout, attempts: [] });

describe("buyer agent tools (#37)", () => {
  test("the agent has exactly three tools and no PayPal credentials among them", () => {
    expect(toolNames).toEqual(["create_intent_mandate", "search_catalog", "request_checkout"]);
    const have = [...Object.keys(chooseTools(ctxWith(async () => approve))), ...Object.keys(draftTools({}))];
    expect(have.sort()).toEqual([...toolNames].sort());
  });

  test("search_catalog filters by category, color and price, then ranks by the words", () => {
    const hits = searchCatalog({ category: "running-jacket", color: "grey", max_price_usd: 80 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(h.category).toBe("running-jacket");
      expect(h.color).toBe("grey");
      expect(h.price_cents).toBeLessThanOrEqual(8000);
    }
    expect(searchCatalog({ max_price_usd: 1 })).toEqual([]);
    const ranked = searchCatalog({ category: "base-layer", query: "merino wool" });
    expect(ranked[0]?.sku).toBe("BSL-MER-GRY-M");
  });

  test("create_intent_mandate only drafts: the result says it is unsigned and the form passes the intent rules", () => {
    const draft = draftIntent({
      description: "Grey running jacket under $80",
      max_price_usd: 79.5,
      category: "running-jacket",
      color: "grey",
    });
    expect(draft.signed).toBe(false);
    expect(draft.form.maxPrice).toBe("79.50");
    expect(() => intentFor(draft.form)).not.toThrow();
    expect(() =>
      draftIntent({ description: "x", max_price_usd: 10, category: "tent", color: "grey" }),
    ).toThrow();
    expect(() =>
      draftIntent({ description: "x", max_price_usd: -5, category: "socks", color: "white" }),
    ).toThrow();
  });

  test("request_checkout sends the SKU to the merchant and shows the model only the outcome and codes", async () => {
    const ctx = ctxWith(async () => ({
      status: 200,
      body: {
        verdict: { outcome: "APPROVE", reasons: [] },
        cart_mandate_jws: "SECRET.JWS.BYTES",
        order_id: "ord_1",
      },
    }));
    const out = await requestCheckout(ctx, CATALOG[0]!.line.sku);
    expect(out).toMatchObject({ outcome: "APPROVE", reasons: [] });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|ord_1/);
    expect(ctx.attempts).toHaveLength(1);
  });

  test("request_checkout refuses SKUs the store doesn't sell without calling the merchant", async () => {
    let calls = 0;
    const ctx = ctxWith(async () => (calls++, approve));
    expect(await requestCheckout(ctx, "NOT-A-SKU")).toMatchObject({ error: "unknown_sku" });
    expect(calls).toBe(0);
  });

  test("request_checkout stops after the cart limit", async () => {
    let calls = 0;
    const ctx = ctxWith(async () => (calls++, reject));
    for (let i = 0; i < MAX_CHECKOUTS + 2; i++) await requestCheckout(ctx, CATALOG[0]!.line.sku);
    expect(calls).toBe(MAX_CHECKOUTS);
    expect(await requestCheckout(ctx, CATALOG[0]!.line.sku)).toMatchObject({ error: "checkout_limit" });
  });

  test("a merchant error is reported as a failure, not as a verdict", async () => {
    const ctx = ctxWith(async () => ({
      status: 502,
      body: { error: "paypal_unavailable", message: "down" },
    }));
    expect(await requestCheckout(ctx, CATALOG[0]!.line.sku)).toMatchObject({ error: "checkout_failed" });
  });
});

describe("scripted agent (AI_MODE=replay)", () => {
  test("for every demo preset its first pick passes the hard rules", () => {
    for (const preset of PRESETS) {
      const intent = presetIntent(preset.category);
      const [sku] = scriptedPicks(intent);
      expect(sku, preset.category).toBeDefined();
      const cart = proposeCart(intent, sku!, {
        merchant: { id: MERCHANT_ID, name: "Trailhead Outfitters" },
        now: new Date(NOW),
        cartId: "cart_test",
      });
      expect(evaluate({ intent, cart, now: NOW }).reasons, `${preset.category} → ${sku}`).toEqual([]);
    }
  });

  test("it stops at the first cart the merchant doesn't refuse", async () => {
    const seen: string[] = [];
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "replay",
      checkout: async (sku) => (seen.push(sku), approve),
    });
    expect(run.source).toBe("scripted");
    expect(seen).toHaveLength(1);
    expect(run.attempts).toHaveLength(1);
  });

  test("after a refusal it tries the next best cart, at most three", async () => {
    const seen: string[] = [];
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "replay",
      checkout: async (sku) => (seen.push(sku), reject),
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.length).toBeLessThanOrEqual(MAX_CHECKOUTS);
    expect(new Set(seen).size).toBe(seen.length);
    expect(run.attempts).toHaveLength(seen.length);
  });

  test("it proposes nothing when no product fits the limits", async () => {
    const intent = intentFor({
      description: "grey running jacket",
      maxPrice: "5",
      category: "running-jacket",
      color: "grey",
      validDays: 7,
      confirmEachCart: false,
    });
    const run = await runChoose({ intent, mode: "replay", checkout: async () => approve });
    expect(run.attempts).toEqual([]);
  });

  test("the drafter reads price, color and category from the shopper's words", () => {
    const draft = scriptedDraft("I want a grey running jacket under $80 please");
    expect(draft.signed).toBe(false);
    expect(draft.form).toMatchObject({ maxPrice: "80", category: "running-jacket", color: "grey" });
    expect(scriptedDraft("white socks, at most 15.50 dollars").form).toMatchObject({
      maxPrice: "15.50",
      category: "socks",
      color: "white",
    });
    expect(() => scriptedDraft("a grey running jacket")).toThrow(/spend/);
    expect(() => scriptedDraft("a running jacket under $80")).toThrow(/color/);
    expect(() => scriptedDraft("something grey under $80")).toThrow(/kind of item/);
  });
});

describe("live agent (scripted model, no network)", () => {
  /** A model that calls `calls` in turn, then answers with `text`. */
  const model = (calls: { name: string; args: unknown }[], text = "Proposed the grey jacket.") => {
    let turn = 0;
    return new MockLanguageModelV1({
      doGenerate: async () => {
        const call = calls[turn++];
        const usage = { promptTokens: 1, completionTokens: 1 };
        return call
          ? {
              rawCall: { rawPrompt: null, rawSettings: {} },
              finishReason: "tool-calls" as const,
              usage,
              toolCalls: [
                {
                  toolCallType: "function" as const,
                  toolCallId: `call_${turn}`,
                  toolName: call.name,
                  args: JSON.stringify(call.args),
                },
              ],
            }
          : { rawCall: { rawPrompt: null, rawSettings: {} }, finishReason: "stop" as const, usage, text };
      },
    });
  };

  test("the model searches, proposes, and the merchant's answer comes back", async () => {
    const seen: string[] = [];
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "live",
      checkout: async (sku) => (seen.push(sku), approve),
      model: model([
        { name: "search_catalog", args: { category: "running-jacket", color: "grey", max_price_usd: 80 } },
        { name: "request_checkout", args: { sku: "JKT-GRY-M" } },
      ]),
    });
    expect(run.source).toBe("live");
    expect(run.message).toBe("Proposed the grey jacket.");
    expect(run.attempts.map((a) => a.sku)).toEqual(seen);
    expect(seen).toHaveLength(1);
  });

  test("a model that proposes something the store doesn't sell reaches no merchant call", async () => {
    let calls = 0;
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "live",
      checkout: async () => (calls++, approve),
      model: model([{ name: "request_checkout", args: { sku: "FREE-STUFF" } }]),
    });
    expect(calls).toBe(0);
    expect(run.attempts).toEqual([]);
  });

  test("a model that keeps proposing is cut off at the cart limit", async () => {
    let calls = 0;
    const many = Array.from({ length: 5 }, () => ({ name: "request_checkout", args: { sku: "JKT-GRY-M" } }));
    await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "live",
      checkout: async () => (calls++, reject),
      model: model(many),
    });
    expect(calls).toBeLessThanOrEqual(MAX_CHECKOUTS);
  });

  test("the draft tool fills the form and never signs", async () => {
    const out = await runDraft({
      text: "grey running jacket under $80",
      mode: "live",
      model: model([
        {
          name: "create_intent_mandate",
          args: {
            description: "grey running jacket",
            max_price_usd: 80,
            category: "running-jacket",
            color: "grey",
          },
        },
      ]),
    });
    expect(out.source).toBe("live");
    expect(out.draft.signed).toBe(false);
    expect(out.draft.form.maxPrice).toBe("80");
  });

  test("a failing model becomes 'the agent is unavailable', not a crash or a made-up cart", async () => {
    const broken = new MockLanguageModelV1({
      doGenerate: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      runChoose({
        intent: presetIntent("socks"),
        mode: "live",
        checkout: async () => approve,
        model: broken,
      }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  test("live mode without a key is unavailable", async () => {
    const saved = { ...process.env };
    delete process.env.AI_MODEL;
    delete process.env.AI_API_KEY;
    try {
      await expect(
        runChoose({ intent: presetIntent("socks"), mode: "live", checkout: async () => approve }),
      ).rejects.toBeInstanceOf(AgentUnavailableError);
    } finally {
      process.env = saved;
    }
  });
});

describe("model hygiene", () => {
  test("the daily budget turns the agent off", () => {
    const env = { AI_DAILY_CALL_LIMIT: "2" } as NodeJS.ProcessEnv;
    const day = new Date("2031-01-01T00:00:00Z");
    takeModelCall(env, day);
    takeModelCall(env, day);
    expect(() => takeModelCall(env, day)).toThrow(AgentUnavailableError);
    expect(() => takeModelCall(env, new Date("2031-01-02T00:00:00Z"))).not.toThrow();
  });

  test("every model call is counted against the budget", async () => {
    let taken = 0;
    const counted = withBudget(
      new MockLanguageModelV1({
        doGenerate: async () => ({
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 },
          text: "ok",
        }),
      }),
      () => void taken++,
    );
    await runDraft({ text: "x", mode: "live", model: counted }).catch(() => undefined);
    expect(taken).toBeGreaterThan(0);
  });

  test("emails and phone numbers are stripped before the model sees the shopper's words", () => {
    expect(redact("grey jacket, mail me at jo@example.com or +1 (555) 123-4567")).toBe(
      "grey jacket, mail me at [email] or [number]",
    );
  });

  test("AI_MODE parses like the rest of the stack", () => {
    expect(parseAgentMode(undefined)).toBe("replay");
    expect(parseAgentMode("live")).toBe("live");
    expect(() => parseAgentMode("mock")).toThrow();
  });
});
