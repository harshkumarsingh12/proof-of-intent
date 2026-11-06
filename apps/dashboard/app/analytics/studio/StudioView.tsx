"use client";

import { AgStudioAiModule, type AgDataSourcesDefinition, type AgReportState } from "ag-studio";
import { AgStudio, AgStudioProvider } from "ag-studio-react";
import { useMemo } from "react";
import { buildStudioAi } from "../../../src/studio-agent";

const modules = [AgStudioAiModule];
const initialState: AgReportState = { selectedPageId: "disputes", pages: [{ id: "disputes" }] };
const style = { width: "100%", height: 640 };

interface DisputeRow {
  id: string;
  disputeClass: string;
  agentPlatform: string;
  status: string;
  buyerDisputeReason: string;
}

export function StudioView({ rows, licenseKey }: { rows: DisputeRow[]; licenseKey: string }) {
  const data = useMemo<AgDataSourcesDefinition>(
    () => ({
      sources: [
        {
          id: "disputes",
          description: "Merchant dispute classifications by agent platform",
          data: rows.map((row) => ({ ...row })),
          fields: [
            { id: "id", name: "Dispute ID", format: "textFormat" },
            { id: "disputeClass", name: "Class", format: "textFormat" },
            { id: "agentPlatform", name: "Agent platform", format: "textFormat" },
            { id: "status", name: "Status", format: "textFormat" },
            { id: "buyerDisputeReason", name: "Dispute reason", format: "textFormat" },
          ],
        },
      ],
    }),
    [rows],
  );

  return (
    <AgStudioProvider modules={modules} licenseKey={licenseKey}>
      <AgStudio ai={buildStudioAi} data={data} initialState={initialState} mode="view" style={style} />
    </AgStudioProvider>
  );
}
