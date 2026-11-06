import Link from "next/link";
import { fetchDisputeDetailDetailed, fetchDisputesDetailed, serverApiBaseUrl } from "../../../src/api";
import { checkRows, disputeRows } from "../../../src/studio-data";
import { pageSubtitle, pageTitle } from "../../../src/theme";
import { studioEnabled } from "./enabled";
import { StudioView } from "./StudioView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dispute Studio · Proof of Intent operations" };

export default async function StudioPage() {
  const licenseKey = process.env.AG_STUDIO_LICENSE_KEY?.trim();
  const enabled = studioEnabled();
  const apiBaseUrl = serverApiBaseUrl();
  const data = enabled ? await fetchDisputesDetailed({ apiBaseUrl }) : undefined;
  // Each dispute's signed-limit checks come from its detail; the list alone doesn't carry them.
  const details =
    data && !data.isFallback
      ? (
          await Promise.all(
            data.disputes.slice(0, 60).map((d) => fetchDisputeDetailDetailed(d.id, { apiBaseUrl })),
          )
        )
          .filter((r) => !r.isFallback && r.dispute)
          .map((r) => r.dispute!)
      : [];

  return (
    <section>
      <Link href="/analytics">Back to Analytics</Link>
      <h1 style={pageTitle}>Dispute Studio</h1>
      <p style={pageSubtitle}>
        Read policy findings, compare agent platforms, and prepare buyer replies for review.
      </p>
      {licenseKey && data && !data.isFallback ? (
        <StudioView licenseKey={licenseKey} disputes={disputeRows(details)} checks={checkRows(details)} />
      ) : (
        <p>
          Studio is unavailable on this deployment. Analytics and Disputes are available from the dashboard.
        </p>
      )}
    </section>
  );
}
