import { describe, expect, it, vi } from "vitest";
import { filterRevision, filterSignature, publishState } from "./studio-filters";

const state = (page: Record<string, unknown>, selected = "disputes") => ({
  selectedPageId: selected,
  pages: [
    { id: "disputes", ...page },
    { id: "other", filter: "x" },
  ],
});

describe("filter revision", () => {
  it("signs only the current page's filters and cross filter", () => {
    expect(filterSignature(state({ filter: { a: 1 }, crossFilter: null }))).toBe('[{"a":1},null]');
    expect(filterSignature(state({ selection: "w1" }))).toBe("[null,null]");
    expect(filterSignature(state({}, "missing"))).toBe("[null,null]");
  });

  it("bumps the revision and tells widgets when a cross filter is applied, and not when something else changes", () => {
    const before = filterRevision.get();
    const listener = vi.fn();
    const stop = filterRevision.subscribe(listener);

    expect(publishState(state({ crossFilter: { field: "class", value: "AGENT_OVERREACH" } }))).toBe(true);
    expect(filterRevision.get()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // The selection, layout and so on change the state but not what a widget's query returns.
    expect(
      publishState(state({ crossFilter: { field: "class", value: "AGENT_OVERREACH" }, selection: "w2" })),
    ).toBe(false);
    expect(filterRevision.get()).toBe(before + 1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Clearing the cross filter is a change too.
    expect(publishState(state({}))).toBe(true);
    expect(filterRevision.get()).toBe(before + 2);

    stop();
    publishState(state({ filter: { a: 1 } }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
