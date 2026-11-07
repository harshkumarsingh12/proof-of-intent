"use client";

import {
  AgStudioAiModule,
  type AgDataSourcesDefinition,
  type AgReportState,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo, useState } from "react";
import { createStudioAi, type StudioExamples } from "../../../src/studio-agent";
import { dashboardStudioTheme } from "../../../src/studio-theme";
import type { StudioCheckRow, StudioDisputeRow } from "../../../src/studio-data";
import { fontStack, pillButton, v } from "../../../src/theme";
import { studioWidgets } from "./studio-widgets";

const modules = [AgStudioAiModule];
const theme = dashboardStudioTheme();
const style = { width: "100%", height: 840 };

/**
 * The page shows one of each custom widget, wired to the two tables below, so the demo opens on something useful.
 * Operators can still rearrange or add widgets from the menu (mode "edit" would show the editor).
 */
const initialState = {
  selectedPageId: "disputes",
  // The filters panel starts collapsed so it does not sit over the widgets on a narrower screen.
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: "disputes",
      layout: { columns: 12, rowHeight: 40 },
      widgets: {
        platforms: {
          type: "agent-platform",
          dataMapping: {
            platform: [{ id: "disputes.agentPlatform" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
            dispute: [{ id: "disputes.id" }],
            amount: [{ id: "disputes.amount" }],
          },
          format: { title: { text: "Agent platforms: overreach and conceded dollars" } },
        },
        diff: {
          type: "mandate-diff",
          dataMapping: {
            dispute: [{ id: "checks.dispute" }],
            check: [{ id: "checks.check" }],
            mandateRule: [{ id: "checks.mandateRule" }],
            cartActual: [{ id: "checks.cartActual" }],
            status: [{ id: "checks.status" }],
            reasonCode: [{ id: "checks.reasonCode" }],
          },
          format: { title: { text: "Mandate diff: what the shopper signed against the cart" } },
        },
        evidence: {
          type: "evidence-preview",
          dataMapping: {
            dispute: [{ id: "disputes.id" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
          },
          format: { title: { text: "Evidence preview: the attestation PDF" } },
        },
      },
      widgetLayout: {
        platforms: { xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 6 },
        diff: { xTrack: 0, yTrack: 6, xSpan: 7, ySpan: 9 },
        evidence: { xTrack: 7, yTrack: 6, xSpan: 5, ySpan: 9 },
      },
    },
  ],
};

type Mode = "view" | "edit";

/**
 * Studio has the AI chat only in edit mode, so "Ask the AI" turns edit mode on, with just the chat and the filters
 * (no edit or data panels). Nothing is saved: the report lives in this browser tab, so a rearranged or emptied report
 * comes back on reload, and the chat's tools are read-only.
 */
const panels = {
  view: { right: ["filters"] },
  edit: { right: ["ai", "filters"] },
} as const;

const tab = (active: boolean) =>
  ({
    ...pillButton,
    fontFamily: fontStack,
    padding: "8px 20px",
    background: active ? v("navy") : v("surface"),
    color: active ? v("surface") : v("navy"),
  }) as const;

export function StudioView({
  disputes,
  checks,
  licenseKey,
  examples,
  aiLive,
}: {
  disputes: StudioDisputeRow[];
  checks: StudioCheckRow[];
  licenseKey: string;
  examples: StudioExamples;
  /** True when the server runs live AI; replay mode can't answer free-form questions. */
  aiLive: boolean;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const ai = useMemo(() => createStudioAi(examples), [examples]);
  const data = useMemo<AgDataSourcesDefinition>(
    () => ({
      sources: [
        {
          id: "disputes",
          name: "Disputes",
          description:
            "One row per dispute: the copilot's class, the agent platform, status and amount in US dollars",
          data: disputes.map((row) => ({ ...row })),
          fields: [
            { id: "id", name: "Dispute ID", format: "textFormat" },
            { id: "disputeClass", name: "Class", format: "textFormat" },
            { id: "agentPlatform", name: "Agent platform", format: "textFormat" },
            { id: "status", name: "Status", format: "textFormat" },
            { id: "buyerDisputeReason", name: "Dispute reason", format: "textFormat" },
            { id: "amount", name: "Amount (USD)", format: "currencyFormat" },
          ],
        },
        {
          id: "checks",
          name: "Signed limits",
          description:
            "One row per signed limit per dispute: what the shopper signed, what the cart had, and whether it met the limit",
          data: checks.map((row) => ({ ...row })),
          fields: [
            { id: "dispute", name: "Dispute ID", format: "textFormat" },
            { id: "check", name: "Limit", format: "textFormat" },
            { id: "mandateRule", name: "Shopper signed", format: "textFormat" },
            { id: "cartActual", name: "Cart had", format: "textFormat" },
            { id: "status", name: "Result", format: "textFormat" },
            { id: "reasonCode", name: "Reason code", format: "textFormat" },
          ],
        },
      ],
    }),
    [disputes, checks],
  );

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "16px 0" }}>
        <div role="group" aria-label="Studio view" style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            aria-pressed={mode === "view"}
            style={tab(mode === "view")}
            onClick={() => setMode("view")}
          >
            Dashboard
          </button>
          <button
            type="button"
            aria-pressed={mode === "edit"}
            style={tab(mode === "edit")}
            onClick={() => setMode("edit")}
          >
            Ask the AI
          </button>
        </div>
        <span style={{ color: v("textMuted"), fontSize: 13 }}>
          {mode === "edit"
            ? aiLive
              ? "Ask about a dispute or ask for a buyer reply draft. The AI reads disputes; it can't take any action."
              : "The server isn't running live AI (AI_MODE is not live), so the chat can't answer yet."
            : "Pick a dispute in either widget and both follow. Switch to Ask the AI to chat about a dispute."}
        </span>
      </div>
      <AgStudioProvider modules={modules} licenseKey={licenseKey}>
        <AgStudio
          ai={ai}
          data={data}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom widget registry, see studio-widgets.tsx
          widgets={((base: AgWidgetsConfig) => studioWidgets(base)) as any}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialState={initialState as any as AgReportState}
          theme={theme}
          mode={mode}
          panels={panels as never}
          style={style}
        />
      </AgStudioProvider>
    </>
  );
}
