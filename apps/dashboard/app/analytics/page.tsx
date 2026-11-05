import { fetchAnalytics } from "../../src/api";
import { AnalyticsView } from "./AnalyticsView";
import { pageSubtitle, pageTitle } from "../../src/theme";

export const metadata = {
  title: "Analytics · Proof of Intent operations",
  description: "Disputes defended vs conceded, amount protected, and blocked overreach carts",
};

export default async function AnalyticsPage() {
  const initialData = await fetchAnalytics();

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
        }}
      >
        <div>
          <h1 style={pageTitle}>
            Operations and overreach analytics
          </h1>
          <p style={pageSubtitle}>
            Traces to seed data and checkout policy engine verdicts. Spec: <code>docs/specs/0007-dashboard.md</code>.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            data-testid="sample-data-badge"
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              background: "var(--poi-warning-bg)",
              border: "1px solid var(--poi-warning)",
              color: "var(--poi-warning)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>⚠️</span> Sample Data
          </span>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12,
              background: "var(--poi-surface)",
              border: "1px solid var(--poi-border)",
              color: "var(--poi-text-muted)",
              fontFamily: "monospace",
            }}
          >
            API: GET /analytics/*
          </span>
        </div>
      </div>

      {/* Analytics Dashboard Cards & Chart */}
      <AnalyticsView initialData={initialData} />
    </div>
  );
}
