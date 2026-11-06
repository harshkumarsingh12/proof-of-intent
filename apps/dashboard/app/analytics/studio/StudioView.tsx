"use client";

import {
  AgStudioAiModule,
  type AgDataSourcesDefinition,
  type AgReportState,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo } from "react";
import { buildStudioAi } from "../../../src/studio-agent";
import { dashboardStudioTheme } from "../../../src/studio-theme";
import type { StudioCheckRow, StudioDisputeRow } from "../../../src/studio-data";
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

export function StudioView({
  disputes,
  checks,
  licenseKey,
}: {
  disputes: StudioDisputeRow[];
  checks: StudioCheckRow[];
  licenseKey: string;
}) {
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
    <AgStudioProvider modules={modules} licenseKey={licenseKey}>
      <AgStudio
        ai={buildStudioAi}
        data={data}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom widget registry, see studio-widgets.tsx
        widgets={((base: AgWidgetsConfig) => studioWidgets(base)) as any}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        initialState={initialState as any as AgReportState}
        theme={theme}
        mode="view"
        style={style}
      />
    </AgStudioProvider>
  );
}
