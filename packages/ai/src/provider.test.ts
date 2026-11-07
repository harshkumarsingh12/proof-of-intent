import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createGenerate,
  isModelUnavailableError,
  liveConfigFromEnv,
  providerOptionsFor,
  type LiveConfig,
} from "./runtime";

const env = (over: Record<string, string>) =>
  ({ AI_MODEL: "m-1", AI_API_KEY: "key", ...over }) as NodeJS.ProcessEnv;

describe("provider configuration", () => {
  test("NVIDIA is the default, and the other free providers have their endpoints built in", () => {
    expect(liveConfigFromEnv(env({}))).toMatchObject({
      provider: "nvidia",
      baseURL: "https://integrate.api.nvidia.com/v1",
    });
    for (const [provider, host] of [
      ["gemini", "generativelanguage.googleapis.com"],
      ["groq", "api.groq.com"],
      ["openrouter", "openrouter.ai"],
    ] as const) {
      const cfg = liveConfigFromEnv(env({ AI_PROVIDER: provider })) as LiveConfig;
      expect(cfg.provider).toBe(provider);
      expect(cfg.baseURL).toContain(host);
    }
    // An unknown provider still needs an explicit endpoint, and AI_BASE_URL overrides a built-in one.
    expect(liveConfigFromEnv(env({ AI_PROVIDER: "other" }))).toEqual({
      missing: 'AI_BASE_URL (no default for provider "other")',
    });
    expect(
      liveConfigFromEnv(env({ AI_PROVIDER: "groq", AI_BASE_URL: "https://proxy.test/v1" })),
    ).toMatchObject({
      baseURL: "https://proxy.test/v1",
    });
  });

  test("the fallback model is optional, trimmed, and ignored when it is the same as the primary", () => {
    expect(liveConfigFromEnv(env({}))).not.toHaveProperty("fallbackModel");
    expect(liveConfigFromEnv(env({ AI_FALLBACK_MODEL: "  m-2  " }))).toMatchObject({ fallbackModel: "m-2" });
    expect(liveConfigFromEnv(env({ AI_FALLBACK_MODEL: "m-1" }))).not.toHaveProperty("fallbackModel");
  });

  test("the thinking switch is NVIDIA's field and goes to NVIDIA only", () => {
    expect(providerOptionsFor("nvidia")).toEqual({
      nvidia: { chat_template_kwargs: { enable_thinking: false } },
    });
    for (const other of ["gemini", "groq", "openrouter", "other"])
      expect(providerOptionsFor(other)).toBeUndefined();
  });
});

describe("a gone model is the one failure worth a second model", () => {
  test("404 and 410 and messages naming a missing, retired or renamed model count", () => {
    expect(isModelUnavailableError(Object.assign(new Error("Not Found"), { statusCode: 404 }))).toBe(true);
    expect(isModelUnavailableError(Object.assign(new Error("Gone"), { statusCode: 410 }))).toBe(true);
    for (const message of [
      "The model `llama-x` does not exist or you do not have access to it",
      "model nemotron-3-super has been decommissioned",
      "Model not found",
      "this model is no longer available on the free tier",
      "Function not found for model",
    ])
      expect(isModelUnavailableError(new Error(message))).toBe(true);
  });

  test("rate limits, timeouts, bad requests and other errors do not", () => {
    expect(isModelUnavailableError(Object.assign(new Error("Too Many Requests"), { statusCode: 429 }))).toBe(
      false,
    );
    expect(isModelUnavailableError(Object.assign(new Error("boom"), { statusCode: 500 }))).toBe(false);
    expect(isModelUnavailableError(new Error("The operation was aborted due to timeout"))).toBe(false);
    expect(isModelUnavailableError(new Error("invalid api key"))).toBe(false);
    expect(isModelUnavailableError(undefined)).toBe(false);
  });
});

describe("the request that reaches the provider", () => {
  // generateObject asks for its answer as a forced tool call named "json", so the fake provider answers that way.
  const completion = (args: string) =>
    Response.json({
      id: "c1",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "t1", type: "function", function: { name: "json", arguments: args } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });

  /** A fake provider: records each request body and answers with the next scripted response. */
  function fakeProvider(answers: (() => Response)[]) {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return answers[Math.min(bodies.length - 1, answers.length - 1)]!();
    };
    return { bodies, fetchImpl };
  }
  const ask = (cfg: LiveConfig, fetchImpl: typeof fetch) =>
    createGenerate(
      cfg,
      fetchImpl,
    )({
      system: "s",
      prompt: "p",
      schema: z.object({ ok: z.boolean() }),
      timeoutMs: 5_000,
    });
  const cfg = (over: Partial<LiveConfig> = {}): LiveConfig => ({
    provider: "nvidia",
    model: "primary-model",
    apiKey: "key",
    baseURL: "https://host.test/v1",
    ...over,
  });
  const gone = () => Response.json({ error: { message: "model not found" } }, { status: 404 });

  test("NVIDIA gets the thinking switch in the body; another provider does not", async () => {
    const nvidia = fakeProvider([() => completion('{"ok":true}')]);
    await expect(ask(cfg(), nvidia.fetchImpl)).resolves.toEqual({ ok: true });
    expect(nvidia.bodies[0]).toMatchObject({
      model: "primary-model",
      chat_template_kwargs: { enable_thinking: false },
    });

    const groq = fakeProvider([() => completion('{"ok":true}')]);
    await expect(ask(cfg({ provider: "groq" }), groq.fetchImpl)).resolves.toEqual({ ok: true });
    expect(groq.bodies[0]).not.toHaveProperty("chat_template_kwargs");
  });

  test("when the primary model is gone the fallback model answers, once", async () => {
    const p = fakeProvider([gone, () => completion('{"ok":true}')]);
    await expect(ask(cfg({ fallbackModel: "fallback-model" }), p.fetchImpl)).resolves.toEqual({ ok: true });
    expect(p.bodies.map((b) => b.model)).toEqual(["primary-model", "fallback-model"]);
  });

  test("without a fallback the failure is passed on, and a rate limit never switches models", async () => {
    const none = fakeProvider([gone]);
    await expect(ask(cfg(), none.fetchImpl)).rejects.toThrow();
    expect(none.bodies).toHaveLength(1);

    const limited = fakeProvider([() => Response.json({ error: { message: "slow down" } }, { status: 429 })]);
    await expect(ask(cfg({ fallbackModel: "fallback-model" }), limited.fetchImpl)).rejects.toThrow();
    expect(limited.bodies.map((b) => b.model)).toEqual(["primary-model"]);
  });
});
