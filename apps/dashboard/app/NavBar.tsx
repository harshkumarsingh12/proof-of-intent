"use client";
// Top bar: our own wordmark, not PayPal's logo. Active link gets the blue underline.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { v } from "../src/theme";

const links = [
  { href: "/", label: "Overview" },
  { href: "/disputes", label: "Disputes" },
  { href: "/analytics", label: "Analytics" },
];

export function NavBar() {
  const pathname = usePathname() ?? "/";
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header style={{ background: v("surface"), borderBottom: `1px solid ${v("border")}` }}>
      <nav
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "0 24px",
          height: 64,
          display: "flex",
          alignItems: "center",
          gap: 40,
        }}
      >
        <Link href="/" style={{ textDecoration: "none", display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: v("navy"), letterSpacing: "-0.01em" }}>
            Proof of Intent
          </span>
          <span style={{ fontSize: 11, color: v("textMuted") }}>Built for PayPal merchants</span>
        </Link>

        <div style={{ display: "flex", gap: 28, height: "100%" }}>
          {links.map(({ href, label }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  textDecoration: "none",
                  fontSize: 15,
                  fontWeight: active ? 600 : 500,
                  color: active ? v("navy") : v("textMuted"),
                  borderBottom: `3px solid ${active ? v("blue") : "transparent"}`,
                  paddingTop: 3,
                }}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
