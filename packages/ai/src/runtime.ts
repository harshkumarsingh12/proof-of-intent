/**
 * What every job shares: prompts with front matter, the replay store, the live model call, redaction and
 * the "a person decides instead" error. Spec: docs/specs/0006-ai-jobs.md.
 */
import { readFileSync } from "node:fs";
import {
  createOperation,
  createTransportModel,
  runWithinOperation,
  dailyCallLimit,
  liveConfigFromEnv,
  usageStoreFromEnv,
  type Operation,
  type UsageStore,
  type LiveConfig,
  type ProviderAttempt as TransportAttempt,
} from "@poi/ai-transport";
export {
  createOperation,
  fallbackFromEnv,
  failureCategory,
  isFailoverError,
  isModelUnavailableError,
  liveConfigFromEnv,
  providerOptionsFor,
  validateLiveEnvironment,
  type Endpoint,
  type LiveConfig,
} from "@poi/ai-transport";
import { NotImplementedError } from "@poi/contracts";
import { mandateHash } from "@poi/mandates";
import { generateObject } from "ai";
import type { z } from "zod";

export type AiMode = "live" | "replay";

export function parseAiMode(value: string | undefined): AiMode {
  if (value === undefined || value === "" || value === "replay") return "replay";
  if (value === "live") return "live";
  throw new Error(`AI_MODE must be "live" or "replay", got "${value}"`);
}

/**
 * The model can't answer: no recording in replay mode, no valid output after one retry, a timeout, no key.
 * Callers treat it like an unbuilt job: a person confirms instead (checkout STEP_UP, spec 0003).
 */
export class AiUnavailableError extends Error {
  constructor(job: string, why: string) {
    super(`${job} unavailable: ${why}`);
    this.name = "AiUnavailableError";
  }
}

/** True when a job didn't answer and a human should decide. Anything else is a real bug and should throw. */
export const isAiUnavailable = (err: unknown): boolean =>
  err instanceof AiUnavailableError || err instanceof NotImplementedError;

// ---------- prompts ----------

export interface Prompt {
  version: string;
  model: string;
  schema: string;
  text: string;
}

/** Reads packages/ai/prompts/<name>.md: `key: value` front matter between `---` lines, then the prompt. */
export function loadPrompt(name: string): Prompt {
  const raw = readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`prompts/${name}.md has no front matter`);
  const meta = Object.fromEntries(
    m[1]!.split("\n").map((line) => {
      const i = line.indexOf(":");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    }),
  );
  for (const key of ["version", "model", "schema"]) {
    if (!meta[key]) throw new Error(`prompts/${name}.md front matter needs "${key}"`);
  }
  return { version: meta.version!, model: meta.model!, schema: meta.schema!, text: m[2]!.trim() };
}

// ---------- replay ----------

export interface ReplayEntry<T> {
  /** For people reading the file; not part of the key. */
  label: string;
  output: T;
}

export type ReplayFile<T> = Record<string, ReplayEntry<T>>;

const replayUrl = (name: string) => new URL(`../replay/${name}.json`, import.meta.url);

/** Key = SHA-256 of the canonical { job, prompt version, exactly what the model is shown }. */
export const replayKey = (job: string, promptVersion: string, input: unknown): string =>
  mandateHash({ job, prompt_version: promptVersion, input });

