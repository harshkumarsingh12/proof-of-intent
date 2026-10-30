import type { ReactNode } from "react";

export const metadata = { title: "Proof of Intent · Shop" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 32, maxWidth: 720 }}>
        {children}
      </body>
    </html>
  );
}
