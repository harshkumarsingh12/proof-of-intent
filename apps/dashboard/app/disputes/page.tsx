import Link from "next/link";
import { DisputeQueue } from "./DisputeQueue";

export const metadata = {
  title: "Dispute queue · Proof of Intent operations",
  description: "Dispute resolution queue sorted by response deadline with defend/concede copilot decisions",
};

export default function DisputesPage() {
  return (
    <main style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation header */}
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
            <span style={{ color: "var(--poi-text-muted)", fontSize: 13 }}>apps/dashboard · AG Studio</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 4px 0", color: "var(--poi-heading)" }}>
            Dispute queue
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--poi-text-muted)" }}>
            Disputes from the merchant API, sorted by seller response deadline with copilot defend/concede
            recommendations.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
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
            API: GET /disputes
          </span>
        </div>
      </div>

      {/* Interactive Dispute Queue Table */}
      <DisputeQueue />
    </main>
  );
}
