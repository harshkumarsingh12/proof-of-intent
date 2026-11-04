import type { ReactNode } from "react";

export const metadata = { title: "Proof of Intent · Operations" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 32, background: "#0f1115", color: "#e6e6e6" }}>
        {children}
      </body>
    </html>
  );
}
