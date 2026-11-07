/**
 * Voice input (docs/specs/0010). Pure: no DOM, no React, so the rules are unit-tested rather than trusted.
 *
 * What the shopper says only ever becomes text (`HEARD` while listening). The text fills the request box, the agent
 * fills in the limits, and the shopper can edit them or speak again. Nothing is signed or bought from a spoken sentence:
 * signing is the shopper's own click on "Sign my intent".
 */

export type VoicePhase = "idle" | "listening" | "drafting" | "failed";

export interface VoiceState {
  phase: VoicePhase;
  /** What was heard (interim while listening, final afterwards). */
  transcript: string;
  message?: string;
}

export const initialVoice: VoiceState = { phase: "idle", transcript: "" };

export type VoiceEvent =
  | { type: "LISTEN" }
  | { type: "HEARD"; text: string; final: boolean }
  | { type: "LISTEN_ENDED" }
  | { type: "DRAFTED" }
  | { type: "FAILED"; message: string }
  | { type: "CANCEL" };

const NOT_HEARD = "I didn't catch that. Try again, or type it.";

const idle = (message?: string): VoiceState => ({
  phase: "idle",
  transcript: "",
  ...(message ? { message } : {}),
});

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "LISTEN":
      return state.phase === "idle" || state.phase === "failed" ? { phase: "listening", transcript: "" } : state;
    case "HEARD": {
      // Speech is text only while listening. In every other phase it is not looked at here at all.
      if (state.phase !== "listening") return state;
      if (!event.final) return { ...state, transcript: event.text };
      const text = event.text.trim();
      return text ? { phase: "drafting", transcript: text } : idle(NOT_HEARD);
    }
    case "LISTEN_ENDED":
      return state.phase === "listening" ? idle(NOT_HEARD) : state;
    // The agent filled in the limits. The shopper can edit them, or speak again to replace them.
    case "DRAFTED":
      return state.phase === "drafting" ? idle() : state;
    case "FAILED":
      return state.phase === "idle"
        ? state
        : { phase: "failed", transcript: state.transcript, message: event.message };
    case "CANCEL":
      return state.phase === "idle" ? state : idle();
  }
}