export function readReplay<T>(name: string): ReplayFile<T> {
  try {
    return JSON.parse(readFileSync(replayUrl(name), "utf8")) as ReplayFile<T>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export const replayPath = (name: string): URL => replayUrl(name);

// ---------- live ----------

export interface GenerateRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  operation?: Operation;
  /** Request-scoped telemetry. Never includes prompts, credentials, URLs or provider error bodies. */
  onAttempt?: (attempt: ProviderAttempt) => void;
}

export type ProviderAttempt = Pick<
  TransportAttempt,
  "provider" | "model" | "role" | "outcome" | "elapsedMs" | "httpRequests" | "failure" | "fallbackReason"
> &
  Partial<Pick<TransportAttempt, "operationId" | "job" | "retryIndex" | "attemptIndex">>;

/** One model call returning an object the schema accepted. Injected in tests; the AI SDK in production. */
export type Generate = <T>(req: GenerateRequest<T>) => Promise<T>;

/** Structured generation uses the same bounded, persistent server transport as the buyer. */
export function createGenerate(
  cfg: LiveConfig,
  fetchImpl?: typeof fetch,
  options: { usage?: UsageStore; merchantId?: string; limit?: number } = {},
): Generate {
  return async <T>(request: GenerateRequest<T>): Promise<T> => {
    if (request.timeoutMs <= 0) {
      try {
        request.onAttempt?.({
          provider: cfg.provider,
          model: cfg.model,
          role: "primary",
          outcome: "error",
          elapsedMs: 0,
          httpRequests: 0,
          failure: "invalid_response_or_request",
        });
      } catch {
        /* advisory telemetry */
      }
      throw new RangeError("AI timeout must be positive");
    }
    const operation =
      request.operation ??
      createOperation("structured", {
        timeoutMs: request.timeoutMs * 2,
        endpointTimeoutMs: request.timeoutMs,
      });
    if (request.onAttempt) operation.onAttempt = request.onAttempt;
    const model = createTransportModel(cfg, operation, {
      usage: options.usage ?? usageStoreFromEnv(),
      merchantId: options.merchantId ?? process.env.MERCHANT_ID ?? "merchant-trailhead",
      limit: options.limit ?? dailyCallLimit(),
      fetch: fetchImpl,
    });
    const { object } = await generateObject({
      model,
      system: request.system,
      prompt: request.prompt,
      schema: request.schema,
      temperature: 0,
      maxRetries: 0,
      abortSignal: operation.signal,
    });
    return object as T;
  };
}
let defaultGenerate: Generate | undefined;

/** The process-wide live caller from the environment, or AiUnavailableError if it isn't configured. */
export function generateFromEnv(job: string): Generate {
  if (defaultGenerate) return defaultGenerate;
  const cfg = liveConfigFromEnv();
  if ("missing" in cfg) throw new AiUnavailableError(job, `AI_MODE=live but ${cfg.missing} is not set`);
  defaultGenerate = createGenerate(cfg);
  return defaultGenerate;
}

/** Spec 0006: invalid output → retry once → a person decides. Every attempt counts against the daily budget. */
export async function generateWithRetry<T>(
  job: string,
  generate: Generate,
  req: GenerateRequest<T>,
): Promise<T> {
  const operation =
    req.operation ?? createOperation(job, { timeoutMs: req.timeoutMs * 2, endpointTimeoutMs: req.timeoutMs });
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    operation.retryIndex = attempt;
    try {
      const out = await runWithinOperation(operation, () => generate({ ...req, operation }));
      const parsed = req.schema.safeParse(out);
      if (parsed.success) return parsed.data;
      last = parsed.error;
    } catch (err) {
      last = err;
    }
  }
  throw new AiUnavailableError(job, `no valid answer after a retry (${(last as Error)?.message ?? last})`);
}

// ---------- data hygiene ----------

/**
 * Removes what the model never needs: email addresses and phone-like numbers. A number only counts as a phone number
 * when it stands alone: digits inside a longer token (a mandate hash such as `b6e1…d116f85350fade…`, an id) are left
 * as they are, since cutting them out made the Studio chat quote a corrupted hash.
 */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<![\w-])\+?\d[\d\s().-]{6,}\d(?![\w-])/g, "[number]");
}

/** JSON for a delimited data block. `<` and `>` are escaped so data can't close its own tag. */
export const dataBlock = (tag: string, value: unknown): string =>
  `<${tag}>\n${JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</${tag}>`;
