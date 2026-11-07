/**
 * The four LLM jobs behind typed contracts. Spec: docs/specs/0006-ai-jobs.md. Owner: @sumedhag28.
 *
 * Rules that hold for every job: structured output only, temperature 0, no side effects
 * (models never call PayPal), and J1 can only lower a verdict, never raise it.
 * `AI_MODE=replay` serves recorded responses so the stack runs with no API key.
 */
export {
  AiUnavailableError,
  isAiUnavailable,
  liveConfigFromEnv,
  parseAiMode,
  redact,
  type AiMode,
  type Generate,
  type GenerateRequest,
} from "./runtime";
export {
  J1_PROMPT_VERSION,
  J1_TIMEOUT_MS,
  SemanticFit,
  j1Input,
  j1ReplayKey,
  semanticFit,
  type J1Result,
  type SemanticFitOptions,
} from "./j1";

export {
  DisputeClassification,
  EvidenceDraft,
  classifyDispute,
  draftEvidence,
  type DisputeJobInput,
} from "./dispute-jobs";

/** Confidence thresholds from docs/specs/0003. */
export const APPROVE_AT = 0.8;
export const STEP_UP_AT = 0.5;

export { J4_PROMPT_VERSION, runStudioTurn, StudioTurn } from "./studio";
