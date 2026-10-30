import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchDisputeDetail } from "../../../src/api";
import { DisputeDetailView } from "./DisputeDetailView";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  return {
    title: `Dispute ${id} · Proof of Intent Operations`,
    description: `Detailed mandate evaluation, cart diff, classification, and evidence for dispute ${id}`,
  };
}

export default async function DisputeDetailPage({ params }: PageProps) {
  const { id } = await params;
  const dispute = await fetchDisputeDetail(id);

  if (!dispute) {
    notFound();
  }

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto" }}>
      {/* Breadcrumb Navigation */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/disputes"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#58a6ff",
            textDecoration: "none",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          ← Back to Dispute Queue
        </Link>
      </div>

      {/* Main Dispute Detail View */}
      <DisputeDetailView dispute={dispute} />
    </main>
  );
}
