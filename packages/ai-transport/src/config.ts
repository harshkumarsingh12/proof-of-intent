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
