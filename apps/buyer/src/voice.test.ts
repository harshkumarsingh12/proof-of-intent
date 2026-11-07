import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { IntentForm } from "./intent";
import {
  initialVoice,
  MIN_READBACK_MS,
  parseConfirmation,
  READBACK_TIMEOUT_MS,
  readBack,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from "./voice";

const form: IntentForm = {
  description: "buy a grey running jacket under $80",
  maxPrice: "80",
  category: "running-jacket",
  color: "grey",
  validDays: 7,
  confirmEachCart: false,
};

/** Runs a script of events from the idle state. */
const run = (events: VoiceEvent[], from: VoiceState = initialVoice) => events.reduce(voiceReducer, from);

const T0 = 1_000_000;
/** Everything up to the read-back card being on screen at T0. */
const atReadback = run([
  { type: "LISTEN" },
  { type: "HEARD", text: "buy a grey running jacket under $80", final: true },
  { type: "DRAFTED", form, at: T0 },
]);

describe("parseConfirmation: only a whole, short utterance counts", () => {
  test("accepts the confirmation and cancel phrases, ignoring case, punctuation and accents", () => {
    for (const said of ["confirm", "Confirm.", "I confirm", "confirm it!", "Yes, confirm", "  CONFIRM  "])
      expect(parseConfirmation(said)).toBe("confirm");
    for (const said of ["cancel", "Stop", "no", "never mind", "Cancel it."])
      expect(parseConfirmation(said)).toBe("cancel");
  });

  test("a request that merely contains the word is not a confirmation", () => {
    for (const said of [
      "buy it and confirm",
      "buy a grey running jacket under 80 dollars and confirm",
      "do not confirm",
      "don't confirm",
      "confirm the purchase of the jacket please",
      "yes",
      "yeah sure",
      "ok",
      "",
      "   ",
    ])
      expect(parseConfirmation(said)).toBe("none");
  });
});

describe("readBack: built from the form, exactly what will be signed", () => {
  test("lists the limits and reads them aloud", () => {
    const rb = readBack(form);
    expect(rb).toMatchObject({ ok: true });
    if (!rb.ok) return;
    expect(rb.lines).toEqual([
      "Spend at most $80.00",
      "Item: Running jackets",
      "Color: grey",
      "Valid for 7 days",
      "Ask me before every purchase: no",
    ]);
    expect(rb.speech).toContain("running jackets, grey, spending at most 80 dollars, valid for 7 days");
    expect(rb.speech).toContain("Say confirm to sign this, or cancel.");
  });

  test("says cents, one day, and the ask-me-first switch", () => {
    const rb = readBack({ ...form, maxPrice: "79.99", validDays: 1, confirmEachCart: true });
    if (!rb.ok) throw new Error("expected a read-back");
    expect(rb.lines).toContain("Spend at most $79.99");
    expect(rb.lines).toContain("Valid for 1 day");
    expect(rb.lines).toContain("Ask me before every purchase: yes");
    expect(rb.speech).toContain("79 dollars 99 cents");
    expect(rb.speech).toContain("ask you before every purchase");
  });

  test("a form that couldn't be signed can't be read back", () => {
    expect(readBack({ ...form, maxPrice: "lots" })).toEqual({
      ok: false,
      problem: "Enter a price like 80 or 79.99",
    });
    expect(readBack({ ...form, maxPrice: "0" })).toMatchObject({ ok: false });
    expect(readBack({ ...form, description: "   " })).toMatchObject({ ok: false });
  });
});

describe("the voice flow", () => {
  test("a spoken request ends at the read-back card and signs nothing", () => {
    expect(atReadback.phase).toBe("readback");
    expect(atReadback.snapshot).toEqual(form);
    expect(atReadback.shownAt).toBe(T0);
    // "buy X and confirm" said as the request is only ever text: it can't reach `confirmed`.
    const oneBreath = run([
      { type: "LISTEN" },
      { type: "HEARD", text: "buy a grey running jacket under $80 and confirm", final: true },
      { type: "DRAFTED", form, at: T0 },
    ]);
    expect(oneBreath.phase).toBe("readback");
  });

  test("a confirmation after the card, a beat later, signs the snapshot that was read back", () => {
    for (const confirm of [
      { type: "CONFIRM", at: T0 + MIN_READBACK_MS } as const,
      { type: "CONFIRM_HEARD", text: "confirm", at: T0 + 3000 } as const,
    ]) {
      const state = voiceReducer(atReadback, confirm);
      expect(state.phase).toBe("confirmed");
      expect(state.snapshot).toEqual(form);
    }
    const done = run(
      [{ type: "CONFIRM", at: T0 + 2000 }, { type: "SIGNING" }, { type: "CHOOSING" }, { type: "DONE" }],
      atReadback,
    );
    expect(done.phase).toBe("done");
  });

  test("nothing confirms outside the read-back", () => {
    for (const phase of ["idle", "listening", "drafting", "failed"] as const) {
      const state: VoiceState = { phase, transcript: "x" };
      expect(voiceReducer(state, { type: "CONFIRM", at: T0 })).toBe(state);
      expect(voiceReducer(state, { type: "CONFIRM_HEARD", text: "confirm", at: T0 })).toBe(state);
    }
    // Words heard while listening are text only, never a command, even the word itself.
    const listening = run([{ type: "LISTEN" }]);
    expect(voiceReducer(listening, { type: "HEARD", text: "confirm", final: true }).phase).toBe("drafting");
    // A confirmation can't skip signing's own steps either.
    expect(voiceReducer(atReadback, { type: "SIGNING" })).toBe(atReadback);
    expect(voiceReducer(atReadback, { type: "DONE" })).toBe(atReadback);
  });

  test("a confirmation too soon after the card appears is ignored (a stray tap, or the shop's own voice)", () => {
    expect(voiceReducer(atReadback, { type: "CONFIRM", at: T0 + MIN_READBACK_MS - 1 })).toBe(atReadback);
    expect(voiceReducer(atReadback, { type: "CONFIRM_HEARD", text: "confirm", at: T0 + 100 })).toBe(
      atReadback,
    );
  });

  test("a read-back expires: a late confirmation signs nothing and starts over", () => {
    const late = voiceReducer(atReadback, { type: "CONFIRM", at: T0 + READBACK_TIMEOUT_MS + 1 });
    expect(late.phase).toBe("idle");
    expect(late.snapshot).toBeUndefined();
    expect(late.message).toMatch(/nothing was signed/);
    expect(voiceReducer(atReadback, { type: "TIMEOUT", at: T0 + READBACK_TIMEOUT_MS }).phase).toBe("idle");
    expect(voiceReducer(atReadback, { type: "TIMEOUT", at: T0 + READBACK_TIMEOUT_MS - 1 })).toBe(atReadback);
  });

  test("anything other than a clear confirmation leaves the card up; 'cancel' takes it down", () => {
    for (const text of ["maybe", "yes", "buy it and confirm", "hmm let me think about it"])
      expect(voiceReducer(atReadback, { type: "CONFIRM_HEARD", text, at: T0 + 5000 })).toBe(atReadback);
    expect(voiceReducer(atReadback, { type: "CONFIRM_HEARD", text: "cancel", at: T0 + 5000 }).phase).toBe(
      "idle",
    );
  });

  test("editing the limits while the card is up discards it, so only what was read back can be signed", () => {
    const edited = voiceReducer(atReadback, { type: "EDITED" });
    expect(edited.phase).toBe("idle");
    expect(edited.snapshot).toBeUndefined();
    expect(voiceReducer(edited, { type: "CONFIRM", at: T0 + 5000 }).phase).toBe("idle");
  });

  test("cancel works from every working state", () => {
    const states: VoiceState[] = [
      run([{ type: "LISTEN" }]),
      run([{ type: "LISTEN" }, { type: "HEARD", text: "x", final: true }]),
      atReadback,
      run([{ type: "CONFIRM", at: T0 + 2000 }], atReadback),
      run([{ type: "CONFIRM", at: T0 + 2000 }, { type: "SIGNING" }], atReadback),
      run([{ type: "CONFIRM", at: T0 + 2000 }, { type: "SIGNING" }, { type: "CHOOSING" }], atReadback),
    ];
    for (const state of states) {
      const after = voiceReducer(state, { type: "CANCEL" });
      expect(after.phase).toBe("idle");
      expect(after.snapshot).toBeUndefined();
    }
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
