import { randomUUID } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiUsageReservation } from "@poi/contracts";
import { createDb } from "@poi/db";
import { wrapLanguageModel, type LanguageModelV1, type ToolSet } from "ai";
import {
  isFailoverError,
  liveConfigFromEnv,
  providerOptionsFor,
  type Endpoint,
  type LiveConfig,
} from "./config";
export * from "./config";

export class AiTransportUnavailable extends Error {
  constructor(readonly code: string) {
    super(`AI unavailable (${code})`);
    this.name = "AiTransportUnavailable";
  }
}
export interface UsageStore {
  reserve(merchantId: string, limit: number): Promise<AiUsageReservation>;
}
export interface ProviderAttempt {
  provider: string;
  model: string;
  role: "primary" | "fallback";
  outcome: "success" | "error";
  elapsedMs: number;
  httpRequests: number;
  failure?: string;
  fallbackReason?: string;
  operationId: string;
  job: string;
  retryIndex: number;
  attemptIndex: number;
}
export interface Operation {
  id: string;
  job: string;
  signal: AbortSignal;
  deadlineAt: number;
  endpointTimeoutMs: number;
  retryIndex: number;
  attempts: number;
  clock: () => number;
  onAttempt?: (attempt: ProviderAttempt) => void;
}
export function createOperation(
  job: string,
  options: {
    timeoutMs: number;
    endpointTimeoutMs?: number;
    signal?: AbortSignal;
    clock?: () => number;
    onAttempt?: Operation["onAttempt"];
  },
): Operation {
  for (const n of [options.timeoutMs, options.endpointTimeoutMs ?? options.timeoutMs])
    if (!Number.isSafeInteger(n) || n <= 0 || n > 2_147_483_647)
      throw new TypeError("AI timeouts must be positive bounded integers");
  const clock = options.clock ?? (() => performance.now());
  const timer = AbortSignal.timeout(options.timeoutMs);
  return {
    id: randomUUID(),
    job,
    signal: options.signal ? AbortSignal.any([options.signal, timer]) : timer,
    deadlineAt: clock() + options.timeoutMs,
    endpointTimeoutMs: options.endpointTimeoutMs ?? options.timeoutMs,
    clock,
    attempts: 0,
    retryIndex: 0,
    onAttempt: options.onAttempt,
  };
}
export function dailyCallLimit(env: NodeJS.ProcessEnv = process.env): number {
  const value = env.AI_DAILY_CALL_LIMIT;
  if (value === undefined || value.trim() === "") return 500;
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)))
    throw new TypeError("AI_DAILY_CALL_LIMIT must be a nonnegative safe integer");
  return Number(value);
}

/** The complete SDK/tool operation shares the provider deadline. */
export function runWithinOperation<T>(operation: Operation, run: () => PromiseLike<T>): Promise<T> {
  if (operation.signal.aborted || operation.clock() >= operation.deadlineAt)
    return Promise.reject(new AiTransportUnavailable("deadline_exceeded"));
  return within(
    Promise.resolve().then(() => {
      if (operation.signal.aborted || operation.clock() >= operation.deadlineAt)
        throw new AiTransportUnavailable("deadline_exceeded");
      return run();
    }),
    operation.signal,
    () => new AiTransportUnavailable("deadline_exceeded"),
  ).then((value) => {
    if (operation.signal.aborted || operation.clock() >= operation.deadlineAt)
      throw new AiTransportUnavailable("deadline_exceeded");
    return value;
  });
}
export function guardedTools<T extends ToolSet>(tools: T, operation: Operation): T {
  const guarded: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    if (!definition.execute) guarded[name] = definition;
    else {
      const execute = definition.execute;
      guarded[name] = {
        ...definition,
        execute: (...args: Parameters<typeof execute>) =>
          runWithinOperation(operation, () => execute(...args)),
      };
    }
  }
  return guarded as T;
}

