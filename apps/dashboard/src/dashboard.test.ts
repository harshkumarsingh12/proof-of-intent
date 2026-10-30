import { describe, expect } from "vitest";
import { ledger } from "@poi/ledger";
import { tools } from "./studio-agent";
import { widgets } from "./widgets";

describe("dashboard (unbuilt)", () => {
  ledger("M2", "hoursgotviral-dev", "MandateDiffWidget is registered with an AI description", () => {
    const diff = widgets.find((w) => w.id === "mandate-diff");
    expect(diff?.aiDescription.length).toBeGreaterThan(20);
  });

  ledger("M3", "sumedhag28", "DisputeExplainer agent exposes read-only tools only", () => {
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((t) => t.readOnly)).toBe(true);
  });
});
