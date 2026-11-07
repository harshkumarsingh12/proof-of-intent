import { MockLanguageModelV1 } from "ai/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { IntentMandate } from "@poi/contracts";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { evaluate } from "@poi/policy-engine";
import {
  AgentUnavailableError,
  FALLBACK_MAX_PRICE_USD,
  MAX_CHECKOUTS,
  chooseTools,
  defaultMaxPriceUsd,
  draftIntent,
  limitBreaks,
  limitsOf,
  draftTools,
  fallbackFromEnv,
  isFailoverError,
  isModelUnavailableError,
  parseAgentMode,
  providerOptionsFor,
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
  withFallback,
  type RunContext,
} from "./agent";
// The buyer keeps its own copy of the provider rules (it doesn't depend on packages/ai); these tests keep them identical.
import {
  fallbackFromEnv as sharedFallbackFromEnv,
  isFailoverError as sharedIsFailoverError,
  isModelUnavailableError as sharedIsModelUnavailableError,
  providerOptionsFor as sharedProviderOptionsFor,
} from "../../../packages/ai/src/runtime";
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

/** A model that calls `calls` in turn, then answers with `text`. */
const scriptedModel = (calls: { name: string; args: unknown }[], text = "Proposed the grey jacket.") => {
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

  test("once the merchant accepts a cart, no second cart is proposed (alone, the first already charged)", async () => {
    const stepUp = { status: 200, body: { verdict: { outcome: "STEP_UP" as const, reasons: [] } } };
    for (const first of [approve, stepUp]) {
      let calls = 0;
      const ctx = ctxWith(async () => (calls++, first));
      await requestCheckout(ctx, CATALOG[0]!.line.sku);
      expect(await requestCheckout(ctx, CATALOG[1]!.line.sku)).toMatchObject({ error: "already_proposed" });
      expect(calls).toBe(1);
    }
  });

  test("a refusal doesn't stop the agent trying a better cart", async () => {
    let calls = 0;
    const ctx = ctxWith(async () => (calls++ === 0 ? reject : approve));
    await requestCheckout(ctx, CATALOG[0]!.line.sku);
    expect(await requestCheckout(ctx, CATALOG[1]!.line.sku)).toMatchObject({ outcome: "APPROVE" });
    expect(calls).toBe(2);
  });

  test("a merchant error is reported as a failure, not as a verdict", async () => {
    const ctx = ctxWith(async () => ({
      status: 502,
      body: { error: "paypal_unavailable", message: "down" },
    }));
    expect(await requestCheckout(ctx, CATALOG[0]!.line.sku)).toMatchObject({ error: "checkout_failed" });
  });
});

describe("agent trace and shopper-owned settings", () => {
  test("the draft tool can't turn 'confirm every cart' on or off", () => {
    const draft = draftIntent({
      description: "grey running jacket",
      max_price_usd: 80,
      category: "running-jacket",
      color: "grey",
      // @ts-expect-error not an argument any more; a model that sends it is ignored
      confirm_each_cart: true,
    });
    expect(draft.form.confirmEachCart).toBe(false);
  });

  test("request_checkout records the reason, cleaned and with no personal details", async () => {
    const ctx: RunContext = { checkout: async () => reject, attempts: [], trace: [] };
    await requestCheckout(ctx, "JKT-GRY-M", "Fits\n  your budget; mail jo@example.com   now");
    expect(ctx.trace).toEqual([
      expect.objectContaining({
        kind: "propose",
        sku: "JKT-GRY-M",
        outcome: "REJECT",
        reasons: ["AMOUNT_EXCEEDS_MAX"],
        reason: "Fits your budget; mail [email] now",
      }),
    ]);
    const long = "x".repeat(1000);
    await requestCheckout(ctx, "JKT-GRY-M", long);
    expect((ctx.trace![1] as { reason: string }).reason).toHaveLength(240);
  });

  test("a scripted run explains itself: one search, then each cart with the merchant's answer", async () => {
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "replay",
      checkout: async () => approve,
    });
    expect(run.trace.map((t) => t.kind)).toEqual(["search", "propose"]);
    expect(run.trace[1]).toMatchObject({ outcome: "APPROVE" });
  });

  test("a live run's trace holds the search and the proposal with the model's reason", async () => {
    const run = await runChoose({
      intent: presetIntent("socks"),
      mode: "live",
      checkout: async () => approve,
      model: scriptedModel([
        { name: "search_catalog", args: { category: "socks" } },
        { name: "request_checkout", args: { sku: "SOK-3PK-WHT", reason: "White, a 3-pack, under $20." } },
      ]),
    });
    expect(run.trace).toEqual([
      { kind: "search", query: { category: "socks" }, found: expect.any(Number) },
      expect.objectContaining({ kind: "propose", sku: "SOK-3PK-WHT", reason: "White, a 3-pack, under $20." }),
    ]);
  });
});

