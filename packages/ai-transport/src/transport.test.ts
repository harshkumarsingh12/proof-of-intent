import { generateText, tool } from "ai";
import { z } from "zod";
import { expect, test } from "vitest";
import {
  createOperation,
  createTransportModel,
  dailyCallLimit,
  chatDailyLimit,
  modelFromEnv,
  guardedTools,
  runWithinOperation,
  type ProviderAttempt,
  type UsageStore,
  type LiveConfig,
} from "./index";

const config: LiveConfig = {
  provider: "nvidia",
  model: "primary",
  apiKey: "secret-primary",
  baseURL: "https://primary.invalid/v1",
  fallback: {
    provider: "groq",
    model: "backup",
    apiKey: "secret-backup",
    baseURL: "https://backup.invalid/v1",
  },
};
function usage(cap = 20) {
  let used = 0;
  const store: UsageStore = {
    reserve: async (_merchant, limit) => {
      cap = Math.min(cap, limit);
      if (used >= cap) return { allowed: false, used, limit: cap };
      return { allowed: true, used: ++used, limit: cap };
    },
  };
  return { store, used: () => used };
}
const completion = () =>
  Response.json({
    id: "c",
    object: "chat.completion",
    created: 1,
    model: "served",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
function setup(
  answers: (host: string) => Response | Promise<Response>,
  options: {
    cap?: number;
    timeoutMs?: number;
    endpointTimeoutMs?: number;
    config?: LiveConfig;
    clock?: () => number;
    store?: UsageStore;
    onAttempt?: (a: ProviderAttempt) => void;
    signal?: AbortSignal;
  } = {},
) {
  const counter = usage(options.cap);
  const attempts: ProviderAttempt[] = [];
  const requests: { host: string; body: Record<string, unknown> }[] = [];
  const operation = createOperation("test", {
    timeoutMs: options.timeoutMs ?? 1000,
    endpointTimeoutMs: options.endpointTimeoutMs,
    clock: options.clock,
    signal: options.signal,
    onAttempt: (a) => {
      attempts.push(a);
      options.onAttempt?.(a);
    },
  });
  const model = createTransportModel(options.config ?? config, operation, {
    merchantId: "merchant-test",
    limit: options.cap ?? 20,
    usage: options.store ?? counter.store,
    fetch: async (url, init) => {
      const host = new URL(String(url)).host;
      requests.push({ host, body: JSON.parse(String(init?.body)) });
      return answers(host);
    },
  });
  const ask = () => generateText({ model, prompt: "private shopper text", maxRetries: 0, temperature: 0 });
  return { ask, model, operation, attempts, requests, counter };
}
test("primary failure and backup success reserve two physical calls and attribute the backup", async () => {
  const s = setup((host) =>
    host === "primary.invalid"
      ? Response.json({ error: { message: "secret provider detail" } }, { status: 429 })
      : completion(),
  );
  expect((await s.ask()).text).toBe("ok");
  expect(s.counter.used()).toBe(2);
  expect(s.attempts).toMatchObject([
    { provider: "nvidia", role: "primary", failure: "http_429", httpRequests: 1 },
    { provider: "groq", role: "fallback", outcome: "success", fallbackReason: "http_429", httpRequests: 1 },
  ]);
  expect(s.attempts[0]!.operationId).toBe(s.attempts[1]!.operationId);
  for (const secret of [
    "secret-primary",
    "secret-backup",
    "private shopper",
    "secret provider detail",
    "https://",
  ])
    expect(JSON.stringify(s.attempts)).not.toContain(secret);
});
test("the backup cannot spend a second request after the last available slot", async () => {
  const s = setup(() => Response.json({ error: { message: "limited" } }, { status: 429 }), { cap: 1 });
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
  expect(s.counter.used()).toBe(1);
  expect(s.attempts[1]).toMatchObject({ provider: "groq", failure: "budget_exhausted", httpRequests: 0 });
});
test("two retries across both endpoints count four requests, with no hidden fifth call", async () => {
  const s = setup(() => Response.json({ error: { message: "down" } }, { status: 503 }), { cap: 4 });
  await expect(s.ask()).rejects.toThrow();
  s.operation.retryIndex = 1;
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(4);
  expect(s.counter.used()).toBe(4);
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(4);
  expect(s.attempts.slice(0, 4).map((a) => a.retryIndex)).toEqual([0, 0, 1, 1]);
});
test.each([400, 401, 403, 422])("HTTP %s is not hidden by fallback", async (status) => {
  const s = setup(() => Response.json({ error: { message: "rejected" } }, { status }));
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
});
test("NVIDIA options are applied to a NVIDIA fallback even when the primary is another provider", async () => {
  const swapped = { ...config.fallback!, fallback: { ...config, fallback: undefined } };
  const s = setup(
    (host) =>
      host === "backup.invalid"
        ? Response.json({ error: { message: "down" } }, { status: 503 })
        : completion(),
    { config: swapped },
  );
  await s.ask();
  expect(s.requests[0]!.body).not.toHaveProperty("chat_template_kwargs");
  expect(s.requests[1]!.body).toHaveProperty("chat_template_kwargs", { enable_thinking: false });
});
test("an expired overall budget cannot start fallback even after a fast primary failure", async () => {
  let now = 0;
  const s = setup(
    () => {
      now = 100;
      return Response.json({ error: { message: "down" } }, { status: 503 });
    },
    { timeoutMs: 50, clock: () => now },
  );
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
});
test("a non-cooperative hanging primary is bounded by one overall deadline", async () => {
  const s = setup(() => new Promise<Response>(() => {}), { timeoutMs: 30 });
  const start = performance.now();
  await expect(s.ask()).rejects.toThrow();
  expect(performance.now() - start).toBeLessThan(500);
  expect(s.requests).toHaveLength(1);
  expect(s.attempts[0]).toMatchObject({ failure: "deadline_exceeded" });
});
test("late database reservations cannot send a provider request after the deadline", async () => {
  let grant!: (value: { allowed: boolean; used: number; limit: number }) => void;
  const store: UsageStore = {
    reserve: () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  };
  const s = setup(completion, { timeoutMs: 30, store });
  await expect(s.ask()).rejects.toThrow();
  grant({ allowed: true, used: 1, limit: 20 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(s.requests).toHaveLength(0);
});
test("usage storage failure and a zero limit make no provider request", async () => {
  const broken = setup(completion, {
    store: {
      reserve: async () => {
        throw new Error("secret DB URL");
      },
    },
  });
  await expect(broken.ask()).rejects.toThrow();
  expect(broken.requests).toHaveLength(0);
  expect(broken.attempts).toHaveLength(1);
  expect(JSON.stringify(broken.attempts)).not.toContain("secret DB URL");
  const off = setup(completion, { cap: 0 });
  await expect(off.ask()).rejects.toThrow();
  expect(off.requests).toHaveLength(0);
});
test("aborts and broken observers do not trigger additional provider requests", async () => {
  const aborted = setup(completion, { signal: AbortSignal.abort() });
  await expect(aborted.ask()).rejects.toThrow();
  expect(aborted.requests).toHaveLength(0);
  const observer = setup(completion, {
    onAttempt: () => {
      throw new Error("network observer");
    },
  });
  expect((await observer.ask()).text).toBe("ok");
  expect(observer.requests).toHaveLength(1);
});
test("live defaults require persistent storage; limit parsing rejects invalid configuration", () => {
  expect(dailyCallLimit({})).toBe(500);
  expect(dailyCallLimit({ AI_DAILY_CALL_LIMIT: "0" })).toBe(0);
  expect(chatDailyLimit({})).toBe(150);
  expect(chatDailyLimit({ BUYER_CHAT_DAILY_LIMIT: "0" })).toBe(0);
  for (const value of ["-1", "1.5", "NaN", "Infinity", "1e3", "9007199254740992"]) {
    expect(() => dailyCallLimit({ AI_DAILY_CALL_LIMIT: value })).toThrow();
    expect(() => chatDailyLimit({ BUYER_CHAT_DAILY_LIMIT: value })).toThrow();
  }
  expect(() => modelFromEnv("test", { timeoutMs: 100, env: { AI_MODEL: "m", AI_API_KEY: "k" } })).toThrow(
    /database_not_configured/,
  );
});

test("a per-endpoint timeout can use the backup only within the original overall allowance", async () => {
  const s = setup((host) => (host === "primary.invalid" ? new Promise<Response>(() => {}) : completion()), {
    timeoutMs: 200,
    endpointTimeoutMs: 20,
  });
  expect((await s.ask()).text).toBe("ok");
  expect(s.requests).toHaveLength(2);
  expect(s.attempts[1]).toMatchObject({ fallbackReason: "endpoint_timeout" });
});

test("tool waiting is bounded and tools cannot begin after the operation expires", async () => {
  const operation = createOperation("tools", { timeoutMs: 25 });
  let called = 0;
  const tools = guardedTools(
    {
      wait: tool({
        parameters: z.object({}),
        execute: async () => {
          called++;
          return new Promise<string>(() => {});
        },
      }),
    },
    operation,
  );
  await expect(
    runWithinOperation(operation, () => tools.wait.execute!({}, { toolCallId: "t", messages: [] })),
  ).rejects.toThrow();
  await expect(tools.wait.execute!({}, { toolCallId: "t2", messages: [] })).rejects.toThrow();
  expect(called).toBe(1);
});

test("a late successful response cannot escape a delayed deadline timer", async () => {
  let now = 0;
  const s = setup(
    () => {
      now = 100;
      return completion();
    },
    { timeoutMs: 50, clock: () => now },
  );
  await expect(s.ask()).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
  expect(s.attempts[0]).toMatchObject({ outcome: "error", failure: "deadline_exceeded" });
});

test("public provider failures expose bounded diagnostics without provider response bodies", async () => {
  const s = setup(() => Response.json({ error: { message: "secret echo of credentials" } }, { status: 401 }));
  const error = (await s.ask().catch((value: unknown) => value)) as Error & { statusCode?: number };
  expect(error).toBeInstanceOf(Error);
  expect(error.statusCode).toBe(401);
  expect(error.message).toContain("http_401");
  expect(error.message).not.toContain("secret echo");
});
