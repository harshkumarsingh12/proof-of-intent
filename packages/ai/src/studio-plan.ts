/**
 * The Dispute Studio chat's planner (docs/specs/0007, 0006). It reads the question and the tool results so far and
 * either names the next tool to call or writes the answer, by plain code, with no model.
 *
 * Why: tested live, the model decided every step slowly (3 to 15 s), answered "7 are agent overreach" when 5 were (it
 * reused the count of disputes NOT waiting for a response), opened a refusal to "accept the claim" with "Accepting the
 * claim…", and answered an unknown id with a long irrelevant list. The questions an operator asks most have exact
 * answers in the tool results, so the code gives them: it is instant, always right, and needs no model or recording,
 * so it works the same in replay mode on any database. Anything it doesn't recognize returns undefined and goes to the
 * model as before.
 */
import { z } from "zod";
import type { StudioTurn } from "./studio";

type Item = StudioTurn["history"][number];

// ---------- reading the conversation ----------

export interface ToolResult {
  name: string;
  /** The arguments exactly as the chat recorded them. */
  args: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const Envelope = z.object({ success: z.literal(true), response: z.string() });
const Failure = z.object({
  success: z.literal(false),
  issues: z.array(z.object({ message: z.string() })).optional(),
});

/** ag-studio wraps a tool's result as `{success:true,response:"<json>"}` and a failure as `{success:false,issues:[…]}`. */
function readToolText(text: string): { ok: boolean; data?: unknown; error?: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const wrapped = Envelope.safeParse(json);
  if (wrapped.success) {
    try {
      return { ok: true, data: JSON.parse(wrapped.data.response) };
    } catch {
      return { ok: false, error: "unreadable" };
    }
  }
  const failed = Failure.safeParse(json);
  if (failed.success) return { ok: false, error: failed.data.issues?.[0]?.message ?? "failed" };
  return { ok: true, data: json };
}

/**
 * The shopper's latest question and the tool calls made since it. Earlier questions' calls are ignored, so a follow-up
 * about the same dispute fetches it again instead of trusting an old result.
 */
export function readConversation(history: Item[]): { question: string; calls: ToolResult[] } {
  const lastUser = history.findLastIndex((item) => item.role === "user");
  const question = lastUser >= 0 ? history[lastUser]!.text : "";
  const calls: ToolResult[] = [];
  let pending: { name: string; args: string } | undefined;
  for (const item of history.slice(lastUser + 1)) {
    if (item.role === "assistant") {
      const m = /^Called ([a-z][a-z0-9_]*) with (.*)$/s.exec(item.text);
      pending = m ? { name: m[1]!, args: m[2]! } : undefined;
    } else if (item.role === "tool" && pending) {
      calls.push({ ...pending, ...readToolText(item.text) });
      pending = undefined;
    }
  }
  return { question, calls };
}

const argId = (args: string): string | undefined => {
  try {
    const id = (JSON.parse(args) as { disputeId?: unknown }).disputeId;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
};

// ---------- what the operator asked ----------

const DISPUTE_ID = /\bPP-[A-Z](?:-[A-Z0-9]+)+\b/gi;

/** Dispute ids named in the question (PayPal's `PP-R-ABC-10196898`, the demo's `PP-D-1001`), at most two. */
export const disputeIdsIn = (text: string): string[] =>
  [...new Set([...text.matchAll(DISPUTE_ID)].map((m) => m[0].toUpperCase()))].slice(0, 2);

/** An instruction to take an action, not a question about one ("should I accept it?" is a question). */
const ACTS =
  /^\s*(?:please\s+|pls\s+|go ahead and\s+|just\s+|can you\s+|could you\s+|i want you to\s+)?(?:accept|refund|reject|decline|submit|escalate|settle|resolve|close|approve|send)\b|\b(?:accept|refund|submit|escalate|approve|settle)\b[^?]{0,50}\b(?:now|for me|immediately|right away)\b/i;
const DRAFT = /\b(draft|reply|respond|response|message|email|write)\b/i;
const GLOSSARY = /\b(what (does|is|do|are)|meaning|mean|define|difference between|explain the)\b/i;

export const STUDIO_CANT_ACT =
  "I can't accept claims, submit evidence, send messages or change anything from this chat: it only reads disputes. To act, open the dispute in Disputes and use its buttons (they need the operator login).";

// ---------- the words for classes, actions and reasons ----------

const CLASS_TEXT: Record<string, string> = {
  MANDATE_COMPLIANT:
    "the cart met every limit the shopper signed, so the merchant defends with the signed record",
  AGENT_OVERREACH:
    "the agent bought outside the limits the shopper signed, so the fair move is to accept the claim and refund",
  INTENT_MISREAD: "the item was related but not what the shopper meant, so offer a partial refund or accept",
  NO_MANDATE: "there is no signed record for this order, so standard evidence applies",
};

const ACTION_TEXT: Record<string, string> = {
  PROVIDE_EVIDENCE: "submit the evidence package",
  ACCEPT_CLAIM: "accept the claim and refund the buyer",
  MAKE_OFFER: "make the buyer an offer",
  STANDARD_EVIDENCE: "submit standard evidence for the PayPal reason",
};

const REASON_TEXT: Record<string, string> = {
  SCHEMA_INVALID: "the request was malformed",
  SIGNATURE_INVALID: "a signature didn't verify",
  UNKNOWN_KEY: "the signing key isn't registered",
  NONCE_REPLAYED: "the payment request was reused",
  MANDATE_MISMATCH: "the cart, payment and intent didn't point at each other",
  MANDATE_NOT_YET_VALID: "the intent wasn't valid yet",
  MANDATE_EXPIRED: "the intent had expired",
  CART_EXPIRED: "the cart had expired",
  CURRENCY_MISMATCH: "the currency differed from the limit's",
  AMOUNT_EXCEEDS_MAX: "the price was above the shopper's maximum",
  BUDGET_EXCEEDED: "it would have gone over the shopper's total budget",
  MERCHANT_NOT_ALLOWED: "the merchant wasn't on the shopper's list",
  SKU_NOT_ALLOWED: "the product wasn't on the shopper's list",
  ATTRIBUTE_MISMATCH: "the item didn't match the shopper's color or category",
  QUANTITY_EXCEEDS_MAX: "the quantity was above the limit",
  ADDRESS_MISMATCH: "it shipped to a different address",
  RECURRENCE_EXCEEDED: "the shopper's order limit for the period was reached",
  CATALOG_MISMATCH: "the cart's product or price didn't match the merchant's catalog",
  SEMANTIC_UNCERTAIN: "the semantic check wasn't sure it was what they meant",
  SEMANTIC_MISMATCH: "the semantic check said it wasn't what they described",
};

const CHECK_TEXT: Record<string, string> = {
  amount_max: "price limit",
  budget_cap: "total budget",
  "attributes.color": "color",
  "attributes.category": "item type",
  merchant_allowlist: "merchant",
  quantity_max: "quantity",
  sku_allowlist: "product",
  shipping_address_hash: "shipping address",
};

const STATUS_TEXT: Record<string, string> = {
  WAITING_FOR_SELLER_RESPONSE: "waiting for your response",
  ACTION_REQUIRED: "action required",
  UNDER_REVIEW: "under PayPal's review",
  RESOLVED: "resolved",
};

/** `2026-11-17T04:59:59.000Z` → `2026-11-17 04:59 UTC`: a time a person can read, in a fixed zone. */
export const readableTime = (iso: string) =>
  `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const tick = (code: string) => `\`${code}\``;

// ---------- one dispute ----------

const Explain = z
  .object({
    id: z.string(),
    class: z.string(),
    action: z.string(),
    reasons: z.array(z.string()).default([]),
    failedChecks: z.array(z.string()).default([]),
    mandateHash: z.string().optional(),
    status: z.string().optional(),
    amount: z.string().optional(),
    respondBy: z.string().optional(),
  })
  .passthrough();
type Explain = z.infer<typeof Explain>;

const Draft = z.object({ id: z.string(), draft: z.string() }).passthrough();

function describeDispute(e: Explain, draft?: string): string {
  const lines = [
    `${tick(e.id)} is ${tick(e.class)}: ${CLASS_TEXT[e.class] ?? "see the dispute for the reason"}.`,
  ];
  if (e.failedChecks.length > 0) {
    const broken = e.failedChecks.map((c) => CHECK_TEXT[c] ?? c).join(", ");
    const why = e.reasons.map((r) => `${tick(r)}: ${REASON_TEXT[r] ?? r}`).join("; ");
    lines.push(`Broken limits: ${broken}${why ? ` (${why})` : ""}.`);
  } else if (e.class === "MANDATE_COMPLIANT") {
    lines.push("No limit was broken.");
  }
  lines.push(`Recommended: ${ACTION_TEXT[e.action] ?? e.action.toLowerCase()} (${tick(e.action)}).`);
  // A deadline only means something while a response is owed: a resolved dispute has nothing left to respond to.
  const owed = !e.status || e.status === "WAITING_FOR_SELLER_RESPONSE" || e.status === "ACTION_REQUIRED";
  const facts = [
    e.status ? `Status: ${STATUS_TEXT[e.status] ?? e.status.toLowerCase().replace(/_/g, " ")}` : undefined,
    e.respondBy && owed ? `respond by ${readableTime(e.respondBy)}` : undefined,
    e.amount ? `amount ${e.amount}` : undefined,
  ].filter(Boolean);
  if (facts.length > 0) lines.push(`${facts.join(", ")}.`);
  if (e.mandateHash) lines.push(`Signed mandate: ${tick(e.mandateHash)}.`);
  if (draft)
    lines.push(
      `Draft reply for the buyer (nothing has been sent; you review it first):\n> ${draft.replace(/\s+/g, " ")}`,
    );
  return lines.join("\n");
}

const notFound = (id: string) =>
  `I couldn't find a dispute ${tick(id)}. Ids look like ${tick("PP-D-1001")}. Ask "which disputes need my attention?" to see the ones I can read.`;

// ---------- terms, for "what does X mean" ----------

/** Classes, actions and reason codes named in the question, as the exact codes. */
function termsIn(text: string): string[] {
  const upper = text.toUpperCase();
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const code of [...Object.keys(CLASS_TEXT), ...Object.keys(ACTION_TEXT), ...Object.keys(REASON_TEXT)])
    if (upper.includes(code)) found.add(code);
  if (/\boverreach/.test(lower)) found.add("AGENT_OVERREACH");
  if (/\bcompliant\b/.test(lower)) found.add("MANDATE_COMPLIANT");
  if (/\bmisread\b/.test(lower)) found.add("INTENT_MISREAD");
  if (/\bno mandate\b/.test(lower)) found.add("NO_MANDATE");
  return [...found].slice(0, 3);
}

const classOf = (terms: string[]) => terms.find((t) => t in CLASS_TEXT);

function define(terms: string[]): string {
  return terms
    .map((t) => {
      if (t in CLASS_TEXT) return `${tick(t)}: ${CLASS_TEXT[t]}.`;
      if (t in ACTION_TEXT) return `${tick(t)}: ${ACTION_TEXT[t]}.`;
      return `${tick(t)}: ${REASON_TEXT[t]}.`;
    })
    .join("\n");
}

// ---------- the list ----------

const DisputeList = z.object({
  counts: z.object({
    total: z.number().int().nonnegative(),
    needResponse: z.number().int().nonnegative(),
    other: z.number().int().nonnegative().optional(),
    byClass: z.record(z.number().int().nonnegative()).optional(),
  }),
  disputes: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
        needsResponse: z.boolean(),
        class: z
          .string()
          .regex(/^[A-Z_]+$/)
          .optional(),
        amount: z
          .string()
          .regex(/^[A-Z]{3} \d+\.\d{2}$/)
          .optional(),
        respondBy: z.string().datetime().optional(),
      }),
    )
    .max(50),
});
type DisputeList = z.infer<typeof DisputeList>;
type Row = DisputeList["disputes"][number];

