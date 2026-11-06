import Link from "next/link";
import { fetchDisputesDetailed, serverApiBaseUrl } from "../../../src/api";
import { pageSubtitle, pageTitle } from "../../../src/theme";
import { studioEnabled } from "./enabled";
import { StudioView } from "./StudioView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispute Studio · Proof of Intent operations" };

export default async function StudioPage() {
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim();
  const enabled = studioEnabled();
  const data = enabled ? await fetchDisputesDetailed({ apiBaseUrl: serverApiBaseUrl() }) : undefined;

  return (
    <section>
      <Link href="/analytics">Back to Analytics</Link>
      <h1 style={pageTitle}>Dispute Studio</h1>
      <p style={pageSubtitle}>
        Read policy findings, compare agent platforms, and prepare buyer replies for review.
      </p>
      {licenseKey && data && !data.isFallback ? (
        <StudioView
          licenseKey={licenseKey}
          rows={data.disputes.map(({ id, disputeClass, agentPlatform, status, buyerDisputeReason }) => ({
            id,
            disputeClass,
            agentPlatform,
            status,
            buyerDisputeReason,
          }))}
        />
      ) : (
        <p>
          Studio is unavailable on this deployment. Analytics and Disputes are available from the dashboard.
        </p>
      )}
    </section>
  );
}
