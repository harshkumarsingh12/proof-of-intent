// Owner: @hoursgotviral-dev. Spec: docs/specs/0007-dashboard.md. AG Studio lands once the trial key is in.
import Link from "next/link";

interface PageItem {
  name: string;
  desc: string;
  href?: string;
  badge?: string;
}

const pages: PageItem[] = [
  { name: "Agent orders", desc: "Grid of agent orders with verdicts and reason codes" },
  { name: "Verification queue", desc: "STEP_UP carts with time left; opens the mandate diff" },
  {
    name: "Disputes",
    desc: "Sorted by response deadline; recommendation, evidence preview, operator actions",
    href: "/disputes",
    badge: "Ready",
  },
  { name: "Analytics", desc: "Disputes by class, overreach rate by agent platform, defended vs conceded" },
];

export default function Home() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px 0", color: "#f0f6fc" }}>
          Proof of Intent · Operations
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#8b949e" }}>
          Operations dashboard and AG Studio copilot console. Spec: <code>docs/specs/0007-dashboard.md</code>.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {pages.map(({ name, desc, href, badge }) => (
          <div
            key={name}
            style={{
              padding: 16,
              background: "#161b22",
              border: "1px solid #30363d",
              borderRadius: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 16, color: "#f0f6fc" }}>{name}</strong>
                {badge && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "#34d399",
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                    }}
                  >
                    {badge}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#8b949e", marginTop: 4 }}>{desc}</div>
            </div>

            {href ? (
              <Link
                href={href}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  background: "#238636",
                  color: "#ffffff",
                  textDecoration: "none",
                  border: "1px solid #2ea043",
                }}
              >
                Open Queue →
              </Link>
            ) : (
              <span style={{ fontSize: 12, color: "#484f58" }}>In progress</span>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
