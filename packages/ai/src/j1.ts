/**
 * J1 semantic fit: does the cart fit the shopper's own words? Spec: docs/specs/0006-ai-jobs.md, used by
 * checkout stage 1 (docs/specs/0003) only after every hard rule passed. It can only lower a verdict.
 */
import type { CartMandate } from "@poi/contracts";
import { z } from "zod";
import {
  AiUnavailableError,
  dataBlock,
  generateFromEnv,
  generateWithRetry,
  loadPrompt,
  readReplay,
  redact,
  replayKey,
  type AiMode,
  type Generate,
} from "./runtime";

export const SemanticFit = z.object({
  fit: z.enum(["match", "partial", "mismatch"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  matched_attributes: z.array(z.string()),
  conflicting_attributes: z.array(z.string()),
});
export type SemanticFit = z.infer<typeof SemanticFit>;

/** What J1 returns: the model's answer plus where it came from, for the audit log (spec 0006). */
export type J1Result = SemanticFit & { prompt_version: string; source: "live" | "replay" | "guard" };

export const J1_JOB = "J1";
export const J1_REPLAY = "j1-semantic-fit";
/** Spec 0006 budget, per attempt. */
export const J1_TIMEOUT_MS = 2000;

const prompt = loadPrompt("j1-semantic-fit");
export const J1_PROMPT_VERSION = prompt.version;

/**
 * Exactly what the model sees, and so exactly what the replay key covers. No ids, no merchant, no address:
 * two carts with the same lines get the same answer.
 */
export function j1Input(description: string, cart: CartMandate) {
  return {
    shopper_request: redact(description),
    cart: {
      lines: cart.contents.lines.map((l) => ({
        title: l.title,
        sku: l.sku,
        attributes: l.attributes,
        unit_price: l.unit_price,
        quantity: l.quantity,
      })),
      total: cart.contents.total,
    },
  };
}

export const j1ReplayKey = (description: string, cart: CartMandate): string =>
  replayKey(J1_JOB, J1_PROMPT_VERSION, j1Input(description, cart));

/**
 * Text that tries to instruct whoever reads the cart. Caught before any model sees it, so the answer can't
 * depend on whether the model resisted.
 */
const INJECTION =
  /\b(ignore|disregard|override|bypass|forget)\b[^.]{0,40}\b(budget|limit|rule|instruction|constraint|polic(y|ies)|previous)|\bapprove (this|the) (order|cart|purchase)\b|\b(system|assistant) ?(prompt|message)\b/i;
const ROAD_SHOES = /\broad[- ]+(?:running[- ]+)?shoes?\b/i;
const TRAIL_SHOES = /\btrail[- ]+(?:running[- ]+)?shoes?\b/i;

function cartText(cart: CartMandate): string {
  return cart.contents.lines
    .flatMap((l) => [l.title, l.sku, ...Object.keys(l.attributes), ...Object.values(l.attributes)])
    .join("\n");
}

export interface SemanticFitOptions {
  /** The live model call. Defaults to the AI SDK configured from AI_PROVIDER, AI_MODEL, AI_API_KEY. */
  generate?: Generate;
}

/**
 * J1. Throws AiUnavailableError when there's no trustworthy answer (unknown input in replay mode, invalid
 * output after a retry, timeout, no key): checkout then asks the shopper instead of the model.
 */
export async function semanticFit(
  description: string,
  cart: CartMandate,
  mode: AiMode,
  options: SemanticFitOptions = {},
): Promise<J1Result> {
  const meta = { prompt_version: J1_PROMPT_VERSION };

  if (INJECTION.test(cartText(cart))) {
    return {
      fit: "mismatch",
      confidence: 1,
      reasons: ["The cart contains text that tries to instruct the checker, so it is treated as a mismatch."],
      matched_attributes: [],
      conflicting_attributes: [],
      ...meta,
      source: "guard",
    };
  }

  if (
    ROAD_SHOES.test(description) &&
    !TRAIL_SHOES.test(description) &&
    cart.contents.lines.some((line) => TRAIL_SHOES.test(line.title) && !ROAD_SHOES.test(line.title))
  ) {
    return {
      fit: "partial",
      confidence: 1,
      reasons: [
        "The cart contains a trail shoe for a road running request. Ask the shopper to confirm the substitution.",
      ],
      matched_attributes: [],
      conflicting_attributes: ["running surface"],
      ...meta,
      source: "guard",
    };
  }

  const input = j1Input(description, cart);
  let fit: SemanticFit;
  if (mode === "replay") {
    const hit = readReplay<SemanticFit>(J1_REPLAY)[j1ReplayKey(description, cart)];
    const parsed = hit && SemanticFit.safeParse(hit.output);
    if (!parsed || !parsed.success)
      throw new AiUnavailableError(J1_JOB, "no recorded response for this cart");
    fit = parsed.data;
  } else {
    const generate = options.generate ?? generateFromEnv(J1_JOB);
    fit = await generateWithRetry(J1_JOB, generate, {
      system: prompt.text,
      prompt: `${dataBlock("shopper_request", input.shopper_request)}\n\n${dataBlock("cart", input.cart)}`,
      schema: SemanticFit,
      timeoutMs: J1_TIMEOUT_MS,
    });
  }

  // The model's own words can't support a "match" it contradicts.
  if (fit.fit === "match" && fit.conflicting_attributes.length > 0) fit = { ...fit, fit: "partial" };
  return { ...fit, ...meta, source: mode };
}
