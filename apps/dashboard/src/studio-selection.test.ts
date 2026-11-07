import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedDispute } from "./studio-selection";

afterEach(() => selectedDispute.set(undefined));

describe("shared dispute selection", () => {
  it("starts empty, so the widgets show the first dispute", () => {
    expect(selectedDispute.get()).toBeUndefined();
  });

  it("tells every subscriber when a dispute is picked, so the diff and the PDF change together", () => {
    const diff = vi.fn();
    const evidence = vi.fn();
    const stopDiff = selectedDispute.subscribe(diff);
    const stopEvidence = selectedDispute.subscribe(evidence);
    selectedDispute.set("PP-R-2");
    expect(selectedDispute.get()).toBe("PP-R-2");
    expect([diff.mock.calls.length, evidence.mock.calls.length]).toEqual([1, 1]);
    stopDiff();
    stopEvidence();
  });

  it("stays quiet when the same dispute is picked again, and stops telling an unsubscribed widget", () => {
    const listener = vi.fn();
    const stop = selectedDispute.subscribe(listener);
    selectedDispute.set("PP-R-1");
    selectedDispute.set("PP-R-1");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    selectedDispute.set("PP-R-3");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