describe("the agent checks the signed limits before asking the merchant", () => {
  const jacketIntent = presetIntent("running-jacket"); // grey, max $80
  const product = (sku: string) => CATALOG.find((p) => p.line.sku === sku)!;

  test("it names every signed limit a product breaks", () => {
    const limits = limitsOf(jacketIntent);
    expect(limitBreaks(limits, product("JKT-GRY-M"))).toEqual([]);
    expect(limitBreaks(limits, product("JKT-RED-M"))).toEqual([
      "price is over the signed maximum",
      "color is not grey",
    ]);
    expect(limitBreaks(limits, product("SOK-3PK-WHT"))).toContain("category is not running-jacket");
  });

  test("a product outside the limits never reaches the merchant, even if the shopper's words ask for it", async () => {
    let calls = 0;
    const ctx: RunContext = {
      checkout: async () => (calls++, approve),
      attempts: [],
      trace: [],
      limits: limitsOf(jacketIntent),
    };
    const out = await requestCheckout(ctx, "JKT-RED-M", "The shopper said the red one.");
    expect(out).toMatchObject({ error: "outside_signed_limits" });
    expect(calls).toBe(0);
    expect(ctx.attempts).toEqual([]);
    expect(ctx.trace).toEqual([expect.objectContaining({ sku: "JKT-RED-M", outcome: "OUT_OF_LIMITS" })]);
  });

  test("a live model that goes for the red jacket is stopped and the run ends with no cart sent", async () => {
    let calls = 0;
    const run = await runChoose({
      intent: jacketIntent,
      mode: "live",
      checkout: async () => (calls++, approve),
      model: scriptedModel([
        { name: "request_checkout", args: { sku: "JKT-RED-M", reason: "They asked for red." } },
      ]),
    });
    expect(calls).toBe(0);
    expect(run.attempts).toEqual([]);
    expect(run.trace).toEqual([expect.objectContaining({ outcome: "OUT_OF_LIMITS" })]);
  });

  test("blocked carts don't use up the three carts the merchant is asked about", async () => {
    const ctx: RunContext = {
      checkout: async () => approve,
      attempts: [],
      trace: [],
      limits: limitsOf(jacketIntent),
    };
    for (let i = 0; i < 5; i++) await requestCheckout(ctx, "JKT-RED-M");
    expect(await requestCheckout(ctx, "JKT-GRY-M", "Fits.")).toMatchObject({ outcome: "APPROVE" });
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
  });

  test("what the words don't say stays open, and a missing price gets a proposed cap", () => {
    // No price: the usual cap for that item (the demo preset's), and the draft says it was proposed.
    const noPrice = scriptedDraft("a grey running jacket");
    expect(noPrice.form).toMatchObject({ maxPrice: "80", category: "running-jacket", color: "grey" });
    expect(noPrice.priceDefaulted).toBe(true);
    // A stated price is never replaced.
    expect(scriptedDraft("a grey running jacket under $55").priceDefaulted).toBeUndefined();
    // No color or no item: left open, not guessed.
    expect(scriptedDraft("a running jacket under $80").form).toMatchObject({ category: "running-jacket", color: "" });
    expect(scriptedDraft("something grey under $80").form).toMatchObject({ category: "", color: "grey", maxPrice: "80" });
    // Nothing stated at all: it still fills a form (the fallback cap, anything, any color) instead of refusing.
    const nothing = scriptedDraft("surprise me");
    expect(nothing.form).toMatchObject({ maxPrice: String(FALLBACK_MAX_PRICE_USD), category: "", color: "" });
    expect(nothing.priceDefaulted).toBe(true);
    expect(() => intentFor(nothing.form)).not.toThrow();
  });

  test("the proposed cap is the item's usual cap, or the fallback with no item", () => {
    expect(defaultMaxPriceUsd("socks")).toBe(20);
    expect(defaultMaxPriceUsd("running-shoe")).toBe(130);
    expect(defaultMaxPriceUsd(undefined)).toBe(FALLBACK_MAX_PRICE_USD);
    expect(defaultMaxPriceUsd("not-a-category")).toBe(FALLBACK_MAX_PRICE_USD);
  });

  test("a model draft that names only an item still gets a cap, and an unknown item is still refused", () => {
    expect(draftIntent({ description: "socks", category: "socks" }).form).toMatchObject({
      maxPrice: "20",
      category: "socks",
      color: "",
    });
    expect(() => draftIntent({ description: "x", category: "tent" as never })).toThrow();
  });
});

