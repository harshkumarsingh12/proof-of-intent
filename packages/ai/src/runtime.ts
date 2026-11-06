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

export interface LiveConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
}

const BASE_URLS: Record<string, string> = { nvidia: "https://integrate.api.nvidia.com/v1" };

/** AI_PROVIDER (default nvidia, D1), AI_MODEL, AI_API_KEY, and AI_BASE_URL for any other OpenAI-compatible host. */
export function liveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LiveConfig | { missing: string } {
  const provider = env.AI_PROVIDER?.trim() || "nvidia";
  const model = env.AI_MODEL?.trim();
  const apiKey = env.AI_API_KEY?.trim();
  const baseURL = env.AI_BASE_URL?.trim() || BASE_URLS[provider];
  if (!model) return { missing: "AI_MODEL" };
  if (!apiKey) return { missing: "AI_API_KEY" };
  if (!baseURL) return { missing: `AI_BASE_URL (no default for provider "${provider}")` };
  return { provider, model, apiKey, baseURL };
}

/** The Vercel AI SDK over an OpenAI-compatible endpoint. Temperature 0, no SDK retries (we retry once ourselves). */
export function createGenerate(cfg: LiveConfig): Generate {
  const provider = createOpenAICompatible({ name: cfg.provider, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  return async <T>({ system, prompt, schema, timeoutMs }: GenerateRequest<T>): Promise<T> => {
    const { object } = await generateObject({
      model: provider.chatModel(cfg.model),
      schema,
      system,
      prompt,
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(timeoutMs),
      // D1: nemotron spends its whole budget thinking unless this is off on every call.
      providerOptions: { [cfg.provider]: { chat_template_kwargs: { enable_thinking: false } } },
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

/** Spec 0006: invalid output → retry once → a person decides. */
export async function generateWithRetry<T>(
  job: string,
  generate: Generate,
  req: GenerateRequest<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
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

/** Removes what the model never needs: email addresses and phone-like numbers. */
export function redact(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]").replace(/\+?\d[\d\s().-]{6,}\d/g, "[number]");
}

/** JSON for a delimited data block. `<` and `>` are escaped so data can't close its own tag. */
export const dataBlock = (tag: string, value: unknown): string =>
  `<${tag}>\n${JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")}\n</${tag}>`;
