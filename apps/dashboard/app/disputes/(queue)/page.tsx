import { DisputeQueue } from "../DisputeQueue";
import { pageSubtitle, pageTitle } from "../../../src/theme";

export const metadata = {
  title: "Dispute queue · Proof of Intent operations",
  description: "Dispute resolution queue sorted by response deadline with defend/concede copilot decisions",
};

export default function DisputesPage() {
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation header */}
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
            Dispute queue
          </h1>
          <p style={pageSubtitle}>
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
    </div>
  );
}
