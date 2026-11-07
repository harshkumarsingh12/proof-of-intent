import { describe, expect, it } from "vitest";
import { activeHref } from "./nav";

const hrefs = ["/", "/orders", "/disputes", "/analytics", "/analytics/studio"];

describe("activeHref", () => {
  it("matches the page and its children", () => {
    expect(activeHref("/", hrefs)).toBe("/");
    expect(activeHref("/disputes", hrefs)).toBe("/disputes");
    expect(activeHref("/disputes/PP-R-1", hrefs)).toBe("/disputes");
  });
  it("lights up only the most specific item: the Studio, not Analytics", () => {
    expect(activeHref("/analytics", hrefs)).toBe("/analytics");
    expect(activeHref("/analytics/studio", hrefs)).toBe("/analytics/studio");
  });
  it("does not match a longer name that merely starts the same", () => {
    expect(activeHref("/analytics-old", hrefs)).toBeUndefined();
    expect(activeHref("/ordersX", hrefs)).toBeUndefined();
  });
  it("handles an unknown page", () => {
    expect(activeHref("/nowhere", hrefs)).toBeUndefined();
  });
});
