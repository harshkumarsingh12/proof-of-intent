"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DecisionFilter, DisputeFilters, DisputeItem, DisputeSorting, SortField } from "../../src/dispute-types";
import { calculateAge, calculateSla, fetchDisputesDetailed, filterDisputes, formatCurrencyTotals, formatMoney, sortDisputes, type DisputePagingInfo } from "../../src/api";
import { card, kpiLabel, pillButton } from "../../src/theme";
import { SampleDataNotice } from "../SampleDataNotice";

export function DisputeQueue({
  initialDisputes = [],
  initialIsDemo = false,
  initialPaging,
}: {
  initialDisputes?: DisputeItem[];
  initialIsDemo?: boolean;
  initialPaging?: DisputePagingInfo;
}) {
  const [disputes, setDisputes] = useState<DisputeItem[]>(initialDisputes);
  const [loading, setLoading] = useState(initialDisputes.length === 0);
  const [isDemoData, setIsDemoData] = useState(initialIsDemo);
  const [selectedDispute, setSelectedDispute] = useState<DisputeItem | null>(null);
  const [paging, setPaging] = useState<DisputePagingInfo | undefined>(initialPaging);

  // Partial data indicator (issue #173): true only when real paging info indicates more pages exist
  const isPartialData = Boolean(
    paging?.hasMore || (paging?.total !== undefined && paging.total > disputes.length)
  );

  // Filter state
  const [filters, setFilters] = useState<DisputeFilters>({
    decision: "all",
    status: "all",
    search: "",
  });

  // Sort state (default: earliest response due date first per docs/specs/0005)
  const [sorting, setSorting] = useState<DisputeSorting>({
    field: "dueDate",
    direction: "asc",
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchDisputesDetailed();
      setDisputes(res.disputes);
      setIsDemoData(res.isFallback);
      setPaging(res.paging);
    } catch {
      setIsDemoData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedDispute) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedDispute(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedDispute]);

  useEffect(() => {
    if (initialDisputes.length === 0) {
      void loadData();
    }
  }, [initialDisputes.length]);

  // Counts for decision filter pills
  const counts = useMemo(() => {
    const total = disputes.length;
    const defend = disputes.filter((d) => d.decision === "defend").length;
    const concede = disputes.filter((d) => d.decision === "concede").length;
    const standard = disputes.filter((d) => d.decision === "standard").length;
    const urgent = disputes.filter((d) => calculateSla(d.sellerResponseDueDate).isUrgent && d.status === "ACTION_REQUIRED").length;
    const totalAmount = formatCurrencyTotals(disputes);

    return { total, defend, concede, standard, urgent, totalAmount };
  }, [disputes]);

  // Filtered and sorted rows
  const displayedDisputes = useMemo(() => {
    const filtered = filterDisputes(disputes, filters);
    return sortDisputes(filtered, sorting);
  }, [disputes, filters, sorting]);

  const toggleSort = (field: SortField) => {
    if (sorting.field === field) {
      setSorting({
        field,
        direction: sorting.direction === "asc" ? "desc" : "asc",
      });
    } else {
      setSorting({
        field,
        direction: field === "amount" ? "desc" : "asc",
      });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {isDemoData && (
        <SampleDataNotice>
          These disputes come from the built-in demo set. Live disputes appear here once the merchant API serves them.
        </SampleDataNotice>
      )}

      {/* Partial Data Indicator (issue #173) */}
      {isPartialData && (
        <div
          data-testid="partial-data-indicator"
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            color: "var(--poi-blue)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>ℹ️</span>
          <span>
            <strong>Partial data:</strong> Showing first page of disputes. More disputes exist on the server
            {paging?.total !== undefined ? ` (total: ${paging.total})` : ""}.
          </span>
        </div>
      )}

      {/* KPI / Summary Tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
          gap: 16,
        }}
      >
        <div style={cardStyle}>
          <div style={kpiLabelStyle}>Total disputes</div>
          <div style={kpiValueStyle}>{counts.total}</div>
          <div style={kpiSubStyle}>All statuses</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-success)" }}>
          <div style={{ ...kpiLabelStyle, color: "var(--poi-success)" }}>Defend queue</div>
          <div style={kpiValueStyle}>{counts.defend}</div>
          <div style={kpiSubStyle}>Mandate-compliant orders</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-warning)" }}>
          <div style={{ ...kpiLabelStyle, color: "var(--poi-warning)" }}>Concede queue</div>
          <div style={kpiValueStyle}>{counts.concede}</div>
          <div style={kpiSubStyle}>Agent overreach / misread</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid var(--poi-danger)" }}>
          <div style={{ ...kpiLabelStyle, color: "var(--poi-danger)" }}>SLA Urgent (&lt;48h)</div>
          <div style={{ ...kpiValueStyle, color: "var(--poi-danger)" }}>{counts.urgent}</div>
          <div style={kpiSubStyle}>Requires immediate review</div>
        </div>

        <div style={cardStyle}>
          <div style={kpiLabelStyle}>Disputed volume</div>
          <div style={kpiValueStyle}>{counts.totalAmount}</div>
          <div style={kpiSubStyle}>Aggregated per currency</div>
        </div>
      </div>

      {/* Control Bar: Filters & Sorting */}
      <div
        style={{
          ...cardStyle,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Decision Filter Pills */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--poi-text-muted)", fontWeight: 600 }}>Decision:</span>
          {(
            [
              ["all", `All (${counts.total})`],
              ["defend", `Defend (${counts.defend})`],
              ["concede", `Concede (${counts.concede})`],
              ["standard", `Standard (${counts.standard})`],
            ] as [DecisionFilter, string][]
          ).map(([dec, label]) => {
            const isActive = filters.decision === dec;
            return (
              <button
                key={dec}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, decision: dec }))}
                style={{
                  ...pillBtnStyle,
                  background: isActive ? "var(--poi-blue)" : "var(--poi-surface-muted)",
                  color: isActive ? "#ffffff" : "var(--poi-text)",
                  borderColor: isActive ? "var(--poi-blue)" : "var(--poi-border)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Status Dropdown, Search Input, and Refresh */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search dispute, order, platform..."
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            style={inputStyle}
          />

          {/* Status Select */}
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value }))}
            style={selectStyle}
          >
            <option value="all">All statuses</option>
            <option value="ACTION_REQUIRED">Action required</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="WAITING_FOR_BUYER_RESPONSE">Waiting for Buyer</option>
            <option value="WAITING_FOR_SELLER_RESPONSE">Waiting for Seller</option>
            <option value="RESOLVED">Resolved</option>
          </select>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            style={actionBtnStyle}
            title="Reload disputes"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Sorting Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          fontSize: 13,
          color: "var(--poi-text-muted)",
          padding: "0 4px",
        }}
      >
        <div>
          Showing <strong>{displayedDisputes.length}</strong> of <strong>{disputes.length}</strong> disputes
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>Sort by:</span>
          <button
            type="button"
            onClick={() => toggleSort("dueDate")}
            style={sortLinkStyle(sorting.field === "dueDate")}
          >
            Response due {sorting.field === "dueDate" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => toggleSort("amount")}
            style={sortLinkStyle(sorting.field === "amount")}
          >
            Amount {sorting.field === "amount" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
          </button>
          <span>·</span>
          <button
            type="button"
            onClick={() => toggleSort("age")}
            style={sortLinkStyle(sorting.field === "age")}
          >
            Age {sorting.field === "age" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
          </button>
        </div>
      </div>

      {/* Disputes Data Table */}
      <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--poi-surface-muted)", borderBottom: "1px solid var(--poi-border)", color: "var(--poi-text-muted)" }}>
              <th style={thStyle}>Dispute and order ID</th>
              <th style={thStyle}>Platform</th>
              <th style={thStyle}>Decision</th>
              <th style={thStyle}>Status</th>
              <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("amount")}>
                Amount {sorting.field === "amount" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
              </th>
              <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("age")}>
                Age {sorting.field === "age" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
              </th>
              <th style={{ ...thStyle, cursor: "pointer" }} onClick={() => toggleSort("dueDate")}>
                Respond within {sorting.field === "dueDate" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle}>Class and reasons</th>
            </tr>
          </thead>
          <tbody>
            {displayedDisputes.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 48, textAlign: "center", color: "var(--poi-text-muted)" }}>
                  {loading ? "Loading disputes…" : "No disputes match the selected filters."}
                </td>
              </tr>
            ) : (
              displayedDisputes.map((item) => {
                const resolved = item.status === "RESOLVED";
                const sla = resolved ? { isUrgent: false, text: "Closed" } : calculateSla(item.sellerResponseDueDate);
                const age = calculateAge(item.createdAt);

                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedDispute(item)}
                    style={{
                      borderBottom: "1px solid var(--poi-surface-muted)",
                      cursor: "pointer",
                      background: selectedDispute?.id === item.id ? "var(--poi-info-bg)" : "transparent",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedDispute?.id !== item.id) {
                        e.currentTarget.style.background = "var(--poi-nav-hover-bg)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedDispute?.id !== item.id) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {/* Dispute and order ID */}
                    <td style={tdStyle}>
                      <Link
                        href={`/disputes/${item.id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--poi-blue)", textDecoration: "none" }}
                      >
                        {item.id}
                      </Link>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--poi-text-muted)" }}>{item.orderId}</div>
                    </td>

                    {/* Agent Platform */}
                    <td style={tdStyle}>
                      <span style={platformBadgeStyle}>{item.agentPlatform}</span>
                    </td>

                    {/* Decision Chip */}
                    <td style={tdStyle}>
                      <span style={decisionBadgeStyle(item.decision)}>
                        {item.decision.toUpperCase()}
                      </span>
                    </td>

                    {/* Status */}
                    <td style={tdStyle}>
                      <span style={statusBadgeStyle(item.status)}>{item.status.replace(/_/g, " ")}</span>
                    </td>

                    {/* Amount */}
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{formatMoney(item.amount)}</td>

                    {/* Age */}
                    <td style={{ ...tdStyle, color: "var(--poi-text-muted)" }}>{age.text}</td>

                    {/* Response SLA */}
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: sla.isUrgent ? 600 : 400,
                          background: sla.isUrgent ? "var(--poi-danger-bg)" : "var(--poi-surface-muted)",
                          color: sla.isUrgent ? "var(--poi-danger)" : resolved ? "var(--poi-text-muted)" : "var(--poi-text)",
                        }}
                      >
                        {sla.text}
                      </span>
                    </td>

                    {/* Reasons / Class */}
                    <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 240 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <span style={codeBadgeStyle}>{item.disputeClass}</span>
                        {item.reasons.map((r) => (
                          <span key={r} style={{ ...codeBadgeStyle, color: "var(--poi-danger)", borderColor: "var(--poi-danger-border)" }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>

                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Selected Dispute Detail Drawer / Modal */}
      {selectedDispute && (
        <div style={drawerOverlayStyle} onClick={() => setSelectedDispute(null)}>
          <div style={drawerContentStyle} role="dialog" aria-modal="true" aria-label={`Dispute ${selectedDispute.id}`} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: "var(--poi-heading)" }}>
                  Dispute details · <span style={{ fontFamily: "monospace", color: "var(--poi-blue)" }}>{selectedDispute.id}</span>
                </h3>
                <div style={{ fontSize: 12, color: "var(--poi-text-muted)", marginTop: 4 }}>
                  PayPal Order: <span style={{ fontFamily: "monospace" }}>{selectedDispute.paypalOrderId}</span> · Platform:{" "}
                  <strong>{selectedDispute.agentPlatform}</strong>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedDispute(null)} style={closeBtnStyle} aria-label="Close quick view">
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={detailBoxStyle}>
                <div style={kpiLabelStyle}>Decision</div>
                <div style={{ marginTop: 6 }}>
                  <span style={decisionBadgeStyle(selectedDispute.decision)}>
                    {selectedDispute.decision.toUpperCase()} ({selectedDispute.disputeClass})
                  </span>
                </div>
              </div>

              <div style={detailBoxStyle}>
                <div style={kpiLabelStyle}>Disputed amount</div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "var(--poi-heading)" }}>
                  {formatMoney(selectedDispute.amount)}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={kpiLabelStyle}>Buyer claim reason</div>
              <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 13, color: "var(--poi-text)" }}>
                {selectedDispute.buyerDisputeReason}
              </div>
            </div>

            {selectedDispute.reasons.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={kpiLabelStyle}>Reason codes</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {selectedDispute.reasons.map((r) => (
                    <span key={r} style={{ ...codeBadgeStyle, color: "var(--poi-danger)", borderColor: "var(--poi-danger-border)" }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedDispute.shopperNotes && (
              <div style={{ marginBottom: 16 }}>
                <div style={kpiLabelStyle}>Audit and copilot notes</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "var(--poi-text)", background: "var(--poi-bg)", padding: 12, borderRadius: 6, border: "1px solid var(--poi-border)" }}>
                  {selectedDispute.shopperNotes}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button type="button" onClick={() => setSelectedDispute(null)} style={pillBtnStyle}>
                Close
              </button>
              <Link
                href={`/disputes/${selectedDispute.id}`}
                style={{
                  ...pillBtnStyle,
                  background: selectedDispute.decision === "defend" ? "var(--poi-blue)" : selectedDispute.decision === "concede" ? "var(--poi-warning)" : "var(--poi-blue)",
                  color: "#fff",
                  borderColor: selectedDispute.decision === "defend" ? "var(--poi-blue)" : selectedDispute.decision === "concede" ? "var(--poi-warning)" : "var(--poi-blue)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {selectedDispute.decision === "defend"
                  ? "Review and submit evidence →"
                  : selectedDispute.decision === "concede"
                  ? "Review and accept claim →"
                  : "View dispute details →"}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Styling Constants
const cardStyle: React.CSSProperties = {
  ...card,
  padding: 16,
};

const kpiLabelStyle: React.CSSProperties = {
  ...kpiLabel,
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "var(--poi-heading)",
  marginTop: 4,
};

const kpiSubStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--poi-text-muted)",
  marginTop: 4,
};

const pillBtnStyle: React.CSSProperties = {
  ...pillButton,
};

const actionBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid var(--poi-border)",
  background: "var(--poi-surface-muted)",
  color: "var(--poi-blue)",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  color: "var(--poi-text)",
  outline: "none",
  minWidth: 220,
};

const selectStyle: React.CSSProperties = {
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  color: "var(--poi-text)",
  outline: "none",
};

const sortLinkStyle = (active: boolean): React.CSSProperties => ({
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? "var(--poi-blue)" : "var(--poi-text-muted)",
  cursor: "pointer",
});

const thStyle: React.CSSProperties = {
  padding: "12px 14px",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 600,
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
};

const platformBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  background: "var(--poi-surface-muted)",
  color: "var(--poi-text)",
  border: "1px solid var(--poi-border)",
};

const decisionBadgeStyle = (dec: string): React.CSSProperties => {
  if (dec === "defend") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: "var(--poi-success-bg)",
      color: "var(--poi-success)",
      border: "1px solid var(--poi-success-border)",
    };
  }
  if (dec === "concede") {
    return {
      display: "inline-flex",
      alignItems: "center",
      padding: "3px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: "var(--poi-warning-bg)",
      color: "var(--poi-warning)",
      border: "1px solid var(--poi-warning-border)",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: "var(--poi-surface-muted)",
    color: "var(--poi-text-muted)",
    border: "1px solid var(--poi-border)",
  };
};

const statusBadgeStyle = (status: string): React.CSSProperties => {
  const isActionRequired = status === "ACTION_REQUIRED";
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: isActionRequired ? "var(--poi-danger-bg)" : "var(--poi-surface-muted)",
    color: isActionRequired ? "var(--poi-danger)" : "var(--poi-text-muted)",
    border: isActionRequired ? "1px solid var(--poi-danger-border)" : "1px solid var(--poi-border)",
  };
};

const codeBadgeStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
  fontFamily: "monospace",
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 3,
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  color: "var(--poi-text)",
};

const drawerOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "var(--poi-overlay)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  padding: 16,
};

const drawerContentStyle: React.CSSProperties = {
  background: "var(--poi-surface)",
  border: "1px solid var(--poi-border)",
  borderRadius: 8,
  width: "100%",
  maxWidth: 600,
  padding: 24,
  boxShadow: "var(--poi-shadow-lg)",
};

const detailBoxStyle: React.CSSProperties = {
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  borderRadius: 6,
  padding: 12,
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  color: "var(--poi-text-muted)",
  cursor: "pointer",
  padding: 4,
};
