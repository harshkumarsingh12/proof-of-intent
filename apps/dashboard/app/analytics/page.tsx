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
          borderBottom: "1px solid #30363d",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Link
              href="/"
              style={{
                color: "#58a6ff",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              ← Back to Operations Home
            </Link>
            <span style={{ color: "#484f58" }}>|</span>
            <Link
              href="/disputes"
              style={{
                color: "#58a6ff",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Dispute Queue
            </Link>
            <span style={{ color: "#484f58" }}>|</span>
            <span style={{ color: "#8b949e", fontSize: 13 }}>apps/dashboard · Analytics</span>
          </div>

          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 4px 0", color: "#f0f6fc" }}>
            Operations &amp; Overreach Analytics
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#8b949e" }}>
            Traces to seed data and checkout policy engine verdicts. Spec: <code>docs/specs/0007-dashboard.md</code>.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 12,
              background: "#161b22",
              border: "1px solid #30363d",
              color: "#8b949e",
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
