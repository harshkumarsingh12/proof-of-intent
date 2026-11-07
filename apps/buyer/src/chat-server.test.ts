import { MockLanguageModelV1 } from "ai/test";
import { describe, expect, test, vi } from "vitest";
import { handleChat, takeChatCall, type ChatDeps } from "./chat-server";
import { clientIp, createChatLimiter, createLimiter } from "./rate-limit";

const headers = (h: Record<string, string> = {}) => new Headers(h);
const body = (text: string, extra: object = {}) =>
  JSON.stringify({ messages: [{ role: "user", content: text }], ...extra });
const on = (extra: Record<string, string> = {}) =>
  ({ BUYER_CHAT: "1", AI_MODE: "replay", ...extra }) as NodeJS.ProcessEnv;
const send = (text: string, deps: ChatDeps = {}, h: Record<string, string> = {}) =>
  handleChat({ headers: headers(h), body: body(text) }, { env: on(), limiter: createChatLimiter(), ...deps });

const sayingModel = (text: string) =>
  new MockLanguageModelV1({
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
      text,
    }),
  });

describe("the switch and the shape of the request", () => {
  test("off unless BUYER_CHAT=1", async () => {
    for (const env of [{}, { BUYER_CHAT: "0" }, { BUYER_CHAT: "true" }] as NodeJS.ProcessEnv[]) {
      const res = await handleChat({ headers: headers(), body: body("hi") }, { env });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: "chat_disabled" });
    }
  });

  test("answers a store question from the store's data in replay mode", async () => {
    const res = await send("show me grey running jackets under $80");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "scripted" });
    expect((res.body as { text: string }).text).toContain("JKT-GRY-M");
  });

  test("a malformed, over-long, or wrongly shaped body is a 400 and costs nothing", async () => {
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        throw new Error("the model must not be called");
      },
    });
    const deps = { env: on({ AI_MODE: "live" }), limiter: createChatLimiter(), model };
    for (const raw of [
      "not json",
      "{}",
      JSON.stringify({ messages: [{ role: "assistant", content: "hi" }] }),
      JSON.stringify({ messages: [{ role: "user", content: "hi" }], intent_jws: "eyJ" }),
      JSON.stringify({ messages: [{ role: "user", content: "x".repeat(501) }] }),
      "x".repeat(9_000),
    ]) {
      const res = await handleChat({ headers: headers(), body: raw }, deps);
      expect(res.status, raw.slice(0, 40)).toBe(400);
    }
  });

  test("a pasted key, token or signed record is refused with a reason, before any model", async () => {
    const res = await send("here is my key nvapi-AbCdEf0123456789xyz why does it fail");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "sensitive_text" });
    expect((res.body as { message: string }).message).toMatch(/Don't paste those/);
  });
});

