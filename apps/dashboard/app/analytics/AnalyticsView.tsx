"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "../../src/analytics-types";
import { fetchAnalytics, formatMoney } from "../../src/api";
import { card, kpiLabel } from "../../src/theme";
import { SampleDataNotice } from "../SampleDataNotice";

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
      <div style={{ padding: 48, textAlign: "center", color: "var(--poi-text-muted)" }}>
        Loading analytics…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--poi-danger)" }}>
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
      {data.isSample && (
        <SampleDataNotice>
          These numbers come from the built-in demo set (300 checkout orders, 24 disputes). Live figures appear here once
          the merchant API serves them.
        </SampleDataNotice>
      )}

      {/* Overview Cards: Defended vs Conceded, Amount Protected, Blocked Overreach Carts */}
      <div className="poi-grid-4" style={{ display: "grid", gap: 16 }}>
        {/* Card 1: Disputes Defended vs Conceded */}
        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-success)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "var(--poi-success)" }}>Copilot calls: defend vs. concede</div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "var(--poi-heading)" }}>
              {data.disputes.defended}
            </span>
            <span style={{ fontSize: 14, color: "var(--poi-text-muted)" }}>to defend</span>
            <span style={{ color: "var(--poi-text-subtle)" }}>/</span>
            <span style={{ fontSize: 24, fontWeight: 600, color: "var(--poi-warning)" }}>
              {data.disputes.conceded}
            </span>
            <span style={{ fontSize: 14, color: "var(--poi-text-muted)" }}>to concede</span>
          </div>

          {/* Progress bar visual */}
          <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: "var(--poi-surface-muted)", overflow: "hidden", display: "flex" }}>
            <div
              style={{
                width: `${data.disputes.defenseRate}%`,
                background: "var(--poi-success)",
                borderRadius: "4px 0 0 4px",
              }}
              title={`Defended: ${data.disputes.defenseRate}%`}
            />
            <div
              style={{
                width: `${100 - data.disputes.defenseRate}%`,
                background: "var(--poi-warning)",
                borderRadius: "0 4px 4px 0",
              }}
              title={`Conceded: ${100 - data.disputes.defenseRate}%`}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: 12, color: "var(--poi-text-muted)" }}>
            <span>Defense win rate (confirmed by PayPal): <strong style={{ color: "var(--poi-success)" }}>{data.disputes.defenseRate}%</strong></span>
            <span>Total: {data.disputes.total}</span>
          </div>
        </div>

        {/* Card 2: Amount Protected */}
        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-blue)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "var(--poi-blue)" }}>Amount protected</div>
          </div>

          <div style={{ fontSize: 32, fontWeight: 700, color: "var(--poi-heading)", marginTop: 8 }}>
            {formatMoney(data.amountProtected.defendedTotal)}
          </div>

          <div style={{ fontSize: 13, color: "var(--poi-text-muted)", marginTop: 6 }}>
            Saved from disputes resolved in merchant's favor
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--poi-surface-muted)", fontSize: 12, color: "var(--poi-text-muted)" }}>
            Conceded / Refunded: <strong style={{ color: "var(--poi-warning)" }}>{formatMoney(data.amountProtected.concededTotal)}</strong>
          </div>
        </div>

        {/* Card 3: Blocked Overreach Carts */}
        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-danger)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "var(--poi-danger)" }}>Blocked overreach carts</div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "var(--poi-danger)" }}>
              {data.blockedOverreachCarts.totalBlocked}
            </span>
            <span style={{ fontSize: 13, color: "var(--poi-text-muted)" }}>carts prevented at checkout</span>
          </div>

          <div style={{ fontSize: 13, color: "var(--poi-text-muted)", marginTop: 4 }}>
            Unauthorized spend prevented:{" "}
            <strong style={{ color: "var(--poi-heading)" }}>{formatMoney(data.blockedOverreachCarts.preventedSpend)}</strong>
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
        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-blue-light)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ ...kpiLabelStyle, color: "var(--poi-navy)" }}>Median response window</div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 8px", marginTop: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 700, color: "var(--poi-heading)" }}>
              {data.performance.medianResponseHours}
            </span>
            <span style={{ fontSize: 14, color: "var(--poi-text-muted)" }}>hours from dispute opened to seller deadline</span>
          </div>

          <div style={{ fontSize: 13, color: "var(--poi-text-muted)", marginTop: 4 }}>
            Across disputes with drafted evidence or a resolution
          </div>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--poi-surface-muted)", fontSize: 12, color: "var(--poi-success)" }}>
            ✓ {data.performance.slaBreachedCount} SLA deadlines breached
          </div>
        </div>
      </div>

      {/* The One Chart: Defended vs Conceded by Agent Platform */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>
                Disputes by agent platform · defended vs. conceded
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--poi-text-muted)" }}>
              Performance and overreach rate across autonomous buyer agent frameworks.
            </p>
          </div>

          {/* Chart Legend */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-success)" }} />
              <span style={{ color: "var(--poi-text)" }}>Defended (Compliant)</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-warning)" }} />
              <span style={{ color: "var(--poi-text)" }}>Conceded (Overreach)</span>
            </div>
          </div>
        </div>

        {/* Clean SVG / HTML Bar Chart */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 8, padding: 20 }}>
          {data.byPlatform.map((item) => {
            const defendedPct = Math.round((item.defendedDisputes / maxDisputeCount) * 100);
            const concededPct = Math.round((item.concededDisputes / maxDisputeCount) * 100);

            return (
              <div key={item.platform} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {/* Platform Label & Stats */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ color: "var(--poi-heading)", minWidth: 120 }}>{item.platform}</strong>
                    <span style={{ fontSize: 11, color: "var(--poi-text-muted)" }}>({item.totalOrders} total orders)</span>
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--poi-text-muted)" }}>
                    <span>
                      Defended: <strong style={{ color: "var(--poi-success)" }}>{item.defendedDisputes}</strong> ({formatMoney(item.defendedAmount)})
                    </span>
                    <span>
                      Conceded: <strong style={{ color: "var(--poi-warning)" }}>{item.concededDisputes}</strong> ({formatMoney(item.concededAmount)})
                    </span>
                    <span style={{ color: item.overreachRate > 40 ? "var(--poi-danger)" : "var(--poi-text)" }}>
                      Overreach rate: <strong>{item.overreachRate}%</strong>
                    </span>
                  </div>
                </div>

                {/* Bars for Platform */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {/* Defended Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, fontSize: 11, color: "var(--poi-success)", textAlign: "right" }}>Defend</div>
                    <div style={{ flex: 1, background: "var(--poi-surface-muted)", borderRadius: 4, height: 16, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${defendedPct}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, var(--poi-success) 0%, var(--poi-success) 100%)",
                          borderRadius: 4,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <div style={{ width: 30, fontSize: 11, color: "var(--poi-text)", fontWeight: 600 }}>
                      {item.defendedDisputes}
                    </div>
                  </div>

                  {/* Conceded Bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 60, fontSize: 11, color: "var(--poi-warning)", textAlign: "right" }}>Concede</div>
                    <div style={{ flex: 1, background: "var(--poi-surface-muted)", borderRadius: 4, height: 16, overflow: "hidden" }}>
                      <div
                        style={{
                          width: `${concededPct}%`,
                          height: "100%",
                          background: "linear-gradient(90deg, var(--poi-warning) 0%, var(--poi-warning) 100%)",
                          borderRadius: 4,
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <div style={{ width: 30, fontSize: 11, color: "var(--poi-text)", fontWeight: 600 }}>
                      {item.concededDisputes}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chart 2: Disputes by class per week per docs/specs/0007 */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>
                Disputes by class per week
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--poi-text-muted)" }}>
              Weekly volume breakdown across mandate compliance, agent overreach, intent misread, and standard classes.
            </p>
          </div>

          {/* Chart Legend */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-success)" }} />
              <span style={{ color: "var(--poi-text)" }}>Mandate compliant</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-warning)" }} />
              <span style={{ color: "var(--poi-text)" }}>Agent overreach</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-blue-light)" }} />
              <span style={{ color: "var(--poi-text)" }}>Intent misread</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 12, height: 12, borderRadius: 2, background: "var(--poi-text-subtle)" }} />
              <span style={{ color: "var(--poi-text)" }}>No mandate</span>
            </div>
          </div>
        </div>

        {/* Stacked Bars by Week */}
        <div
          data-testid="disputes-by-class-chart"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            background: "var(--poi-bg)",
            border: "1px solid var(--poi-border)",
            borderRadius: 8,
            padding: 20,
          }}
        >
          {data.disputesByClassPerWeek.map((item) => {
            const maxWeeklyTotal = Math.max(
              ...data.disputesByClassPerWeek.map((w) => w.total),
              1
            );
            const compliantPct = item.total > 0 ? (item.mandateCompliant / item.total) * 100 : 0;
            const overreachPct = item.total > 0 ? (item.agentOverreach / item.total) * 100 : 0;
            const misreadPct = item.total > 0 ? (item.intentMisread / item.total) * 100 : 0;
            const noMandatePct = item.total > 0 ? (item.noMandate / item.total) * 100 : 0;
            const barWidthPct = Math.round((item.total / maxWeeklyTotal) * 100);

            return (
              <div key={item.week} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 13 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ color: "var(--poi-heading)", minWidth: 140 }}>{item.week}</strong>
                    <span style={{ fontSize: 11, color: "var(--poi-text-muted)" }}>({item.total} disputes)</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--poi-text-muted)" }}>
                    <span>
                      Compliant: <strong style={{ color: "var(--poi-success)" }}>{item.mandateCompliant}</strong>
                    </span>
                    <span>
                      Overreach: <strong style={{ color: "var(--poi-warning)" }}>{item.agentOverreach}</strong>
                    </span>
                    <span>
                      Misread: <strong style={{ color: "var(--poi-navy)" }}>{item.intentMisread}</strong>
                    </span>
                    <span>
                      No mandate: <strong style={{ color: "var(--poi-text-subtle)" }}>{item.noMandate}</strong>
                    </span>
                  </div>
                </div>

                {/* Stacked Progress Bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      background: "var(--poi-surface-muted)",
                      borderRadius: 4,
                      height: 18,
                      overflow: "hidden",
                      display: "flex",
                    }}
                  >
                    {item.total > 0 ? (
                      <div
                        style={{
                          width: `${barWidthPct}%`,
                          display: "flex",
                          height: "100%",
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        {item.mandateCompliant > 0 && (
                          <div
                            style={{
                              width: `${compliantPct}%`,
                              background: "var(--poi-success)",
                            }}
                          />
                        )}
                        {item.agentOverreach > 0 && (
                          <div
                            style={{
                              width: `${overreachPct}%`,
                              background: "var(--poi-warning)",
                            }}
                          />
                        )}
                        {item.intentMisread > 0 && (
                          <div
                            style={{
                              width: `${misreadPct}%`,
                              background: "var(--poi-blue-light)",
                            }}
                          />
                        )}
                        {item.noMandate > 0 && (
                          <div
                            style={{
                              width: `${noMandatePct}%`,
                              background: "var(--poi-text-subtle)",
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          paddingLeft: 8,
                          fontSize: 11,
                          color: "var(--poi-text-subtle)",
                        }}
                      >
                        No disputes
                      </div>
                    )}
                  </div>
                  <div style={{ width: 30, fontSize: 11, color: "var(--poi-text)", fontWeight: 600 }}>
                    {item.total}
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
  ...card,
  padding: 20,
};

const kpiLabelStyle: React.CSSProperties = {
  ...kpiLabel,
};

const codeBadgeStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 3,
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  color: "var(--poi-text)",
};
