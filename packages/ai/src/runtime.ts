/**
 * What every job shares: prompts with front matter, the replay store, the live model call, redaction and
 * the "a person decides instead" error. Spec: docs/specs/0006-ai-jobs.md.
 */
import { readFileSync } from "node:fs";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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
}

/** One model call returning an object the schema accepted. Injected in tests; the AI SDK in production. */
export type Generate = <T>(req: GenerateRequest<T>) => Promise<T>;

/** One OpenAI-compatible model endpoint. */
export interface Endpoint {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
}

export interface LiveConfig extends Endpoint {
  /** The backup (AI_FALLBACK_*): tried once when the primary fails in a way another model or provider can fix. */
  fallback?: Endpoint;
}

/**
 * Default endpoints. NVIDIA is the decided provider (D1). The others speak the same OpenAI-compatible protocol, so
 * `AI_PROVIDER=groq` (plus a model and key) works with no code change; `AI_BASE_URL` overrides any of these.
 */
const BASE_URLS: Record<string, string> = {
  nvidia: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const warned = new Set<string>();
const warnOnce = (message: string) => {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
};

/**
 * The backup endpoint from the environment, or undefined. `AI_FALLBACK_MODEL` switches it on. With no
 * `AI_FALLBACK_PROVIDER` it is another model on the primary's provider (same key and endpoint); with one (for example
 * `groq`) it is a different provider, which needs its own `AI_FALLBACK_API_KEY` (its endpoint is built in, or set
 * `AI_FALLBACK_BASE_URL`). A half-configured backup is ignored with a warning, never silently half-used.
 */
export function fallbackFromEnv(env: NodeJS.ProcessEnv, primary: Endpoint): Endpoint | undefined {
  const model = env.AI_FALLBACK_MODEL?.trim();
  const provider = env.AI_FALLBACK_PROVIDER?.trim() || primary.provider;
  const sameProvider = provider === primary.provider;
  const apiKey = env.AI_FALLBACK_API_KEY?.trim() || (sameProvider ? primary.apiKey : undefined);
  const baseURL = env.AI_FALLBACK_BASE_URL?.trim() || (sameProvider ? primary.baseURL : BASE_URLS[provider]);
  if (!model) {
    if (env.AI_FALLBACK_PROVIDER?.trim() || env.AI_FALLBACK_API_KEY?.trim())
      warnOnce(
        "AI_FALLBACK_PROVIDER or AI_FALLBACK_API_KEY is set but AI_FALLBACK_MODEL is not: no backup model is configured.",
      );
    return undefined;
  }
  if (!apiKey) {
    warnOnce(
      `AI_FALLBACK_MODEL is set for provider "${provider}" but AI_FALLBACK_API_KEY is not: no backup is configured.`,
    );
    return undefined;
  }
  if (!baseURL) {
    warnOnce(
      `AI_FALLBACK_PROVIDER "${provider}" has no built-in endpoint: set AI_FALLBACK_BASE_URL. No backup is configured.`,
    );
    return undefined;
  }
  // The same model at the same place as the primary would only repeat the failure.
  if (sameProvider && model === primary.model && apiKey === primary.apiKey && baseURL === primary.baseURL)
    return undefined;
  return { provider, model, apiKey, baseURL };
}

/** AI_PROVIDER (default nvidia, D1), AI_MODEL, AI_API_KEY, AI_BASE_URL for a host with no built-in endpoint, and AI_FALLBACK_*. */
export function liveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LiveConfig | { missing: string } {
  const provider = env.AI_PROVIDER?.trim() || "nvidia";
  const model = env.AI_MODEL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const baseURL = env.AI_BASE_URL?.trim() || BASE_URLS[provider];
  if (!model) return { missing: "AI_MODEL" };
  if (!apiKey) return { missing: "AI_API_KEY" };
  if (!baseURL) return { missing: `AI_BASE_URL (no default for provider "${provider}")` };
  const primary = { provider, model, apiKey, baseURL };
  const fallback = fallbackFromEnv(env, primary);
  return fallback ? { ...primary, fallback } : primary;
}

/**
 * D1: Nemotron on NVIDIA spends its whole budget thinking unless `chat_template_kwargs.enable_thinking` is false on
 * every call. That field belongs to NVIDIA's endpoint: another provider may reject or ignore an unknown body field, so
 * it is sent to nvidia only. (apps/buyer keeps a copy of this rule; a test keeps the two identical.)
 */
export function providerOptionsFor(provider: string) {
  return provider === "nvidia" ? { nvidia: { chat_template_kwargs: { enable_thinking: false } } } : undefined;
}

/**
 * True when the provider says the model itself is gone: HTTP 404/410, or a message that names a missing, retired or
 * renamed model. The free lineups churn (a model can leave the free endpoints with no notice).
 */
export function isModelUnavailableError(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (status === 404 || status === 410) return true;
  const text = err instanceof Error ? err.message : String(err);
  return (
    /model[^.]{0,60}(not found|does not exist|decommission|deprecated|no longer (available|supported)|not available)/i.test(
      text,
    ) || /(not found|does not exist)[^.]{0,60}model/i.test(text)
  );
}

/**
 * Failures a backup can fix: the model is gone, the free tier is rate limited (429, the likely one at about 40
 * requests a minute), the provider is down or erroring (408, 5xx), or the call timed out or never connected. A
 * rejected request (400), a bad key (401/403) or an answer that fails validation are not: another provider would
 * either hide a misconfiguration or repeat the mistake, so those surface.
 */
export function isFailoverError(err: unknown): boolean {
  if (isModelUnavailableError(err)) return true;
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) return true;
  if (status !== undefined) return false;
  const name = (err as { name?: string } | null)?.name ?? "";
  const text = err instanceof Error ? err.message : String(err);
  return (
    name === "TimeoutError" ||
    /timeout|timed out|fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
      text,
    )
  );
}