describe("rate limit and the daily cap", () => {
  test("a burst from one address is stopped with a 429 and a retry-after, and others are unaffected", async () => {
    const limiter = createChatLimiter(3, 100);
    const deps = { limiter, env: on() };
    const from = (ip: string) => send("show me socks", deps, { "cf-connecting-ip": ip });
    for (let i = 0; i < 3; i++) expect((await from("1.1.1.1")).status).toBe(200);
    const limited = await from("1.1.1.1");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers?.["retry-after"])).toBeGreaterThan(0);
    expect(limited.body).toMatchObject({ error: "rate_limited" });
    expect((await from("2.2.2.2")).status).toBe(200);
  });

  test("a spent daily chat cap still answers, from the store's data, and says so", async () => {
    const env = on({ AI_MODE: "live", BUYER_CHAT_DAILY_LIMIT: "0" });
    const model = new MockLanguageModelV1({
      doGenerate: async () => {
        throw new Error("the model must not be called past the cap");
      },
    });
    const res = await send("show me grey running jackets under $80", { env, model });
    expect(res.status).toBe(200);
    const out = res.body as { source: string; text: string; note: string };
    expect(out.source).toBe("scripted");
    expect(out.text).toContain("JKT-GRY-M");
    expect(out.note).toMatch(/today's limit/);
  });

  test("the daily cap counts per day and per process, with a default and an off switch", () => {
    const env = { BUYER_CHAT_DAILY_LIMIT: "2" } as NodeJS.ProcessEnv;
    const day = new Date("2031-05-01T10:00:00Z");
    expect([takeChatCall(env, day), takeChatCall(env, day), takeChatCall(env, day)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(takeChatCall(env, new Date("2031-05-02T00:00:01Z"))).toBe(true);
    expect(
      takeChatCall({ BUYER_CHAT_DAILY_LIMIT: "0" } as NodeJS.ProcessEnv, new Date("2031-06-01T00:00:00Z")),
    ).toBe(false);
    const dflt = new Date("2031-07-01T00:00:00Z");
    expect(
      Array.from({ length: 150 }, () => takeChatCall({} as NodeJS.ProcessEnv, dflt)).every(Boolean),
    ).toBe(true);
    expect(takeChatCall({} as NodeJS.ProcessEnv, dflt)).toBe(false);
  });
});

describe("live answers", () => {
  const live = on({ AI_MODE: "live", BUYER_CHAT_DAILY_LIMIT: "50" });

  test("a grounded model answer is returned as live; an invented price is replaced and flagged", async () => {
    const good = await send("show me grey running jackets under $80", {
      env: live,
      model: sayingModel("The Stride Running Jacket (JKT-GRY-M) is $74.00."),
    });
    expect(good.body).toMatchObject({ source: "live" });
    const invented = await send("show me grey running jackets under $80", {
      env: live,
      model: sayingModel("Everything is $1."),
    });
    expect(invented.body).toMatchObject({ source: "guard" });
    expect((invented.body as { text: string }).text).toContain("$74.00");
  });

  test("sends only the limits to the model as context, never ids or wallet state, and never calls it for a verdict", async () => {
    const prompts: string[] = [];
    const model = new MockLanguageModelV1({
      doGenerate: async (params) => {
        prompts.push(JSON.stringify(params.prompt));
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1 },
          text: "Your limit is $80 for running jackets.",
        };
      },
    });
    const context = {
      limits: {
        maxPrice: "80",
        category: "running-jacket",
        color: "grey",
        validDays: 7,
        confirmEachCart: false,
      },
      lastVerdict: { outcome: "REJECT", reasons: ["AMOUNT_EXCEEDS_MAX"] },
    };
    const deps = { env: live, limiter: createChatLimiter(), model };
    const asked = await handleChat(
      { headers: headers(), body: body("what do my limits mean for grey jackets?", { context }) },
      deps,
    );
    expect(asked.status).toBe(200);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Running jackets");
    // Identifiers and wallet state only: the shop's own sentence "no PayPal order was created" is fine.
    expect(prompts[0]).not.toMatch(/eyJ|ord_|paypal_|vault|wallet/i);

    // What the merchant decided about the shopper's money is the fixed text: the model isn't asked at all.
    const refused = await handleChat(
      { headers: headers(), body: body("why was it refused?", { context }) },
      { ...deps, limiter: createChatLimiter() },
    );
    expect(prompts).toHaveLength(1);
    expect(refused.body).toMatchObject({ source: "scripted" });
    expect((refused.body as { text: string }).text).toContain("nothing was charged");
  });

  test("an unreadable AI_MODE degrades to the plain answer instead of failing the request", async () => {
    const res = await send("show me socks", { env: on({ AI_MODE: "bogus" }) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "scripted" });
  });
});

describe("the limiter", () => {
  test("allows the window's quota, then waits, then frees up as old hits age out", () => {
    const limiter = createLimiter({ windowMs: 1_000, max: 2 });
    expect(limiter.hit("a", 0).ok).toBe(true);
    expect(limiter.hit("a", 100).ok).toBe(true);
    const blocked = limiter.hit("a", 200);
    expect(blocked).toEqual({ ok: false, retryAfterS: 1 });
    expect(limiter.hit("b", 200).ok).toBe(true);
    expect(limiter.hit("a", 1_001).ok).toBe(true); // the first hit has aged out
    expect(limiter.hit("a", 1_002).ok).toBe(false);
  });

  test("a short burst limit and a long steady limit both apply", () => {
    const limiter = createChatLimiter(2, 3);
    expect(limiter.hit("a", 0).ok).toBe(true);
    expect(limiter.hit("a", 1).ok).toBe(true);
    expect(limiter.hit("a", 2).ok).toBe(false); // over the minute limit
    expect(limiter.hit("a", 61_000).ok).toBe(true); // a new minute, third in the hour
    expect(limiter.hit("a", 122_000).ok).toBe(false); // over the hour limit
  });

  test("the client address is Cloudflare's, else the first forwarded one, else unknown", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }))).toBe(
      "9.9.9.9",
    );
    expect(clientIp(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(headers())).toBe("unknown");
  });

  test("a quiet address is forgotten, so the table can't grow forever", () => {
    const limiter = createLimiter({ windowMs: 10, max: 1 });
    for (let i = 0; i < 5_100; i++) limiter.hit(`ip-${i}`, i % 3 === 0 ? 0 : 1);
    expect(limiter.hit("fresh", 100).ok).toBe(true);
    vi.useRealTimers();
  });
});
