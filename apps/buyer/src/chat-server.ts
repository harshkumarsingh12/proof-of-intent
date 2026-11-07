/**
 * The chat endpoint's logic (docs/specs/0010), apart from Next so it can be tested directly. Gates, in order: the
 * switch (BUYER_CHAT=1), the per-IP limit, a bounded and strictly shaped body, text that must never be sent (keys,
 * tokens, signed records), then the daily cap on live model calls. A spent cap or a model that fails still gets an
 * answer, composed from the store's own data, because that is still useful and costs nothing.
 */
import type { LanguageModelV1 } from "ai";
import { parseAgentMode } from "./agent";
import { ChatRequest, looksSensitive, runChat, type ChatResult } from "./chat";
import { clientIp, createChatLimiter, type Limiter } from "./rate-limit";

const MAX_BODY_CHARS = 8_000;
const DEFAULT_DAILY_CHAT_CALLS = 150;

const chatDay = { day: "", used: 0 };

/**
 * A separate, lower cap than the shop's overall model budget (AI_DAILY_CALL_LIMIT), so a busy chat can't use up the
 * calls the checkout agent needs. `BUYER_CHAT_DAILY_LIMIT=0` answers everything from the store's data. Per process.
 */
export function takeChatCall(env: NodeJS.ProcessEnv = process.env, now = new Date()): boolean {
  const raw = Number(env.BUYER_CHAT_DAILY_LIMIT);
  const limit =
    env.BUYER_CHAT_DAILY_LIMIT?.trim() && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DAILY_CHAT_CALLS;
  const day = now.toISOString().slice(0, 10);
  if (chatDay.day !== day) Object.assign(chatDay, { day, used: 0 });
  if (chatDay.used >= limit) return false;
  chatDay.used++;
  return true;
}

export interface ChatHttp {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ChatDeps {
  limiter?: Limiter;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** A model to use instead of the one from the environment (tests). */
  model?: LanguageModelV1;
}

/** One limiter for the process; tests pass their own. */
const processLimiter = createChatLimiter();

const bad = (message: string, error = "invalid_request"): ChatHttp => ({
  status: 400,
  body: { error, message },
});

export async function handleChat(
  input: { headers: Pick<Headers, "get">; body: string },
  deps: ChatDeps = {},
): Promise<ChatHttp> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());

  if (env.BUYER_CHAT !== "1") {
    return {
      status: 404,
      body: { error: "chat_disabled", message: "The assistant is switched off on this deployment." },
    };
  }
  const limit = (deps.limiter ?? processLimiter).hit(clientIp(input.headers), now().getTime());
  if (!limit.ok) {
    return {
      status: 429,
      headers: { "retry-after": String(limit.retryAfterS) },
      body: {
        error: "rate_limited",
        message: `You're asking quickly. Try again in ${limit.retryAfterS} seconds.`,
      },
    };
  }
  if (input.body.length > MAX_BODY_CHARS) return bad("That message is too long.");

  let json: unknown;
  try {
    json = JSON.parse(input.body);
  } catch {
    return bad("Expected JSON.");
  }
  const parsed = ChatRequest.safeParse(json);
  if (!parsed.success) {
    return bad(
      "Expected up to 8 short messages, the last one from you, and only the limits and last answer as context.",
    );
  }
  if (parsed.data.messages.some((m) => looksSensitive(m.content))) {
    return bad(
      "That looks like a key, a token or a signed record. Don't paste those here: the assistant doesn't need them.",
      "sensitive_text",
    );
  }

  let mode: "live" | "replay";
  try {
    mode = parseAgentMode(env.AI_MODE);
  } catch {
    mode = "replay";
  }
  let result: ChatResult;
  if (mode === "live" && !takeChatCall(env, now())) {
    result = await runChat({ request: parsed.data, mode: "replay", env });
    result = {
      ...result,
      note: "The assistant has reached today's limit, so this answer comes straight from the store's data.",
    };
  } else {
    result = await runChat({ request: parsed.data, mode, env, ...(deps.model ? { model: deps.model } : {}) });
  }
  return { status: 200, body: result };
}