const rowLine = (d: Row) =>
  [
    `- ${tick(d.id)}`,
    d.class ? tick(d.class) : "Awaiting analysis",
    d.amount,
    d.respondBy ? `respond by ${readableTime(d.respondBy)}` : "Response deadline unavailable",
  ]
    .filter(Boolean)
    .join(" · ");

/** Who is waiting for the operator, in the list's own order (soonest deadline first). */
export function attentionText({ counts, disputes }: DisputeList): string | undefined {
  const waiting = disputes.filter((d) => d.needsResponse);
  if (counts.needResponse > counts.total || waiting.length > counts.needResponse) return undefined;
  return [
    `${counts.needResponse} of ${counts.total} loaded disputes need your response.`,
    ...waiting.map(rowLine),
    ...(counts.needResponse > waiting.length
      ? [
          `Showing ${waiting.length} of the ${counts.needResponse} disputes needing a response. Open Disputes for the remaining cases.`,
        ]
      : []),
  ].join("\n");
}

type ListIntent = "count" | "first" | "attention" | "class";

function listIntent(question: string, terms: string[]): ListIntent | undefined {
  if (/\b(how many|number of|count|total|breakdown|summary|overview)\b/i.test(question)) return "count";
  if (
    /\b(first|priority|prioriti[sz]e|urgent|urgently|soonest|next|should i (handle|do|start|deal))\b/i.test(
      question,
    )
  )
    return "first";
  if (/\b(waiting|needs?|attention|respond|response|due|deadline|pending|open|action)\b/i.test(question))
    return "attention";
  if (classOf(terms) && /\b(which|list|show|all|any)\b/i.test(question)) return "class";
  return undefined;
}

