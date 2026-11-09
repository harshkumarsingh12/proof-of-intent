"use client";

import {
  AgStudioAiModule,
  type AgDataSourcesDefinition,
  type AgReportState,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo, useRef, useState } from "react";
import { createStudioAi, type StudioExamples } from "../../../src/studio-agent";
import { dashboardStudioTheme } from "../../../src/studio-theme";
import type { StudioCheckRow, StudioDisputeRow } from "../../../src/studio-data";
import { fontStack, pillButton, v } from "../../../src/theme";
import { publishState, setUnfilteredTotal } from "../../../src/studio-filters";
import { initialState } from "../../../src/studio-report";
import { studioWidgets } from "./studio-widgets";

const modules = [AgStudioAiModule];
const theme = dashboardStudioTheme();
const style = { width: "100%", height: 1200 };

/** Dollar columns show as $1,143.00 in the tiles and charts (Studio's currency format alone prints 1,143.00). */
const usd = { format: new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }) };

/** The report's narrowest comfortable width, in pixels. */
const MIN_REPORT_WIDTH = 1100;

type Mode = "view" | "edit";
type PageId = "disputes" | "queues";

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
  // Studio's own page tabs show only in edit mode, so the two pages get buttons of their own that drive its state.
  const studio = useRef<{ getState(): AgReportState; setState(state: AgReportState): void } | null>(null);
  const [pageId, setPageId] = useState<PageId>("disputes");
  const showPage = (id: PageId) => {
    setMode("view");
    setPageId(id);
    const api = studio.current;
    if (api) api.setState({ ...api.getState(), selectedPageId: id });
  };
  // The platform cards compare what a filter leaves with this: all of the disputes.
  setUnfilteredTotal(disputes.length);
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
            { id: "missingEvidence", name: "Missing evidence", format: "textFormat" },
            { id: "outcome", name: "Outcome", format: "textFormat" },
            { id: "open", name: "Open", format: "integerFormat" },
            { id: "overreach", name: "Agent overreach", format: "integerFormat" },
            { id: "dueSoon", name: "Due within 24 hours", format: "integerFormat" },
            { id: "overdue", name: "Overdue", format: "integerFormat" },
            { id: "atStake", name: "Dollars at stake", format: "currencyFormat", formatOptions: usd },
            { id: "conceded", name: "Dollars to concede (recommended)", format: "currencyFormat", formatOptions: usd },
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
            aria-pressed={mode === "view" && pageId === "disputes"}
            style={tab(mode === "view" && pageId === "disputes")}
            onClick={() => showPage("disputes")}
          >
            Dashboard
          </button>
          <button
            type="button"
            aria-pressed={mode === "view" && pageId === "queues"}
            style={tab(mode === "view" && pageId === "queues")}
            onClick={() => showPage("queues")}
          >
            Queues
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
            : pageId === "queues"
              ? "Disputes to defend with evidence, and disputes to concede. Pick one to see its signed limits."
              : "Pick a dispute in either widget and both follow. Switch to Ask the AI to chat about a dispute."}
        </span>
      </div>
      {/* Below this width the report would be squeezed, so it keeps its width and scrolls sideways instead. */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: MIN_REPORT_WIDTH }}>
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
              onApiReady={(event) => {
                studio.current = event.api as unknown as NonNullable<typeof studio.current>;
              }}
              onStateUpdated={(event) => {
                publishState(event.state);
                const selected = event.state.selectedPageId;
                if (selected === "disputes" || selected === "queues") setPageId(selected);
              }}
              panels={panels as never}
              style={style}
            />
          </AgStudioProvider>
        </div>
      </div>
    </>
  );
}
