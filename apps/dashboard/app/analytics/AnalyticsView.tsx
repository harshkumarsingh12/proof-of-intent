"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "../../src/analytics-types";
import { fetchAnalytics, formatMoney } from "../../src/api";

export function AnalyticsView({ initialData }: { initialData?: AnalyticsSummary }) {
  const [data, setData] = useState<AnalyticsSummary | undefined>(initialData);
  const [loading, setLoading] = useState(!initialData);

  const loadData = async () => {
    setLoading(true);
    try {
      const summary = await fetchAnalytics();
      setData(summary);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      void loadData();
    }
  }, [initialData]);

  if (loading && !data) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#8b949e" }}>
        Loading merchant analytics from API...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "#f85149" }}>
        Failed to load analytics data.
      </div>
    );
  }

  // Calculate highest dispute count for chart scaling
  const maxDisputeCount = Math.max(
    ...data.byPlatform.map((p) => Math.max(p.defendedDisputes, p.concededDisputes, 5))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Overview Cards: Defended vs Conceded, Amount Protected, Blocked Overreach Carts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 16,
        }}
      >
        {/* Card 1: Disputes Defended vs Conceded */}
        <div style={{ ...cardStyle, borderLeft: "4px solid #10b981" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "#34d399" }}>Disputes Defended vs Conceded</div>
            <span style={{ fontSize: 18 }}>🛡️</span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#f0f6fc" }}>
              {data.disputes.defended}
            </span>
            <span style={{ fontSize: 14, color: "#8b949e" }}>defended</span>
            <span style={{ color: "#484f58" }}>/</span>
            <span style={{ fontSize: 24, fontWeight: 600, color: "#fbbf24" }}>
              {data.disputes.conceded}
            </span>
            <span style={{ fontSize: 14, color: "#8b949e" }}>conceded</span>
          </div>

          {/* Progress bar visual */}
          <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: "#21262d", overflow: "hidden", display: "flex" }}>
            <div
              style={{
                width: `${data.disputes.defenseRate}%`,
                background: "#10b981",
                borderRadius: "4px 0 0 4px",
              }}
              title={`Defended: ${data.disputes.defenseRate}%`}
            />
            <div
              style={{
                width: `${100 - data.disputes.defenseRate}%`,
                background: "#f59e0b",
                borderRadius: "0 4px 4px 0",
              }}
              title={`Conceded: ${100 - data.disputes.defenseRate}%`}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#8b949e" }}>
            <span>Defense Win Rate: <strong style={{ color: "#34d399" }}>{data.disputes.defenseRate}%</strong></span>
            <span>Total: {data.disputes.total}</span>
          </div>
        </div>

        {/* Card 2: Amount Protected */}
        <div style={{ ...cardStyle, borderLeft: "4px solid #58a6ff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "#58a6ff" }}>Amount Protected</div>
            <span style={{ fontSize: 18 }}>💰</span>
          </div>

          <div style={{ fontSize: 32, fontWeight: 700, color: "#f0f6fc", marginTop: 8 }}>
            {formatMoney(data.amountProtected.defendedTotal)}
          </div>

          <div style={{ fontSize: 13, color: "#8b949e", marginTop: 6 }}>
            Saved by defending compliant orders with signed mandates
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #21262d", fontSize: 12, color: "#8b949e" }}>
            Conceded / Refunded: <strong style={{ color: "#fbbf24" }}>{formatMoney(data.amountProtected.concededTotal)}</strong>
          </div>
        </div>

        {/* Card 3: Blocked Overreach Carts */}
        <div style={{ ...cardStyle, borderLeft: "4px solid #ef4444" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "#f87171" }}>Blocked Overreach Carts</div>
            <span style={{ fontSize: 18 }}>🚫</span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#f87171" }}>
              {data.blockedOverreachCarts.totalBlocked}
            </span>
            <span style={{ fontSize: 13, color: "#8b949e" }}>carts prevented at checkout</span>
          </div>

          <div style={{ fontSize: 13, color: "#8b949e", marginTop: 4 }}>
            Unauthorized spend prevented:{" "}
            <strong style={{ color: "#f0f6fc" }}>{formatMoney(data.blockedOverreachCarts.preventedSpend)}</strong>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {data.blockedOverreachCarts.topReasonCodes.map((r) => (
              <span key={r.code} style={codeBadgeStyle}>
                {r.code}: {r.count} ({r.percentage}%)
              </span>
            ))}
          </div>
        </div>

        {/* Card 4: Response Efficiency */}
        <div style={{ ...cardStyle, borderLeft: "4px solid #a855f7" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "#c084fc" }}>Median Response Time</div>
            <span style={{ fontSize: 18 }}>⚡</span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "#f0f6fc" }}>
              {data.performance.medianResponseHours}
            </span>
            <span style={{ fontSize: 14, color: "#8b949e" }}>hours to submit evidence</span>
          </div>

          <div style={{ fontSize: 13, color: "#8b949e", marginTop: 4 }}>
            Accelerated from industry standard 5 days to automated drafting
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #21262d", fontSize: 12, color: "#34d399" }}>
            ✓ {data.performance.slaBreachedCount} SLA deadlines breached
          </div>
        </div>
      </div>

      {/* The One Chart: Defended vs Conceded by Agent Platform */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
                Disputes by Agent Platform · Defended vs Conceded
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#8b949e" }}>
              Performance and overreach rate across autonomous buyer agent frameworks.
            </p>
          </div>

          {/* Chart Legend */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "#10b981" }} />
              <span style={{ color: "#c9d1d9" }}>Defended (Compliant)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "#f59e0b" }} />
              <span style={{ color: "#c9d1d9" }}>Conceded (Overreach)</span>
            </div>
          </div>
        </div>

        {/* Clean SVG / HTML Bar Chart */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: 20 }}>
          {data.byPlatform.map((item) => {
            const defendedPct = Math.round((item.defendedDisputes / maxDisputeCount) * 100);
            const concededPct = Math.round((item.concededDisputes / maxDisputeCount) * 100);

            return (
              <div key={item.platform} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Platform Label & Stats */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ color: "#f0f6fc", minWidth: 120 }}>{item.platform}</strong>
                    <span style={{ fontSize: 11, color: "#8b949e" }}>({item.totalOrders} total orders)</span>
                  </div>

                  <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#8b949e" }}>
                    <span>
                      Defended: <strong style={{ color: "#34d399" }}>{item.defendedDisputes}</strong> ({formatMoney(item.defendedAmount)})
                    </span>
                    <span>
                      Conceded: <strong style={{ color: "#fbbf24" }}>{item.concededDisputes}</strong> ({formatMoney(item.concededAmount)})
                    </span>
                    <span style={{ color: item.overreachRate > 40 ? "#f87171" : "#c9d1d9" }}>
                      Overreach Rate: <strong>{item.overreachRate}%</strong>
                    </span>
                  </div>
                </div>

                {/* Bars for Platform */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* Defended Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, fontSize: 11, color: "#34d399", textAlign: "right" }}>Defend</div>
                    <div style={{ flex: 1, background: "#21262d", borderRadius: 4, height: 16, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${defendedPct}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #059669 0%, #10b981 100%)",
                          borderRadius: 4,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <div style={{ width: 30, fontSize: 11, color: "#c9d1d9", fontWeight: 600 }}>
                      {item.defendedDisputes}
                    </div>
                  </div>

                  {/* Conceded Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, fontSize: 11, color: "#fbbf24", textAlign: "right" }}>Concede</div>
                    <div style={{ flex: 1, background: "#21262d", borderRadius: 4, height: 16, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${concededPct}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, #d97706 0%, #f59e0b 100%)",
                          borderRadius: 4,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <div style={{ width: 30, fontSize: 11, color: "#c9d1d9", fontWeight: 600 }}>
                      {item.concededDisputes}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Styling Constants
const cardStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 20,
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const codeBadgeStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 3,
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#c9d1d9",
};
