import Link from "next/link";
import { DisputeQueue } from "./DisputeQueue";

export const metadata = {
  title: "Dispute Queue · Proof of Intent Operations",
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
            <span style={{ color: "#8b949e", fontSize: 13 }}>apps/dashboard · AG Studio</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "10px 0 4px 0", color: "#f0f6fc" }}>
            Dispute Queue
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "#8b949e" }}>
            Real-time disputes from the merchant API. Sorted by seller response deadline with copilot defend/concede recommendations.
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
            API: GET /disputes
          </span>
        </div>
      </div>

      {/* Interactive Dispute Queue Table */}
      <DisputeQueue />
    </main>
  );
}
