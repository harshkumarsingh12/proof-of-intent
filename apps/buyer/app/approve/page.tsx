import ApproveFlow from "./ApproveFlow";

export const dynamic = "force-dynamic";

// The token is in this page's URL fragment, which browsers never send anywhere; no-referrer keeps the page's URL out of
// Referer headers all the same.
export const metadata = { title: "Approve a purchase · Proof of Intent", referrer: "no-referrer" as const };

export default function Approve() {
  return (
    <>
      <header className="wrap nav">
        <a href="/" className="brand">
          Proof of Intent
        </a>
      </header>
      <main>
        <ApproveFlow />
      </main>
    </>
  );
}
