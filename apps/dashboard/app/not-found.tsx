// Rendered inside the app shell for unknown routes and unknown dispute ids (notFound()).
import Link from "next/link";
import { card, pageSubtitle, pageTitle, pillButton, v } from "../src/theme";

export default function NotFound() {
  return (
    <div style={{ maxWidth: 720, margin: "40px auto" }}>
      <div style={{ ...card, padding: "40px 44px" }}>
        <h1 style={{ ...pageTitle, fontSize: 32 }}>We couldn&apos;t find that page</h1>
        <p style={{ ...pageSubtitle, marginBottom: 28 }}>
          The dispute or page may not exist. Search for a dispute id at the top, or go back to the queue.
        </p>
        <div style={{ display: "flex", gap: 12 }}>
          <Link
            href="/disputes"
            style={{ ...pillButton, background: v("blue"), borderColor: v("blue"), color: "#ffffff", textDecoration: "none" }}
          >
            Open the dispute queue
          </Link>
          <Link href="/" style={{ ...pillButton, textDecoration: "none" }}>
            Go to home
          </Link>
        </div>
      </div>
    </div>
  );
}