describe("live agent (scripted model, no network)", () => {
  test("the model searches, proposes, and the merchant's answer comes back", async () => {
    const seen: string[] = [];
    const run = await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "live",
      checkout: async (sku) => (seen.push(sku), approve),
      model: scriptedModel([
        { name: "search_catalog", args: { category: "running-jacket", color: "grey", max_price_usd: 80 } },
        { name: "request_checkout", args: { sku: "JKT-GRY-M", reason: "fits" } },
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
      model: scriptedModel([{ name: "request_checkout", args: { sku: "FREE-STUFF", reason: "free" } }]),
    });
    expect(calls).toBe(0);
    expect(run.attempts).toEqual([]);
  });

  test("a model that keeps proposing is cut off at the cart limit", async () => {
    let calls = 0;
    const many = Array.from({ length: 5 }, () => ({
      name: "request_checkout",
      args: { sku: "JKT-GRY-M", reason: "r" },
    }));
    await runChoose({
      intent: presetIntent("running-jacket"),
      mode: "live",
      checkout: async () => (calls++, reject),
      model: scriptedModel(many),
    });
    expect(calls).toBeLessThanOrEqual(MAX_CHECKOUTS);
  });

  test("the scripted trace names only the limits that were signed", async () => {
    const reasonFor = async (form: Partial<IntentForm>) => {
      const run = await runChoose({
        intent: intentFor({
          description: "a running jacket",
          maxPrice: "100",
          category: "running-jacket",
          color: "grey",
          validDays: 7,
          confirmEachCart: false,
          ...form,
        }),
        mode: "replay",
        checkout: async () => approve,
      });
      return (run.trace.find((t) => t.kind === "propose") as { reason: string }).reason;
    };
    expect(await reasonFor({})).toBe("Best word match inside your signed price, category and color.");
    expect(await reasonFor({ color: "" })).toBe("Best word match inside your signed price and category.");
    expect(await reasonFor({ category: "", color: "" })).toBe("Best word match inside your signed price.");
  });

  test("the draft tool fills the form and never signs", async () => {
    const out = await runDraft({
      text: "grey running jacket under $80",
      mode: "live",
      model: scriptedModel([
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

describe("provider rules (copy of packages/ai)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const okModel = (record?: (params: unknown) => void) =>
    new MockLanguageModelV1({
      doGenerate: async (params) => {
        record?.(params);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 },
          text: "ok",
        };
      },
    });

  test("the live chooser is told an open limit means anything, instead of seeing a missing field", async () => {
    const seen: unknown[] = [];
    await runChoose({
      intent: intentFor({
        description: "a running jacket",
        maxPrice: "100",
        category: "running-jacket",
        color: "",
        validDays: 7,
        confirmEachCart: false,
      }),
      mode: "live",
      checkout: async () => approve,
      model: okModel((params) => seen.push(params)),
    }).catch(() => undefined);
    const text = JSON.stringify(seen[0]);
    expect(text).toMatch(/color\\+":\s*\\+"any/);
    expect(text).toMatch(/means the shopper left it open/);
  });

  test("the drafting prompt asks only for what the shopper stated", async () => {
    const seen: unknown[] = [];
    await runDraft({ text: "a jacket", mode: "live", model: okModel((params) => seen.push(params)) }).catch(
      () => undefined,
    );
    const text = JSON.stringify(seen[0]);
    expect(text).toMatch(/Set only what the shopper actually stated/);
    expect(text).not.toMatch(/Pick the closest/);
  });

  test("the thinking switch and the gone-model rule match packages/ai exactly", () => {
    for (const provider of ["nvidia", "gemini", "groq", "openrouter", "other"])
      expect(providerOptionsFor(provider)).toEqual(sharedProviderOptionsFor(provider));
    for (const err of [
      Object.assign(new Error("x"), { statusCode: 404 }),
      Object.assign(new Error("x"), { statusCode: 410 }),
      Object.assign(new Error("x"), { statusCode: 429 }),
      new Error("The model `m` does not exist"),
      new Error("invalid api key"),
      new Error("The operation was aborted due to timeout"),
      undefined,
    ])
      expect(isModelUnavailableError(err)).toBe(sharedIsModelUnavailableError(err));
  });

  test("what counts as a failover, and how the backup is read from the environment, match packages/ai exactly", () => {
    for (const err of [
      ...[400, 401, 403, 404, 408, 410, 422, 429, 500, 503].map((statusCode) =>
        Object.assign(new Error(`HTTP ${statusCode}`), { statusCode }),
      ),
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      new Error("fetch failed"),
      new Error("getaddrinfo EAI_AGAIN host"),
      new Error("invalid api key"),
      new Error("No object generated"),
      undefined,
    ])
      expect(isFailoverError(err)).toBe(sharedIsFailoverError(err));

    const primary = { provider: "nvidia", model: "m-1", apiKey: "key", baseURL: "https://nv.test/v1" };
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const env of [
      {},
      { AI_FALLBACK_MODEL: "m-2" },
      { AI_FALLBACK_MODEL: "m-1" },
      { AI_FALLBACK_PROVIDER: "groq", AI_FALLBACK_MODEL: "g-1", AI_FALLBACK_API_KEY: "gsk" },
      { AI_FALLBACK_PROVIDER: "groq", AI_FALLBACK_MODEL: "g-1" },
      { AI_FALLBACK_PROVIDER: "groq", AI_FALLBACK_API_KEY: "gsk" },
      { AI_FALLBACK_PROVIDER: "other", AI_FALLBACK_MODEL: "x", AI_FALLBACK_API_KEY: "k" },
      {
        AI_FALLBACK_PROVIDER: "other",
        AI_FALLBACK_MODEL: "x",
        AI_FALLBACK_API_KEY: "k",
        AI_FALLBACK_BASE_URL: "https://o.test/v1",
      },
    ] as NodeJS.ProcessEnv[])
      expect(fallbackFromEnv(env, primary)).toEqual(sharedFallbackFromEnv(env, primary));
    quiet.mockRestore();
  });

  test("the agent's model call carries the thinking switch for nvidia and nothing for another provider", async () => {
    const seen: Record<string, unknown>[] = [];
    const record = (params: unknown) => seen.push(params as Record<string, unknown>);
    vi.stubEnv("AI_PROVIDER", "nvidia");
    await runDraft({ text: "x", mode: "live", model: okModel(record) }).catch(() => undefined);
    vi.stubEnv("AI_PROVIDER", "groq");
    await runDraft({ text: "x", mode: "live", model: okModel(record) }).catch(() => undefined);
    expect(seen[0]?.providerMetadata).toEqual({
      nvidia: { chat_template_kwargs: { enable_thinking: false } },
    });
    expect(seen.at(-1)?.providerMetadata).toBeUndefined();
  });

  test("a primary that fails in a way a backup can fix is answered by the backup, once; other failures surface", async () => {
    const calls: string[] = [];
    const model = (name: string, fail?: unknown) =>
      new MockLanguageModelV1({
        modelId: name,
        doGenerate: async () => {
          calls.push(name);
          if (fail) throw fail;
          return {
            rawCall: { rawPrompt: null, rawSettings: {} },
            finishReason: "stop" as const,
            usage: { promptTokens: 1, completionTokens: 1 },
            text: name,
          };
        },
      });
    const http = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
    const params = { inputFormat: "prompt", mode: { type: "regular" }, prompt: [] } as never;

    for (const fail of [http(404), http(429), http(503), new Error("fetch failed")]) {
      calls.length = 0;
      const withBackup = withFallback(model("primary", fail), model("backup"));
      expect((await withBackup.doGenerate(params)).text).toBe("backup");
      expect(calls).toEqual(["primary", "backup"]);
    }

    // A bad key or a rejected request is not hidden by the backup.
    for (const fail of [http(400), http(401), http(403)]) {
      calls.length = 0;
      await expect(withFallback(model("primary", fail), model("backup")).doGenerate(params)).rejects.toThrow(
        /HTTP/,
      );
      expect(calls).toEqual(["primary"]);
    }

    // No backup configured: the very same model comes back, untouched.
    const only = model("only");
    expect(withFallback(only)).toBe(only);
  });
});
