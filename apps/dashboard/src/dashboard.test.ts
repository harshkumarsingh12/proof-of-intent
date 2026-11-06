import { describe, expect, it } from "vitest";
import { tools } from "./studio-agent";
import { customWidgetDefinitions } from "../app/analytics/studio/studio-widgets";
import { widgets } from "./widgets";

describe("dashboard", () => {
  it("MandateDiffWidget is registered with Studio, with an AI description", () => {
    const diff = widgets.find((w) => w.id === "mandate-diff");
    expect(diff).toBeDefined();
    expect(diff?.aiDescription.length).toBeGreaterThan(20);
    // The descriptor list is not the registration: the definition Studio receives must carry the component,
    // the data mapping and the same description.
    const registered = customWidgetDefinitions.find((d: { id: string }) => d.id === "mandate-diff");
    expect(registered).toBeDefined();
    expect(typeof registered.comp).toBe("function");
    expect(registered.ai.description).toBe(diff?.aiDescription);
    expect(Object.keys(registered.dataMapping)).toEqual([
      "dispute",
      "check",
      "mandateRule",
      "cartActual",
      "status",
      "reasonCode",
    ]);
  });

  it("every Studio widget is registered once, described for the AI, and maps AI-described fields", () => {
    expect(customWidgetDefinitions.map((d: { id: string }) => d.id).sort()).toEqual(
      widgets.map((w) => w.id).sort(),
    );
    for (const d of customWidgetDefinitions) {
      expect(d.ai.description.length, d.id).toBeGreaterThan(20);
      expect(typeof d.comp, d.id).toBe("function");
      for (const [key, slot] of Object.entries(d.dataMapping as Record<string, { aiDescription?: string }>)) {
        expect(slot.aiDescription?.length ?? 0, `${d.id}.${key}`).toBeGreaterThan(10);
      }
    }
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
