import Link from "next/link";
import { fetchAnalytics } from "../../src/api";
import { AnalyticsView } from "./AnalyticsView";

export const metadata = {
  title: "Analytics · Proof of Intent Operations",
  description: "Disputes defended vs conceded, amount protected, and blocked overreach carts",
};

export default async function AnalyticsPage() {
  const initialData = await fetchAnalytics();

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "1px solid var(--poi-border)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href="/"
              style={{
                color: "var(--poi-blue)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              ← Back to overview
            </Link>
            <span style={{ color: "var(--poi-text-subtle)" }}>|</span>
            <Link
              href="/disputes"
              style={{
                color: "var(--poi-blue)",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Dispute queue
            </Link>
            <span style={{ color: "var(--poi-text-subtle)" }}>|</span>
            <span style={{ color: "var(--poi-text-muted)", fontSize: 13 }}>apps/dashboard · Analytics</span>
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 4px 0", color: "var(--poi-heading)" }}>
            Operations and overreach analytics
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--poi-text-muted)" }}>
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
    </main>
  );
}
