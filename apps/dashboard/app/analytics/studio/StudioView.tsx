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
import { publishState } from "../../../src/studio-filters";
import { studioWidgets } from "./studio-widgets";

const modules = [AgStudioAiModule];
const theme = dashboardStudioTheme();
const style = { width: "100%", height: 1200 };

/** Dollar columns show as $1,143.00 in the tiles and charts (Studio's currency format alone prints 1,143.00). */
const usd = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };

/**
 * The opening report: four headline numbers, a donut of disputes by class (a click filters every widget), the agent
 * platform cards, the disputes grid (a click selects a dispute), and the mandate diff and evidence preview for the
 * selected dispute. Everything reads the two tables below.
 */
/** A headline number: the sum of one column, titled. */
const kpi = (title: string, field: string) => ({
  type: "value",
  dataMapping: { value: [{ id: field, aggregation: "sum" }] },
  format: { title: { text: title, enabled: true } },
});

const initialState = {
  selectedPageId: "disputes",
  // The filters panel starts collapsed so it does not sit over the widgets on a narrower screen.
  panels: { filters: { collapsed: true } },
  pages: [
    {
      id: "disputes",
      layout: { columns: 12, rowHeight: 40 },
      widgets: {
        // Four headline numbers. Each is a plain sum of a 0/1 or dollar column, so it follows Studio's filters.
        kpiOpen: kpi("Open disputes", "disputes.open"),
        kpiDue: kpi("Due within 24 hours", "disputes.dueSoon"),
        kpiAtStake: kpi("Dollars at stake", "disputes.atStake"),
        kpiConceded: kpi("Conceded (agent overreach)", "disputes.conceded"),
        classes: {
          type: "donut-chart",
          dataMapping: {
            categoryKey: [{ id: "disputes.disputeClass" }],
            valueKey: [{ id: "disputes.id", aggregation: "count" }],
          },
          format: {
            title: { text: "Disputes by class (click a slice to filter everything)", enabled: true },
          },
        },
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
        grid: {
          type: "dispute-grid",
          dataMapping: {
            dispute: [{ id: "disputes.id" }],
            disputeClass: [{ id: "disputes.disputeClass" }],
            platform: [{ id: "disputes.agentPlatform" }],
            status: [{ id: "disputes.status" }],
            amount: [{ id: "disputes.amount" }],
            action: [{ id: "disputes.action" }],
            dueAt: [{ id: "disputes.dueAt" }],
            hoursToDue: [{ id: "disputes.hoursToDue" }],
          },
          format: { title: { text: "Disputes: pick one to see its limits and evidence" } },
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
            coverNote: [{ id: "disputes.coverNote" }],
          },
          format: { title: { text: "Evidence preview: the attestation PDF" } },
        },
      },
      widgetLayout: {
        kpiOpen: { xTrack: 0, yTrack: 0, xSpan: 3, ySpan: 3 },
        kpiDue: { xTrack: 3, yTrack: 0, xSpan: 3, ySpan: 3 },
        kpiAtStake: { xTrack: 6, yTrack: 0, xSpan: 3, ySpan: 3 },
        kpiConceded: { xTrack: 9, yTrack: 0, xSpan: 3, ySpan: 3 },
        classes: { xTrack: 0, yTrack: 3, xSpan: 4, ySpan: 7 },
        platforms: { xTrack: 4, yTrack: 3, xSpan: 8, ySpan: 7 },
        grid: { xTrack: 0, yTrack: 10, xSpan: 12, ySpan: 9 },
        diff: { xTrack: 0, yTrack: 19, xSpan: 7, ySpan: 10 },
        evidence: { xTrack: 7, yTrack: 19, xSpan: 5, ySpan: 10 },
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
  /** The dashboard and API must use the same mode. Replay requires recordings of the exact question and data. */
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
            "One row per dispute: the copilot's class and recommended action, the agent platform, status, amount in US dollars, when a response is due, and 0/1 and dollar columns for open, overreach, due soon, at stake and conceded",
          data: disputes.map((row) => ({ ...row })),
          fields: [
            { id: "id", name: "Dispute ID", format: "textFormat" },
            { id: "disputeClass", name: "Class", format: "textFormat" },
            { id: "agentPlatform", name: "Agent platform", format: "textFormat" },
            { id: "status", name: "Status", format: "textFormat" },
            { id: "buyerDisputeReason", name: "Dispute reason", format: "textFormat" },
            { id: "amount", name: "Amount (USD)", format: "currencyFormat", formatOptions: usd },
            { id: "decision", name: "Decision", format: "textFormat" },
            { id: "action", name: "Recommended action", format: "textFormat" },
            { id: "dueAt", name: "Respond by", format: "textFormat" },
            { id: "hoursToDue", name: "Hours to respond", format: "decimalFormat" },
            { id: "coverNote", name: "Cover note", format: "textFormat" },
            { id: "open", name: "Open", format: "integerFormat" },
            { id: "overreach", name: "Agent overreach", format: "integerFormat" },
            { id: "dueSoon", name: "Due within 24 hours", format: "integerFormat" },
            { id: "atStake", name: "Dollars at stake", format: "currencyFormat", formatOptions: usd },
            { id: "conceded", name: "Dollars conceded", format: "currencyFormat", formatOptions: usd },
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
              ? "Ask about a dispute, the counts, what needs attention, or a buyer reply draft. The AI reads disputes; it can't take any action."
              : "Without live AI the chat still answers the common questions from your own data: explain a dispute, draft a buyer reply, counts, what needs attention, what a term means. Open-ended questions need live AI. It only reads; it can't take any action."
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
          onStateUpdated={(event) => publishState(event.state)}
          panels={panels as never}
          style={style}
        />
      </AgStudioProvider>
    </>
  );
}
