import type { ReactNode } from "react";
import { parsePayPalMode } from "../src/merchant";
import { fontStack, themeCss, v } from "../src/theme";
import { AppShell } from "./AppShell";

export const metadata = { title: "Proof of Intent · Operations" };

// Render per request: PAYPAL_MODE comes from the runtime .env (not the image build), and seed data is relative to now.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  // Server-side, from the same .env the API uses (compose env_file), so the badge shows the real mode.
  const mode = parsePayPalMode(process.env.PAYPAL_MODE);

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body style={{ fontFamily: fontStack, margin: 0, background: v("bg"), color: v("text"), lineHeight: 1.5 }}>
        <AppShell mode={mode}>{children}</AppShell>
      </body>
    </html>
  );
}