function transportError(error: unknown): AiTransportUnavailable | undefined {
  let current = error;
  for (let i = 0; i < 6 && current; i++) {
    if (current instanceof AiTransportUnavailable) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
export function failureCategory(error: unknown): string {
  const transport = transportError(error);
  if (transport) return transport.code;
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599)
    return `http_${status}`;
  return isFailoverError(error) ? "connection_or_timeout" : "invalid_response_or_request";
}
/** Bounds even non-cooperative dependencies; late completion cannot start a provider request. */
function within<T>(work: PromiseLike<T>, signal: AbortSignal, unavailable: () => Error): Promise<T> {
  const pending = Promise.resolve(work);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(unavailable());
    if (signal.aborted) {
      pending.catch(() => {});
      reject(unavailable());
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    pending
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted))
      .catch(() => {});
  });
}
export function createTransportModel(
  config: LiveConfig,
  operation: Operation,
  options: { usage: UsageStore; merchantId: string; limit: number; fetch?: typeof fetch },
): LanguageModelV1 {
  if (
    !options.merchantId.trim() ||
    options.merchantId.length > 128 ||
    !Number.isSafeInteger(options.limit) ||
    options.limit < 0
  )
    throw new TypeError("AI transport needs valid trusted merchant scope and limit");
  type Params = Parameters<LanguageModelV1["doGenerate"]>[0];
  const expired = () => operation.signal.aborted || operation.clock() >= operation.deadlineAt;
  const call = async (
    endpoint: Endpoint,
    role: ProviderAttempt["role"],
    params: Params,
    fallbackReason?: string,
  ) => {
    const start = operation.clock();
    let httpRequests = 0;
    let failure: string | undefined;
    const attemptIndex = ++operation.attempts;
    const remaining = Math.max(1, Math.ceil(operation.deadlineAt - operation.clock()));
    const signal = AbortSignal.any([
      operation.signal,
      AbortSignal.timeout(Math.min(remaining, operation.endpointTimeoutMs)),
      ...(params.abortSignal ? [params.abortSignal] : []),
    ]);
    const unavailable = () =>
      new AiTransportUnavailable(
        expired() ? "deadline_exceeded" : params.abortSignal?.aborted ? "aborted" : "endpoint_timeout",
      );
    const check = () => {
      if (expired() || signal.aborted) throw unavailable();
    };
    try {
      check();
      const provider = createOpenAICompatible({
        name: endpoint.provider,
        apiKey: endpoint.apiKey,
        baseURL: endpoint.baseURL,
        fetch: async (input, init) => {
          check();
          let reservation: AiUsageReservation;
          try {
            reservation = await within(
              options.usage.reserve(options.merchantId, options.limit),
              signal,
              unavailable,
            );
          } catch (error) {
            if (transportError(error)) throw error;
            throw new AiTransportUnavailable("usage_store_unavailable");
          }
          check();
          if (!reservation.allowed) throw new AiTransportUnavailable("budget_exhausted");
          httpRequests++;
          return (options.fetch ?? fetch)(input, { ...init, signal });
        },
      });
      const result = await within(
        provider.chatModel(endpoint.model).doGenerate({
          ...params,
          abortSignal: signal,
          providerMetadata: { ...params.providerMetadata, ...providerOptionsFor(endpoint.provider) },
        }),
        signal,
        unavailable,
      );
      check();
      return result;
    } catch (error) {
      failure = failureCategory(error);
      throw error;
    } finally {
      try {
        operation.onAttempt?.({
          provider: endpoint.provider,
          model: endpoint.model,
          role,
          outcome: failure ? "error" : "success",
          elapsedMs: Math.max(0, Math.round(operation.clock() - start)),
          httpRequests,
          ...(failure ? { failure } : {}),
          ...(fallbackReason ? { fallbackReason } : {}),
          operationId: operation.id,
          job: operation.job,
          retryIndex: operation.retryIndex,
          attemptIndex,
        });
      } catch {
        /* Observers cannot authorize calls or turn a successful answer into a paid retry. */
      }
    }
  };
  // The wrapper exposes the SDK model interface; every non-streaming invocation passes through the same controls.
  const shape = createOpenAICompatible({
    name: config.provider,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  }).chatModel(config.model);
  return wrapLanguageModel({
    model: shape,
    middleware: {
      wrapGenerate: async ({ params }) => {
        try {
          return await call(config, "primary", params);
        } catch (error) {
          const blocked = transportError(error);
          if (
            !config.fallback ||
            expired() ||
            params.abortSignal?.aborted ||
            (blocked && blocked.code !== "endpoint_timeout") ||
            (!blocked && !isFailoverError(error))
          )
            throw error;
          return call(config.fallback, "fallback", params, failureCategory(error));
        }
      },
      wrapStream: async () => {
        throw new AiTransportUnavailable("streaming_not_supported");
      },
    },
  });
}

const stores = new Map<string, ReturnType<typeof createDb>>();
export function usageStoreFromEnv(env: NodeJS.ProcessEnv = process.env): UsageStore {
  if (!env.DATABASE_URL?.trim()) throw new AiTransportUnavailable("database_not_configured");
  let db = stores.get(env.DATABASE_URL);
  if (!db) {
    db = createDb(env.DATABASE_URL, { maxConnections: 2, allowExitOnIdle: true });
    stores.set(env.DATABASE_URL, db);
  }
  return { reserve: (merchantId, limit) => db!.reserveAiCall(merchantId, limit) };
}
export function validateLiveEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  dailyCallLimit(env);
  if (!env.DATABASE_URL?.trim()) throw new AiTransportUnavailable("database_not_configured");
  const config = liveConfigFromEnv(env);
  if ("missing" in config) throw new AiTransportUnavailable(`missing_${config.missing.split(" ")[0]}`);
  if (env.MERCHANT_ID !== undefined && !env.MERCHANT_ID.trim())
    throw new TypeError("MERCHANT_ID must not be blank in live mode");
}
export function modelFromEnv(
  job: string,
  options: {
    timeoutMs: number;
    endpointTimeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    usage?: UsageStore;
    fetch?: typeof fetch;
    operation?: Operation;
  },
): LanguageModelV1 {
  const env = options.env ?? process.env;
  const config = liveConfigFromEnv(env);
  if ("missing" in config) throw new AiTransportUnavailable(`missing_${config.missing.split(" ")[0]}`);
  const merchantId = env.MERCHANT_ID ?? "merchant-trailhead";
  return createTransportModel(config, options.operation ?? createOperation(job, options), {
    usage: options.usage ?? usageStoreFromEnv(env),
    merchantId,
    limit: dailyCallLimit(env),
    fetch: options.fetch,
  });
}
export async function closeUsageStores(): Promise<void> {
  const pending = [...stores.values()];
  stores.clear();
  await Promise.all(pending.map((db) => db.close()));
}
