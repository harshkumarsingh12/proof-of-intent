/**
 * `pnpm ai:check`: does an endpoint do the two things this app needs from a model? A structured answer (J1, J2, J3 and
 * the Studio chat all use one) and a tool call (the buyer agent's search and checkout tools). It talks to one endpoint at
 * a time, never the backup logic, so a working primary can't hide a broken backup. Keys are never printed.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateObject, generateText, tool } from "ai";
import { z } from "zod";
import { providerOptionsFor, type Endpoint } from "./runtime";

export interface CheckStep {
  ok: boolean;
  ms: number;
  detail: string;
}

export interface CheckResult {
  provider: string;
  model: string;
  structured: CheckStep;
  /** Tool calling works when it is forced (`toolChoice: required`). A failure here means the endpoint can't run tools. */
  tools: CheckStep;
  /**
   * Whether the model decides to call a tool on its own when asked a question it can't know the answer to. Informational:
   * a model that skips the tool answers from guesswork, so the app must not rely on it for facts (retrieve first).
   */
  autoTools: CheckStep;
}

const TIMEOUT_MS = 30_000;

async function timed(run: () => Promise<string>): Promise<CheckStep> {
  const started = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - started, detail };
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    return { ok: false, ms: Date.now() - started, detail: `${status ? `HTTP ${status}: ` : ""}${message}` };
  }
}

export async function checkEndpoint(e: Endpoint, fetchImpl?: typeof fetch): Promise<CheckResult> {
  const host = createOpenAICompatible({
    name: e.provider,
    baseURL: e.baseURL,
    apiKey: e.apiKey,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const model = host.chatModel(e.model);
  const providerOptions = providerOptionsFor(e.provider);

  const structured = await timed(async () => {
    const { object } = await generateObject({
      model,
      schema: z.object({ fit: z.enum(["match", "partial", "mismatch"]) }),
      system: "You check whether a shopping cart fits what a shopper asked for.",
      prompt: "The shopper asked for a grey running jacket. The cart holds one grey running jacket.",
      temperature: 0,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      providerOptions,
    });
    return `answered fit=${object.fit}`;
  });

  const toolCheck = (forced: boolean) =>
    timed(async () => {
      let called = 0;
      const { text } = await generateText({
        model,
        tools: {
          look_up_color: tool({
            description: "Looks up the color of a product in the store.",
            parameters: z.object({ product: z.string() }),
            execute: async () => {
              called++;
              return { color: "grey" };
            },
          }),
        },
        maxSteps: 3,
        ...(forced ? { toolChoice: "required" as const } : {}),
        temperature: 0,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        providerOptions,
        prompt:
          "What color is the Stride Running Jacket? Use the look_up_color tool, then answer in one short sentence.",
      });
      if (called === 0)
        throw new Error(
          `it answered without the tool${forced ? "" : " (it would be guessing)"}: ${text.replace(/\s+/g, " ").slice(0, 60)}`,
        );
      return `called the tool ${called} time${called === 1 ? "" : "s"}`;
    });
  const tools = await toolCheck(true);
  const autoTools = await toolCheck(false);

  return { provider: e.provider, model: e.model, structured, tools, autoTools };
}
