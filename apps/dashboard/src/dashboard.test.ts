import { describe, expect, it } from "vitest";
import { ATTENTION_STARTER_PROMPT, studioStarters, tools } from "./studio-agent";
// The AI package is server code, so the dashboard doesn't depend on it; a relative import is fine for a test.
import { ATTENTION_STARTER_PROMPT as ANSWERED_LOCALLY } from "../../../packages/ai/src/studio";
import { planStudio } from "../../../packages/ai/src/studio-plan";
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

describe("Studio starters", () => {
  it("the attention starter asks the exact question the AI package answers locally", () => {
    // If someone rewords the starter, the fast path and the replay answer would silently stop applying.
    expect(ATTENTION_STARTER_PROMPT).toBe(ANSWERED_LOCALLY);
  });

  it("every starter is answered by the planner, with no model: instant, from the tool results, never guessed", () => {
    const offered = tools.map(({ name, description }) => ({ name, description, parameters: {} }));
    const starters = studioStarters({ compliant: "PP-D-1001", other: "PP-D-1002" });
    expect(starters.length).toBeGreaterThanOrEqual(5);
    for (const { label, prompt } of starters) {
      const plan = planStudio({
        kind: "turn",
        instructions: "",
        tools: offered,
        history: [{ role: "user", text: prompt }],
      });
      expect(plan, `${label}: ${prompt}`).toMatchObject({ kind: "call" });
    }
  });
});
