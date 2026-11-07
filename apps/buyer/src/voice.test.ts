import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { initialVoice, voiceReducer, type VoiceEvent, type VoiceState } from "./voice";

/** Runs a script of events from the idle state. */
const run = (events: VoiceEvent[], from: VoiceState = initialVoice) => events.reduce(voiceReducer, from);

describe("the voice flow: what is said fills the limits, and nothing is signed", () => {
  test("a spoken request is drafted into the limits and ends idle, ready to be edited or spoken again", () => {
    const heard = run([{ type: "LISTEN" }, { type: "HEARD", text: "a grey running jacket under $80", final: true }]);
    expect(heard).toMatchObject({ phase: "drafting", transcript: "a grey running jacket under $80" });
    expect(voiceReducer(heard, { type: "DRAFTED" })).toMatchObject({ phase: "idle", transcript: "" });
  });

  test("a request that contains 'confirm' is only text: it is drafted like any other and signs nothing", () => {
    const heard = run([
      { type: "LISTEN" },
      { type: "HEARD", text: "buy a grey running jacket under $80 and confirm", final: true },
    ]);
    expect(heard.phase).toBe("drafting");
    // There is no confirmation or signing phase to reach: the flow can only end idle or failed.
    const phases = new Set(
      [heard, voiceReducer(heard, { type: "DRAFTED" }), voiceReducer(heard, { type: "FAILED", message: "x" })].map(
        (s) => s.phase,
      ),
    );
    expect([...phases].sort()).toEqual(["drafting", "failed", "idle"]);
  });

  test("speaking again after a fill starts a new request that replaces the limits", () => {
    const filled = run([
      { type: "LISTEN" },
      { type: "HEARD", text: "a red jacket", final: true },
      { type: "DRAFTED" },
    ]);
    expect(voiceReducer(filled, { type: "LISTEN" })).toMatchObject({ phase: "listening", transcript: "" });
  });

  test("speech is only looked at while listening", () => {
    const heard = (from: VoiceState) => voiceReducer(from, { type: "HEARD", text: "confirm", final: true });
    expect(heard(initialVoice)).toBe(initialVoice);
    const drafting = run([{ type: "LISTEN" }, { type: "HEARD", text: "a jacket", final: true }]);
    expect(heard(drafting)).toBe(drafting);
  });

  test("cancel works from listening and from drafting, and does nothing when idle", () => {
    const listening = run([{ type: "LISTEN" }]);
    const drafting = run([{ type: "LISTEN" }, { type: "HEARD", text: "a jacket", final: true }]);
    expect(voiceReducer(listening, { type: "CANCEL" })).toMatchObject({ phase: "idle", transcript: "" });
    expect(voiceReducer(drafting, { type: "CANCEL" })).toMatchObject({ phase: "idle", transcript: "" });
    expect(voiceReducer(initialVoice, { type: "CANCEL" })).toBe(initialVoice);
  });

  test("silence ends the listening, an empty result says so, and a failure can be retried", () => {
    expect(voiceReducer(run([{ type: "LISTEN" }]), { type: "LISTEN_ENDED" })).toMatchObject({
      phase: "idle",
    });
    expect(run([{ type: "LISTEN" }, { type: "HEARD", text: "  ", final: true }]).message).toMatch(
      /didn't catch/,
    );
    // The recognizer's end event arrives after a final result: it must not undo the drafting that began.
    const drafting = run([{ type: "LISTEN" }, { type: "HEARD", text: "a jacket", final: true }]);
    expect(voiceReducer(drafting, { type: "LISTEN_ENDED" })).toBe(drafting);
    const failed = voiceReducer(drafting, { type: "FAILED", message: "The agent is unavailable" });
    expect(failed).toMatchObject({ phase: "failed", message: "The agent is unavailable" });
    expect(voiceReducer(failed, { type: "LISTEN" }).phase).toBe("listening");
  });

  test("interim results only show what is being heard", () => {
    const heard = run([{ type: "LISTEN" }, { type: "HEARD", text: "buy a grey", final: false }]);
    expect(heard).toMatchObject({ phase: "listening", transcript: "buy a grey" });
  });
});

describe("voice never touches how the order is paid", () => {
  test("neither voice module mentions the 'agent pays alone' setting", () => {
    // The setting is its own state in ShopFlow, not part of the form, so a drafted form can't carry it; these
    // modules must never reach for it either.
    for (const file of ["voice.ts", "../app/shop/useVoice.ts"]) {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      expect(source, file).not.toMatch(/alone/i);
      expect(source, file).not.toMatch(/human_present|humanPresent/);
    }
  });
});
