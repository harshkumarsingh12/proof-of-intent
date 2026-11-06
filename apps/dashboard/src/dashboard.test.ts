import { describe, expect, it } from "vitest";
import { tools } from "./studio-agent";
import { widgets } from "./widgets";

describe("dashboard", () => {
  it("[M2 @hoursgotviral-dev] MandateDiffWidget is registered with an AI description", () => {
    const diff = widgets.find((w) => w.id === "mandate-diff");
    expect(diff).toBeDefined();
    expect(diff?.aiDescription.length).toBeGreaterThan(20);
  });

  it("DisputeExplainer exposes the four read-only dispute tools", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "explain_dispute",
      "draft_buyer_message",
      "list_disputes",
      "get_dispute",
    ]);
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });
});
