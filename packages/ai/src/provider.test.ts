import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { checkEndpoint } from "./check";
import {
  createGenerate,
  fallbackFromEnv,
  isFailoverError,
  isModelUnavailableError,
  liveConfigFromEnv,
  providerOptionsFor,
  type Endpoint,
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

  const primary: Endpoint = {
    provider: "nvidia",
    model: "m-1",
    apiKey: "key",
    baseURL: "https://nv.test/v1",
  };

  test("no backup unless AI_FALLBACK_MODEL says so", () => {
    expect(liveConfigFromEnv(env({}))).not.toHaveProperty("fallback");
    expect(fallbackFromEnv({}, primary)).toBeUndefined();
  });

  test("another model on the same provider reuses the primary's key and endpoint", () => {
    expect(fallbackFromEnv({ AI_FALLBACK_MODEL: "  m-2  " } as NodeJS.ProcessEnv, primary)).toEqual({
      ...primary,
      model: "m-2",
    });
    // The same model at the same place would only repeat the failure.
    expect(fallbackFromEnv({ AI_FALLBACK_MODEL: "m-1" } as NodeJS.ProcessEnv, primary)).toBeUndefined();
  });

  test("Groq as the backup: its own endpoint is built in and its own key is required", () => {
    const groq = {
      AI_FALLBACK_PROVIDER: "groq",
      AI_FALLBACK_MODEL: "openai/gpt-oss-120b",
      AI_FALLBACK_API_KEY: "gsk_test",
    } as NodeJS.ProcessEnv;
    expect(fallbackFromEnv(groq, primary)).toEqual({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      apiKey: "gsk_test",
      baseURL: "https://api.groq.com/openai/v1",
    });
    expect(liveConfigFromEnv({ ...env({}), ...groq } as NodeJS.ProcessEnv)).toMatchObject({
      provider: "nvidia",
      fallback: { provider: "groq", apiKey: "gsk_test" },
    });
  });

  test("a half-configured backup is ignored with a warning, never half-used", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // another provider without its own key must not borrow the primary's
    expect(
      fallbackFromEnv(
        { AI_FALLBACK_PROVIDER: "groq", AI_FALLBACK_MODEL: "m-9" } as NodeJS.ProcessEnv,
        primary,
      ),
    ).toBeUndefined();
    // a provider and key but no model
    expect(
      fallbackFromEnv(
        { AI_FALLBACK_PROVIDER: "groq", AI_FALLBACK_API_KEY: "k" } as NodeJS.ProcessEnv,
        primary,
      ),
    ).toBeUndefined();
    // an unknown provider with no endpoint
    expect(
      fallbackFromEnv(
        {
          AI_FALLBACK_PROVIDER: "other",
          AI_FALLBACK_MODEL: "m",
          AI_FALLBACK_API_KEY: "k",
        } as NodeJS.ProcessEnv,
        primary,
      ),
    ).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
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

describe("what a backup can fix", () => {
  const http = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

  test("a rate limit, a provider error, a timeout and a dead connection fail over; so does a gone model", () => {
    for (const err of [
      http(429),
      http(408),
      http(500),
      http(502),
      http(503),
      http(404),
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      new Error("fetch failed"),
      new Error("getaddrinfo EAI_AGAIN integrate.api.nvidia.com"),
      new Error("read ECONNRESET"),
    ])
      expect(isFailoverError(err), String(err)).toBe(true);
  });

  test("a rejected request, a bad key and an invalid answer do not: another provider would hide or repeat them", () => {
    for (const err of [
      http(400),
      http(401),
      http(403),
      http(422),
      new Error("invalid api key"),
      new Error("No object generated: response did not match schema"),
      undefined,
    ])
      expect(isFailoverError(err), String(err)).toBe(false);
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

  const groqBackup: Endpoint = {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    apiKey: "gsk_backup",
    baseURL: "https://api.groq.test/openai/v1",
  };

  /** A fake that records the URL and key of every request, so it can tell which provider was asked. */
  function fakeHosts(answers: Record<string, () => Response>) {
    const calls: { host: string; auth: string | null; body: Record<string, unknown> }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const host = new URL(String(url)).host;
      const headers = new Headers(init?.headers);
      calls.push({ host, auth: headers.get("authorization"), body: JSON.parse(String(init?.body)) });
      return (answers[host] ?? answers["*"]!)();
    };
    return { calls, fetchImpl };
  }
  const limited = () => Response.json({ error: { message: "rate limit reached" } }, { status: 429 });

  test("a rate-limited primary is answered by the backup on another provider, with its own endpoint and key", async () => {
    const p = fakeHosts({ "host.test": limited, "api.groq.test": () => completion('{"ok":true}') });
    await expect(ask(cfg({ fallback: groqBackup }), p.fetchImpl)).resolves.toEqual({ ok: true });
    expect(p.calls.map((c) => [c.host, c.body.model, c.auth])).toEqual([
      ["host.test", "primary-model", "Bearer key"],
      ["api.groq.test", "openai/gpt-oss-120b", "Bearer gsk_backup"],
    ]);
    // NVIDIA's thinking switch went to NVIDIA only, never to the backup.
    expect(p.calls[0]!.body).toHaveProperty("chat_template_kwargs");
    expect(p.calls[1]!.body).not.toHaveProperty("chat_template_kwargs");
  });

  test("a gone model on the same provider is answered by the backup model, once", async () => {
    const p = fakeHosts({ "*": () => gone() });
    // primary says gone, backup (same host) says gone too: both are tried once and the error says so
    await expect(ask(cfg({ fallback: { ...cfg(), model: "backup-model" } }), p.fetchImpl)).rejects.toThrow(
      /also failed/,
    );
    expect(p.calls.map((c) => c.body.model)).toEqual(["primary-model", "backup-model"]);

    let n = 0;
    const q = fakeHosts({ "*": () => (n++ === 0 ? gone() : completion('{"ok":true}')) });
    await expect(ask(cfg({ fallback: { ...cfg(), model: "backup-model" } }), q.fetchImpl)).resolves.toEqual({
      ok: true,
    });
  });

  test("a bad key or a rejected request on the primary is not hidden by the backup", async () => {
    for (const status of [400, 401, 403]) {
      const p = fakeHosts({ "*": () => Response.json({ error: { message: "nope" } }, { status }) });
      await expect(ask(cfg({ fallback: groqBackup }), p.fetchImpl)).rejects.toThrow();
      expect(p.calls.map((c) => c.host)).toEqual(["host.test"]);
    }
  });

  test("with no backup the failure is passed on; with both down the error names both", async () => {
    const none = fakeHosts({ "*": limited });
    await expect(ask(cfg(), none.fetchImpl)).rejects.toThrow();
    expect(none.calls).toHaveLength(1);

    const both = fakeHosts({ "*": limited });
    await expect(ask(cfg({ fallback: groqBackup }), both.fetchImpl)).rejects.toThrow(
      /the backup \(groq\) also failed/,
    );
    expect(both.calls).toHaveLength(2);
  });
});

describe("ai:check", () => {
  // A fake provider that answers the structured request and runs the tool round trip like a working model.
  // A function: a Response body can be read only once, and each check needs its own.
  const toolCall = () =>
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
            tool_calls: [
              {
                id: "t1",
                type: "function",
                function: { name: "look_up_color", arguments: '{"product":"Stride"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  const text = (content: string) =>
    Response.json({
      id: "c2",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  const structuredAnswer = () =>
    Response.json({
      id: "c3",
      object: "chat.completion",
      created: 1,
      model: "m",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "t2", type: "function", function: { name: "json", arguments: '{"fit":"match"}' } },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  const groq: Endpoint = {
    provider: "groq",
    model: "openai/gpt-oss-120b",
    apiKey: "gsk_x",
    baseURL: "https://api.groq.test/v1",
  };

  /** What a real model does: once the tool's result is in the conversation it answers, before that it calls the tool. */
  type Body = {
    tools?: { function: { name: string } }[];
    tool_choice?: unknown;
    messages?: { role: string }[];
  };
  const wantsColorTool = (b: Body) => b.tools?.some((t) => t.function.name === "look_up_color") ?? false;
  const toolResultIn = (b: Body) => b.messages?.at(-1)?.role === "tool";

  test("a working endpoint passes every check, and the key never appears in the result", async () => {
    let forcedRequests = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Body;
      if (!wantsColorTool(body)) return structuredAnswer();
      if (body.tool_choice === "required") {
        forcedRequests++;
        // Groq: "required" on a request that follows the tool's result is a 400, because a sensible model now answers.
        if (toolResultIn(body))
          return Response.json(
            { error: { message: "Tool choice is required, but model did not call a tool" } },
            { status: 400 },
          );
      }
      return toolResultIn(body) ? text("It is grey.") : toolCall();
    };
    const result = await checkEndpoint(groq, fetchImpl);
    expect(result.structured).toMatchObject({ ok: true, detail: "answered fit=match" });
    // The forced check is one step: it never sends a second "required" request after the tool's result.
    expect(forcedRequests).toBe(1);
    expect(result.tools).toMatchObject({ ok: true, detail: "called the tool" });
    expect(result.autoTools).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).not.toContain("gsk_x");
  });

  test("a model that only calls a tool when forced is reported as guessing, not as broken", async () => {
    // It answers "black" on its own, but runs the tool when toolChoice is required (what Nemotron does).
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Body;
      if (!wantsColorTool(body)) return structuredAnswer();
      if (body.tool_choice === "required") return toolResultIn(body) ? text("It is grey.") : toolCall();
      return text("It is black.");
    };
    const result = await checkEndpoint(groq, fetchImpl);
    expect(result.tools.ok).toBe(true);
    expect(result.autoTools.ok).toBe(false);
    expect(result.autoTools.detail).toContain("it would be guessing");
    expect(result.autoTools.detail).toContain("It is black.");
  });

  test("an endpoint that can't run tools, or that errors, fails with a reason", async () => {
    const noTools: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { tools?: { function: { name: string } }[] };
      return body.tools?.some((t) => t.function.name === "look_up_color")
        ? text("grey, I guess")
        : structuredAnswer();
    };
    const ignored = await checkEndpoint(groq, noTools);
    expect(ignored.structured.ok).toBe(true);
    expect(ignored.tools.ok).toBe(false);
    expect(ignored.tools.detail).toContain("it answered without the tool");

    const denied = await checkEndpoint(groq, async () =>
      Response.json({ error: { message: "invalid api key" } }, { status: 401 }),
    );
    expect(denied.structured).toMatchObject({ ok: false });
    expect(denied.structured.detail).toContain("HTTP 401");
    expect(denied.tools.ok).toBe(false);
  });
});
