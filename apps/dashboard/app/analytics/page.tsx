import { fetchAnalytics, serverApiBaseUrl } from "../../src/api";
import Link from "next/link";
import { AnalyticsView } from "./AnalyticsView";
import { card, pageSubtitle, pageTitle, pillButton, v } from "../../src/theme";
import { SparkleIcon } from "../icons";
import { studioEnabled } from "./studio/enabled";

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
          <h1 style={pageTitle}>Operations and overreach analytics</h1>
          <p style={pageSubtitle}>
            How the copilot&apos;s defend and concede calls play out, and how much overreach checkout stops
            before payment.
          </p>
        </div>
      </div>

      {studioEnabled() && (
        <Link
          href="/analytics/studio"
          style={{
            ...card,
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 24,
            textDecoration: "none",
            color: v("text"),
            borderColor: v("blue"),
            background: v("surfaceMuted"),
          }}
        >
          <span style={{ color: v("blue"), display: "flex" }} aria-hidden>
            <SparkleIcon size={32} />
          </span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: "block", color: v("heading"), fontSize: 18 }}>Dispute Studio</strong>
            <span style={{ color: v("textMuted"), fontSize: 14 }}>
              Compare what each shopper signed against the cart, preview the evidence PDF and ask the AI to
              explain a dispute or draft a buyer reply.
            </span>
          </span>
          <span
            style={{
              ...pillButton,
              background: v("navy"),
              color: v("surface"),
              whiteSpace: "nowrap",
            }}
          >
            Open Studio
          </span>
        </Link>
      )}
      {/* Analytics Dashboard Cards & Chart */}
      <AnalyticsView initialData={initialData} />
    </div>
  );
}
