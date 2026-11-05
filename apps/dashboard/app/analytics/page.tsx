import { fetchAnalytics, serverApiBaseUrl } from "../../src/api";
import { AnalyticsView } from "./AnalyticsView";
import { pageSubtitle, pageTitle } from "../../src/theme";

export const metadata = {
  title: "Analytics · Proof of Intent operations",
  description: "Disputes defended vs conceded, amount protected, and blocked overreach carts",
};

export default async function AnalyticsPage() {
  const initialData = await fetchAnalytics({ apiBaseUrl: serverApiBaseUrl() });

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Navigation Header */}
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
            Operations and overreach analytics
          </h1>
          <p style={pageSubtitle}>
            How the copilot&apos;s defend and concede calls play out, and how much overreach checkout stops before payment.
          </p>
        </div>

      </div>

      {/* Analytics Dashboard Cards & Chart */}
      <AnalyticsView initialData={initialData} />
    </div>
  );
}