function answerFromList(
  intent: ListIntent,
  question: string,
  terms: string[],
  data: DisputeList,
): string | undefined {
  const { counts, disputes } = data;
  const cls = classOf(terms);
  const waiting = disputes.filter((d) => d.needsResponse);
  if (intent === "attention") return attentionText(data);

  if (intent === "first") {
    if (waiting.length === 0) return "Nothing is waiting for your response right now.";
    const [top, ...rest] = waiting;
    const head = `Start with ${tick(top!.id)}${top!.class ? ` (${tick(top!.class)}${top!.amount ? `, ${top!.amount}` : ""})` : ""}: it is due soonest${top!.respondBy ? `, respond by ${readableTime(top!.respondBy)}` : ""}.`;
    const next = rest.slice(0, 2).map(rowLine);
    return [head, ...(next.length ? ["Then:", ...next] : [])].join("\n");
  }

  const byClass = counts.byClass;
  if (intent === "class" || (intent === "count" && cls)) {
    if (!cls) return undefined;
    // Without counts over every dispute the total for a class can't be stated, and guessing it is how a wrong number got out.
    if (!byClass) return undefined;
    const n = byClass[cls] ?? 0;
    const shown = disputes.filter((d) => d.class === cls);
    const lead = `${n === 1 ? "There is" : "There are"} ${n} ${tick(cls)} dispute${n === 1 ? "" : "s"} out of ${counts.total}.`;
    if (shown.length === 0) return lead;
    return [
      lead,
      ...shown.map(rowLine),
      ...(n > shown.length ? [`Showing ${shown.length} of the ${n}. Open Disputes for the rest.`] : []),
    ].join("\n");
  }

  // A plain count.
  if (/\b(need|waiting|respond|response|pending|open)\b/i.test(question) && !cls) {
    const other = counts.other ?? counts.total - counts.needResponse;
    return `${counts.needResponse} of ${counts.total} disputes need your response; ${other} ${other === 1 ? "doesn't" : "don't"}.`;
  }
  if (!byClass) return undefined;
  const parts = Object.entries(byClass)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${tick(k)}`);
  const other = counts.other ?? counts.total - counts.needResponse;
  return `${counts.total} disputes: ${parts.join(", ")}. ${counts.needResponse} need your response; ${other} ${other === 1 ? "doesn't" : "don't"}.`;
}

// ---------- the plan ----------

export type Plan =
  { kind: "call"; name: string; args: Record<string, string> } | { kind: "answer"; text: string };

/**
 * The next step for this turn, or undefined when the question isn't one the code can answer exactly (then the model
 * takes it). Never calls a tool the turn wasn't offered, and stays out of structured-output and forced-tool turns.
 */
export function planStudio(turn: StudioTurn): Plan | undefined {
  if (turn.format || turn.toolChoice === "required" || typeof turn.toolChoice === "object") return undefined;
  const { question, calls } = readConversation(turn.history);
  if (!question.trim()) return undefined;

  const offered = (name: string) => turn.tools.some((t) => t.name === name);
  const canCall = turn.toolChoice !== "none";
  const call = (name: string, args: Record<string, string>): Plan | undefined =>
    offered(name) && canCall ? { kind: "call", name, args } : undefined;
  const resultFor = (name: string, id?: string) =>
    calls.find((c) => c.name === name && (id === undefined || argId(c.args) === id));
  const answer = (text: string): Plan => ({ kind: "answer", text });

  const ids = disputeIdsIn(question);
  const acts = ACTS.test(question.trim());
  const terms = termsIn(question);

  // Named disputes: fetch each one's recommendation (and the buyer draft when asked), then write it up.
  if (ids.length > 0 && offered("explain_dispute")) {
    const wantsDraft = DRAFT.test(question) && offered("draft_buyer_message");
    for (const id of ids) {
      const explained = resultFor("explain_dispute", id);
      if (!explained) return call("explain_dispute", { disputeId: id });
      if (explained.ok && wantsDraft && !resultFor("draft_buyer_message", id))
        return call("draft_buyer_message", { disputeId: id });
    }
    const blocks = ids.map((id) => {
      const explained = resultFor("explain_dispute", id)!;
      const parsed = explained.ok ? Explain.safeParse(explained.data) : undefined;
      if (!parsed?.success) return explained.ok ? undefined : notFound(id);
      const drafted = resultFor("draft_buyer_message", id);
      const draft = drafted?.ok ? Draft.safeParse(drafted.data) : undefined;
      return describeDispute(parsed.data, draft?.success ? draft.data.draft : undefined);
    });
    if (blocks.some((b) => b === undefined)) return undefined;
    return answer([...(acts ? [STUDIO_CANT_ACT] : []), ...blocks].join("\n\n"));
  }

  if (ids.length === 0) {
    if (acts)
      return answer(
        `${STUDIO_CANT_ACT} Name a dispute (like ${tick("PP-D-1002")}) and I'll tell you what it recommends.`,
      );
    if (
      terms.length > 0 &&
      GLOSSARY.test(question) &&
      !/\b(how many|number of|count|which|list)\b/i.test(question)
    )
      return answer(define(terms));
    const intent = listIntent(question, terms);
    if (intent && offered("list_disputes")) {
      const listed = resultFor("list_disputes");
      if (!listed) return call("list_disputes", {});
      const parsed = listed.ok ? DisputeList.safeParse(listed.data) : undefined;
      const text = parsed?.success ? answerFromList(intent, question, terms, parsed.data) : undefined;
      return text ? answer(text) : undefined;
    }
  }
  return undefined;
}

/**
 * True when a model's answer says it carried out something the chat can't do ("I've accepted the claim", "Accepting the
 * claim for…"): it is read-only, so that sentence is false however the rest reads.
 */
export const claimsAnAction = (text: string): boolean =>
  /\b(?:i|we)(?:'ve| have| just|'ll| will)?\s+(?:accepted|refunded|submitted|sent|escalated|approved|closed|resolved|issued)\b/i.test(
    text.replace(/’/g, "'"),
  ) || /^\s*(?:accepting|refunding|submitting|escalating|approving|closing)\b/i.test(text);
