import { randomUUID } from "node:crypto";
import { MockLanguageModelV1 } from "ai/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import pg from "pg";
import { closeUsageStores, createOperation } from "@poi/ai-transport";
import { createDb, type Db } from "@poi/db";
import { compliantCart, greyJacketIntent } from "@poi/contracts/fixtures";
import { semanticFit, AiUnavailableError } from "../../../packages/ai/src/index";
import { createGenerate, liveConfigFromEnv } from "../../../packages/ai/src/runtime";
import { AgentUnavailableError, runChoose, runDraft } from "./agent";
import { handleChat } from "./chat-server";
import { createChatLimiter } from "./rate-limit";

test("the complete buyer job bounds a non-cooperative injected model", async () => {
  const model = new MockLanguageModelV1({ doGenerate: async () => new Promise<never>(() => {}) });
  const operation = createOperation("buyer.draft", { timeoutMs: 100 });
  await expect(
    runDraft({ text: "a grey jacket under $80", mode: "live", model, operation }),
  ).rejects.toBeInstanceOf(AgentUnavailableError);
});

const adminUrl = process.env.DATABASE_URL;
describe.runIf(adminUrl)("buyer and AI jobs share persistent limits", () => {
  const name = `poi_shared_${randomUUID().replace(/-/g, "")}`;
  const url = new URL(adminUrl ?? "postgres://localhost/unused");
  url.pathname = `/${name}`;
  let db: Db;
  let raw: pg.Pool;
  const requests: string[] = [];
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    db = createDb(url.toString());
    await db.migrate();
    raw = new pg.Pool({ connectionString: url.toString() });
  });
  beforeEach(() => {
    requests.length = 0;
    for (const [key, value] of Object.entries({
      DATABASE_URL: url.toString(),
      MERCHANT_ID: `merchant-${randomUUID()}`,
      AI_PROVIDER: "nvidia",
      AI_MODEL: "test-model",
      AI_API_KEY: "test-only",
      AI_BASE_URL: "https://provider.invalid/v1",
      AI_DAILY_CALL_LIMIT: "2",
      BUYER_CHAT_DAILY_LIMIT: "1",
      AI_FALLBACK_MODEL: "",
      AI_FALLBACK_PROVIDER: "",
      AI_FALLBACK_API_KEY: "",
      AI_FALLBACK_BASE_URL: "",
    }))
      vi.stubEnv(key, value);
    vi.stubGlobal("fetch", (async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const toolName = body.tools?.[0]?.function?.name ?? "text";
      requests.push(toolName);
      const args =
        toolName === "json"
          ? { fit: "match", confidence: 0.9, reasons: [], matched_attributes: [], conflicting_attributes: [] }
          : {
              description: "A grey running jacket under $80",
              max_price_usd: 80,
              category: "running-jacket",
              color: "grey",
            };
      return Response.json({
        id: "c",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            message:
              toolName === "text"
                ? { role: "assistant", content: "The Stride Running Jacket (JKT-GRY-M) is $74.00." }
                : {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "t",
                        type: "function",
                        function: { name: toolName, arguments: JSON.stringify(args) },
                      },
                    ],
                  },
            finish_reason: toolName === "text" ? "stop" : "tool_calls",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }) as typeof fetch);
  });
  afterEach(async () => {
    await closeUsageStores();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await raw?.end();
    await db?.close();
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    for (let i = 0; i < 50; i++) {
      if (!(await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=$1", [name])).rows.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  });
  const ai = async () => {
    const config = liveConfigFromEnv();
    if ("missing" in config) throw new Error(config.missing);
    return semanticFit(greyJacketIntent.natural_language_description, compliantCart, "live", {
      generate: createGenerate(config),
    });
  };
  test("AI and buyer calls consume one allowance that survives pool restart", async () => {
    expect((await ai()).fit).toBe("match");
    expect((await runDraft({ text: "a grey running jacket under $80", mode: "live" })).source).toBe("live");
    await closeUsageStores();
    await expect(runDraft({ text: "a grey running jacket under $80", mode: "live" })).rejects.toBeInstanceOf(
      AgentUnavailableError,
    );
    await expect(ai()).rejects.toBeInstanceOf(AiUnavailableError);
    expect(requests).toHaveLength(2);
    const row = (
      await raw.query("SELECT used, daily_limit FROM ai_daily_usage WHERE merchant_id=$1", [
        process.env.MERCHANT_ID,
      ])
    ).rows[0];
    expect(Number(row.used)).toBe(2);
    expect(Number(row.daily_limit)).toBe(2);
  });
  test("replay needs no database/provider access and live mode refuses an absent store", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect((await runDraft({ text: "grey jacket", mode: "replay" })).source).toBe("scripted");
    expect(
      (await semanticFit(greyJacketIntent.natural_language_description, compliantCart, "replay")).source,
    ).toBe("replay");
    await expect(runDraft({ text: "grey jacket", mode: "live" })).rejects.toBeInstanceOf(
      AgentUnavailableError,
    );
    expect(requests).toHaveLength(0);
  });
  const chat = () =>
    handleChat(
      {
        headers: new Headers(),
        body: JSON.stringify({
          messages: [{ role: "user", content: "show me grey running jackets under $80" }],
        }),
      },
      {
        env: { ...process.env, AI_MODE: "live", BUYER_CHAT: "1" },
        limiter: createChatLimiter(),
      },
    );
  test("the HTTP chat path preserves its sub-cap across restarts and leaves checkout capacity", async () => {
    vi.stubEnv("AI_DAILY_CALL_LIMIT", "3");
    expect((await chat()).body).toMatchObject({ source: "live" });
    await closeUsageStores();
    const denied = await chat();
    expect(denied.status).toBe(200);
    expect(denied.body).toMatchObject({ source: "scripted", note: expect.stringContaining("today's limit") });
    expect((denied.body as { text: string }).text).toContain("JKT-GRY-M");
    expect((await runDraft({ text: "a grey running jacket under $80", mode: "live" })).source).toBe("live");
    expect((await ai()).fit).toBe("match");
    expect(requests).toHaveLength(3);
    const row = (
      await raw.query("SELECT used FROM ai_daily_usage WHERE merchant_id=$1", [process.env.MERCHANT_ID])
    ).rows[0];
    expect(Number(row.used)).toBe(3);
    const feature = (
      await raw.query("SELECT used FROM ai_feature_usage WHERE merchant_id=$1", [process.env.MERCHANT_ID])
    ).rows[0];
    expect(Number(feature.used)).toBe(1);
  });
  test("zero chat allowance returns a labelled store answer without reserving checkout capacity", async () => {
    vi.stubEnv("BUYER_CHAT_DAILY_LIMIT", "0");
    const result = await chat();
    expect(result.body).toMatchObject({ source: "scripted", note: expect.stringContaining("today's limit") });
    expect((result.body as { text: string }).text).toContain("JKT-GRY-M");
    expect(requests).toHaveLength(0);
    expect((await runDraft({ text: "a grey running jacket under $80", mode: "live" })).source).toBe("live");
    const row = (
      await raw.query("SELECT used FROM ai_daily_usage WHERE merchant_id=$1", [process.env.MERCHANT_ID])
    ).rows[0];
    expect(Number(row.used)).toBe(1);
  });
  test("each buyer tool-loop model step reserves separately and stops before exceeding the cap", async () => {
    vi.stubEnv("AI_DAILY_CALL_LIMIT", "1");
    const checkout = vi.fn();
    await expect(runChoose({ intent: greyJacketIntent, mode: "live", checkout })).rejects.toBeInstanceOf(
      AgentUnavailableError,
    );
    expect(requests).toEqual(["search_catalog"]);
    expect(checkout).not.toHaveBeenCalled();
    const row = (
      await raw.query("SELECT used FROM ai_daily_usage WHERE merchant_id=$1", [process.env.MERCHANT_ID])
    ).rows[0];
    expect(Number(row.used)).toBe(1);
  });
});
