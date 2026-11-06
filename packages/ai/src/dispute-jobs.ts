import { DisputeClass } from "@poi/contracts";
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

const action = z.enum(["PROVIDE_EVIDENCE", "ACCEPT_CLAIM", "MAKE_OFFER", "STANDARD_EVIDENCE"]);
const citedText = z.object({ text: z.string().trim().min(1), cites: z.array(z.string()) }).strict();

export const DisputeClassification = z
  .object({
    class: DisputeClass,
    confidence: z.number().min(0).max(1),
    recommended_action: action,
    reasons: z.array(citedText),
    evidence_plan: z.array(citedText),
  })
  .strict();
export type DisputeClassification = z.infer<typeof DisputeClassification>;

const citedSection = z
  .object({
    heading: z.string().trim().min(1),
    body: z.string().trim().min(1),
    cites: z.array(z.string()),
  })
  .strict();

const GroundedDraft = z
  .object({
    cover_note: citedText,
    attestation_sections: z.array(citedSection),
    buyer_message: citedText,
  })
  .strict();

/** Worker and dashboard shape. The model receives the stricter, cited draft schema. */
export const EvidenceDraft = z.object({
  cover_note: z.string(),
  attestation_sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  buyer_message: z.string(),
});
export type EvidenceDraft = z.infer<typeof EvidenceDraft>;

export interface DisputeJobInput {
  decision: { class: DisputeClass; action: z.infer<typeof action> };
  /** Named, limited projections of the evidence. Never pass a raw mandate, webhook or audit row. */
  bundle: Record<string, string>;
}

const j2 = {
  id: "J2",
  name: "j2-dispute-classification",
  timeoutMs: 5_000,
  prompt: loadPrompt("j2-dispute-classification"),
};
export const J2_REPLAY = j2.name;
export const J2_PROMPT_VERSION = j2.prompt.version;
const j3 = {
  id: "J3",
  name: "j3-evidence-drafting",
  timeoutMs: 10_000,
  prompt: loadPrompt("j3-evidence-drafting"),
};

/** Scrub model-bound excerpts as well as output. Structured keys, ids and addresses are omitted by the caller. */
function scrub(text: string): string {
  return redact(
    text
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[credential]")
      .replace(
        /\b(?:vault[ _-]?(?:id|token)|(?:api|private|signing)[ _-]?key|password|bearer)(?:\s*[:=]\s*|\s+)[\w./+=-]+/gi,
        "[credential]",
      )
      .replace(
        /\b(?:nvapi-|sk-|shp_|agt_)[A-Z0-9_-]{8,}|\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+/gi,
        "[credential]",
      )
      .replace(
        /\b\d{1,6}[ \t]+(?:[\p{L}\d.'-]+[ \t]+){1,6}(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl)\b[^\n;]*/giu,
        "[address]",
      )
      .replace(/\b(?:ship|send|deliver)(?:\s+(?:it|them))?\s+to\b[^\n;.!?]*/gi, "[delivery instruction]"),
  );
}

export function disputeJobInput(input: DisputeJobInput): DisputeJobInput {
  return {
    decision: input.decision,
    bundle: Object.fromEntries(Object.entries(input.bundle).map(([id, fact]) => [id, scrub(fact)])),
  };
}

export const j2ReplayKey = (input: DisputeJobInput): string =>
  replayKey(j2.id, J2_PROMPT_VERSION, disputeJobInput(input));

const hasValidCitations = ({ cites }: { cites: string[] }, bundle: DisputeJobInput["bundle"]) =>
  cites.length > 0 && cites.every((id) => Object.hasOwn(bundle, id));

async function run<T>(
  job: typeof j2,
  input: DisputeJobInput,
  schema: z.ZodType<T>,
  mode: AiMode,
  generate?: Generate,
): Promise<T> {
  if (mode === "live") {
    return generateWithRetry(job.id, generate ?? generateFromEnv(job.id), {
      system: job.prompt.text,
      prompt: `${dataBlock("decision", input.decision)}\n\n${dataBlock("bundle", input.bundle)}`,
      schema,
      timeoutMs: job.timeoutMs,
    });
  }

  const hit = readReplay<T>(job.name)[replayKey(job.id, job.prompt.version, input)];
  const result = schema.safeParse(hit?.output);
  if (!result.success) throw new AiUnavailableError(job.id, "no valid replay response for this dispute");
  return result.data;
}

export async function classifyDispute(input: DisputeJobInput, mode: AiMode, generate?: Generate) {
  const safe = disputeJobInput(input);
  const output = await run(j2, safe, DisputeClassification, mode, generate);
  if (
    output.confidence === 0 ||
    output.class !== safe.decision.class ||
    output.recommended_action !== safe.decision.action
  ) {
    throw new AiUnavailableError(j2.id, "response does not support the policy decision");
  }
  const grounded = (items: DisputeClassification["reasons"]) =>
    items
      .filter((item) => hasValidCitations(item, safe.bundle))
      .map((item) => ({ ...item, text: scrub(item.text) }));
  return {
    ...output,
    reasons: grounded(output.reasons),
    evidence_plan: grounded(output.evidence_plan),
    prompt_version: j2.prompt.version,
    source: mode,
  };
}

export async function draftEvidence(input: DisputeJobInput, mode: AiMode, generate?: Generate) {
  if (input.decision.class !== "MANDATE_COMPLIANT" || input.decision.action !== "PROVIDE_EVIDENCE") {
    throw new AiUnavailableError(j3.id, "the policy decision does not support a defence draft");
  }
  const safe = disputeJobInput(input);
  const output = await run(j3, safe, GroundedDraft, mode, generate);
  if (
    !hasValidCitations(output.cover_note, safe.bundle) ||
    !hasValidCitations(output.buyer_message, safe.bundle)
  ) {
    throw new AiUnavailableError(j3.id, "the cover note or buyer message has no valid citations");
  }
  const sections = output.attestation_sections.filter((section) => hasValidCitations(section, safe.bundle));
  return {
    cover_note: scrub(output.cover_note.text),
    buyer_message: scrub(output.buyer_message.text),
    attestation_sections: sections.map(({ heading, body }) => ({
      heading: scrub(heading),
      body: scrub(body),
    })),
    citations: {
      cover_note: output.cover_note.cites,
      buyer_message: output.buyer_message.cites,
      attestation_sections: sections.map(({ cites }) => cites),
    },
    prompt_version: j3.prompt.version,
    source: mode,
  };
}
