import ApproveFlow from "./ApproveFlow";

export const dynamic = "force-dynamic";

// The token is in this page's URL; keep it out of Referer headers.
export const metadata = { title: "Approve a purchase · Proof of Intent", referrer: "no-referrer" as const };

export default async function Approve({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
      </header>
      <main>
        <ApproveFlow token={token} />
      </main>
    </>
  );
}
