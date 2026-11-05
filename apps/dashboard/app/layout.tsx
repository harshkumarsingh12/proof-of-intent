import type { ReactNode } from "react";
import { fontStack, themeCss, v } from "../src/theme";
import { NavBar } from "./NavBar";

export const metadata = { title: "Proof of Intent · Operations" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body style={{ fontFamily: fontStack, margin: 0, background: v("bg"), color: v("text"), lineHeight: 1.5 }}>
        <NavBar />
        <div style={{ padding: "32px 24px 48px" }}>{children}</div>
      </body>
    </html>
  );
}
