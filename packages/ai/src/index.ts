/**
 * The four LLM jobs behind typed contracts. Spec: docs/specs/0006-ai-jobs.md. Owner: @sumedhag28.
 *
 * Rules that hold for every job: structured output only, temperature 0, no side effects
 * (models never call PayPal), and J1 can only lower a verdict, never raise it.
 * `AI_MODE=replay` serves recorded responses so the stack runs with no API key.
 */
import { z } from "zod";
import { DisputeClass, NotImplementedError, type CartMandate } from "@poi/contracts";

export type AiMode = "live" | "replay";

export function parseAiMode(value: string | undefined): AiMode {
  if (value === undefined || value === "" || value === "replay") return "replay";
  if (value === "live") return "live";
  throw new Error(`AI_MODE must be "live" or "replay", got "${value}"`);
}

/** J1: does the cart fit the shopper's words? */
export const SemanticFit = z.object({
  fit: z.enum(["match", "partial", "mismatch"]),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  matched_attributes: z.array(z.string()),
  conflicting_attributes: z.array(z.string()),
});
export type SemanticFit = z.infer<typeof SemanticFit>;

/** J2: which of the four classes is this dispute? */
export const DisputeClassification = z.object({
  class: DisputeClass,
  confidence: z.number().min(0).max(1),
  recommended_action: z.enum(["PROVIDE_EVIDENCE", "ACCEPT_CLAIM", "MAKE_OFFER", "STANDARD_EVIDENCE"]),
  reasons: z.array(z.object({ text: z.string(), cites: z.array(z.string()) })),
  evidence_plan: z.array(z.string()),
});
export type DisputeClassification = z.infer<typeof DisputeClassification>;

/** J3: evidence drafting. */
export const EvidenceDraft = z.object({
  cover_note: z.string(),
  attestation_sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  buyer_message: z.string(),
});
export type EvidenceDraft = z.infer<typeof EvidenceDraft>;

/** Confidence thresholds from docs/specs/0003. */
export const APPROVE_AT = 0.8;
export const STEP_UP_AT = 0.5;

const OWNER = "sumedhag28";
const SPEC = "docs/specs/0006-ai-jobs.md";

export async function semanticFit(_description: string, _cart: CartMandate, _mode: AiMode): Promise<SemanticFit> {
  throw new NotImplementedError("J1 semanticFit", OWNER, SPEC);
}

export async function classifyDispute(_input: unknown, _mode: AiMode): Promise<DisputeClassification> {
  throw new NotImplementedError("J2 classifyDispute", OWNER, SPEC);
}

export async function draftEvidence(_input: unknown, _mode: AiMode): Promise<EvidenceDraft> {
  throw new NotImplementedError("J3 draftEvidence", OWNER, SPEC);
}