/** The Vercel AI SDK over OpenAI-compatible endpoints. Temperature 0, no SDK retries (we retry once ourselves). */
export function createGenerate(cfg: LiveConfig, fetchImpl?: typeof fetch): Generate {
  const host = (e: Endpoint) =>
    createOpenAICompatible({
      name: e.provider,
      baseURL: e.baseURL,
      apiKey: e.apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  const primary = host(cfg);
  const backup = cfg.fallback ? host(cfg.fallback) : undefined;
  return async <T>({ system, prompt, schema, timeoutMs }: GenerateRequest<T>): Promise<T> => {
    const call = async (provider: ReturnType<typeof host>, e: Endpoint) => {
      const { object } = await generateObject({
        model: provider.chatModel(e.model),
        schema,
        system,
        prompt,
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
        providerOptions: providerOptionsFor(e.provider),
      });
      return object as T;
    };
    try {
      return await call(primary, cfg);
    } catch (err) {
      // Not sticky on purpose: if the primary comes back it is used again on the next call.
      if (!cfg.fallback || !backup || !isFailoverError(err)) throw err;
      try {
        return await call(backup, cfg.fallback);
      } catch (backupErr) {
        const say = (e: unknown) => (e instanceof Error ? e.message : String(e));
        throw new Error(`${say(err)}; the backup (${cfg.fallback.provider}) also failed: ${say(backupErr)}`);
      }
    }
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

const DEFAULT_DAILY_CALLS = 500;
const budget = { day: "", used: 0 };

/**
 * R11 kill switch: at most AI_DAILY_CALL_LIMIT live model calls per UTC day (default 500; 0 turns live calls
 * off). Past it the job is unavailable, so checkout steps up to the shopper instead of spending more.
 * ponytail: counted per process (api and worker each get the limit) and reset on restart; move the counter to
 * Postgres if the public demo ever needs one shared cap.
 */
export function takeAiCall(job: string, env: NodeJS.ProcessEnv = process.env, now = new Date()): void {
  const raw = Number(env.AI_DAILY_CALL_LIMIT);
  const limit =
    env.AI_DAILY_CALL_LIMIT?.trim() && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_CALLS;
  const day = now.toISOString().slice(0, 10);
  if (budget.day !== day) Object.assign(budget, { day, used: 0 });
  if (budget.used >= limit)
    throw new AiUnavailableError(job, `daily budget of ${limit} live calls is used up`);
  budget.used++;
}

/** Spec 0006: invalid output → retry once → a person decides. Every attempt counts against the daily budget. */
export async function generateWithRetry<T>(
  job: string,
  generate: Generate,
  req: GenerateRequest<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    takeAiCall(job);
    try {
      const out = await generate(req);
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
