/**
 * Voice ordering (docs/specs/0010). Pure: no DOM, no React, no clock (callers pass `at`), so the rules that keep a
 * spoken request from signing by accident are unit-tested rather than trusted.
 *
 * What the shopper says only ever becomes text (`HEARD` while listening). The agent drafts the limits, the shop reads
 * them back, and signing needs a separate confirmation: a tap, or a new utterance after the read-back card is shown.
 */
import { categoryLabel } from "./catalog";
import { dollarsToCents, type IntentForm } from "./intent";

/** A confirmation sooner than this after the card appears is ignored (a stray tap, or the shop's own voice). */
export const MIN_READBACK_MS = 700;
/** The read-back expires: a request spoken now shouldn't be signed by a "confirm" a long time later. */
export const READBACK_TIMEOUT_MS = 60_000;

export type Confirmation = "confirm" | "cancel" | "none";

const CONFIRM = new Set(["confirm", "i confirm", "confirm it", "yes confirm"]);
const CANCEL = new Set(["cancel", "stop", "no", "never mind", "cancel it", "no cancel"]);
const MAX_WORDS = 4;

/**
 * Reads a spoken answer to the read-back. Only a whole, short utterance counts: "buy it and confirm" is `none`, so a
 * request that happens to contain the word can't sign. A bare "yes" is deliberately not a confirmation.
 */
export function parseConfirmation(text: string): Confirmation {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/'/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return "none";
  const said = words.join(" ");
  if (CONFIRM.has(said)) return "confirm";
  if (CANCEL.has(said)) return "cancel";
  return "none";
}

export type ReadBack = { ok: true; lines: string[]; speech: string } | { ok: false; problem: string };

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const spokenDollars = (cents: number) => {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? `${whole} dollars` : `${whole} dollars ${rest} cents`;
};

/**
 * The limits as the shopper is about to sign them, built from the form itself (never from model prose), so what is
 * read back is exactly what `buildIntent` will sign.
 */
export function readBack(form: IntentForm): ReadBack {
  let cents: number;
  try {
    cents = dollarsToCents(form.maxPrice);
  } catch (err) {
    return { ok: false, problem: (err as Error).message };
  }
  if (!form.description.trim()) return { ok: false, problem: "Say what you want the agent to buy" };
  const days = Math.min(Math.max(Math.round(form.validDays), 1), 30);
  const dayWord = `${days} day${days === 1 ? "" : "s"}`;
  const item = form.category ? categoryLabel(form.category) : undefined;
  const lines = [
    `Spend at most ${dollars(cents)}`,
    ...(item ? [`Item: ${item}`] : []),
    ...(form.color ? [`Color: ${form.color}`] : []),
    `Valid for ${dayWord}`,
    `Ask me before every purchase: ${form.confirmEachCart ? "yes" : "no"}`,
  ];
  const speech =
    `You asked the agent to shop for ${item ? item.toLowerCase() : "an item"}` +
    `${form.color ? `, ${form.color}` : ""}, spending at most ${spokenDollars(cents)}, valid for ${dayWord}` +
    `${form.confirmEachCart ? ", and to ask you before every purchase" : ""}. Say confirm to sign this, or cancel.`;
  return { ok: true, lines, speech };
}

export type VoicePhase =
  "idle" | "listening" | "drafting" | "readback" | "confirmed" | "signing" | "choosing" | "done" | "failed";

export interface VoiceState {
  phase: VoicePhase;
  /** What was heard (interim while listening, final afterwards). */
  transcript: string;
  /** The drafted limits that were read back. Signing uses exactly this. */
  snapshot?: IntentForm;
  /** When the read-back card appeared (ms). */
  shownAt?: number;
  message?: string;
}

export const initialVoice: VoiceState = { phase: "idle", transcript: "" };

export type VoiceEvent =
  | { type: "LISTEN" }
  | { type: "HEARD"; text: string; final: boolean }
  | { type: "LISTEN_ENDED" }
  | { type: "DRAFTED"; form: IntentForm; at: number }
  | { type: "CONFIRM"; at: number }
  | { type: "CONFIRM_HEARD"; text: string; at: number }
  | { type: "EDITED" }
  | { type: "TIMEOUT"; at: number }
  | { type: "SIGNING" }
  | { type: "CHOOSING" }
  | { type: "DONE" }
  | { type: "FAILED"; message: string }
  | { type: "CANCEL" };

const NOT_HEARD = "I didn't catch that. Try again, or type it.";
const TOO_LONG = "That took too long, so nothing was signed. Say or type your request again.";

const idle = (message?: string): VoiceState => ({
  phase: "idle",
  transcript: "",
  ...(message ? { message } : {}),
});

/** The one place a spoken or tapped confirmation becomes `confirmed`, with every guard in it. */
function confirm(state: VoiceState, at: number): VoiceState {
  if (state.phase !== "readback" || !state.snapshot || state.shownAt === undefined) return state;
  const age = at - state.shownAt;
  if (age > READBACK_TIMEOUT_MS) return idle(TOO_LONG);
  if (age < MIN_READBACK_MS) return state;
  return { ...state, phase: "confirmed" };
}

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "LISTEN":
      return state.phase === "idle" || state.phase === "done" || state.phase === "failed"
        ? { phase: "listening", transcript: "" }
        : state;
    case "HEARD": {
      // Speech is text only while listening. In every other phase it is not looked at here at all.
      if (state.phase !== "listening") return state;
      if (!event.final) return { ...state, transcript: event.text };
      const text = event.text.trim();
      return text ? { phase: "drafting", transcript: text } : idle(NOT_HEARD);
    }
    case "LISTEN_ENDED":
      return state.phase === "listening" ? idle(NOT_HEARD) : state;
    case "DRAFTED":
      return state.phase === "drafting"
        ? { phase: "readback", transcript: state.transcript, snapshot: event.form, shownAt: event.at }
        : state;
    case "CONFIRM":
      return confirm(state, event.at);
    case "CONFIRM_HEARD": {
      if (state.phase !== "readback") return state;
      const said = parseConfirmation(event.text);
      if (said === "confirm") return confirm(state, event.at);
      if (said === "cancel") return idle();
      return state;
    }
    case "EDITED":
      return state.phase === "readback"
        ? idle("You changed the limits, so that read-back no longer applies. Speak or tap to start again.")
        : state;
    case "TIMEOUT":
      return state.phase === "readback" &&
        state.shownAt !== undefined &&
        event.at - state.shownAt >= READBACK_TIMEOUT_MS
        ? idle(TOO_LONG)
        : state;
    case "SIGNING":
      return state.phase === "confirmed" ? { ...state, phase: "signing" } : state;
    case "CHOOSING":
      return state.phase === "signing" ? { ...state, phase: "choosing" } : state;
    case "DONE":
      return state.phase === "choosing" ? { ...state, phase: "done" } : state;
    case "FAILED":
      return state.phase === "idle"
        ? state
        : { phase: "failed", transcript: state.transcript, message: event.message };
    case "CANCEL":
      return state.phase === "idle" ? state : idle();
  }
}
