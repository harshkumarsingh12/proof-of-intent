import { fetchDisputesDetailed, serverApiBaseUrl } from "../../../src/api";
import { DisputeQueue } from "../DisputeQueue";
import { pageSubtitle, pageTitle } from "../../../src/theme";

export const metadata = {
  title: "Dispute queue · Proof of Intent operations",
  description: "Dispute resolution queue sorted by response deadline with defend/concede copilot decisions",
};

// Load on the server so the page arrives with its disputes instead of a row of zeros.
export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  const { disputes, isFallback } = await fetchDisputesDetailed({ apiBaseUrl: serverApiBaseUrl() });
  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation header */}
      <div
        className="poi-page-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={pageTitle}>
            Dispute queue
          </h1>
          <p style={pageSubtitle}>
            Every dispute, soonest response deadline first, with the copilot&apos;s defend or concede
            recommendation.
          </p>
        </div>

      </div>

      {/* Interactive Dispute Queue Table */}
      <DisputeQueue initialDisputes={disputes} initialIsDemo={isFallback} />
    </div>
  );
}
