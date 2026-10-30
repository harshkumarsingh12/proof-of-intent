"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionFilter, DisputeFilters, DisputeItem, DisputeSorting, SortField } from "../../src/dispute-types";
import { calculateAge, calculateSla, fetchDisputes, filterDisputes, formatMoney, sortDisputes } from "../../src/api";

export function DisputeQueue({ initialDisputes = [] }: { initialDisputes?: DisputeItem[] }) {
  const [disputes, setDisputes] = useState<DisputeItem[]>(initialDisputes);
  const [loading, setLoading] = useState(initialDisputes.length === 0);
  const [selectedDispute, setSelectedDispute] = useState<DisputeItem | null>(null);

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
      const data = await fetchDisputes();
      setDisputes(data);
    } finally {
      setLoading(false);
    }
  };

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
    const totalCents = disputes.reduce((sum, d) => sum + d.amount.value, 0);

    return { total, defend, concede, standard, urgent, totalAmount: formatMoney({ value: totalCents, currency: "USD" }) };
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
      {/* KPI / Summary Tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
        }}
      >
        <div style={cardStyle}>
          <div style={kpiLabelStyle}>Total Disputes</div>
          <div style={kpiValueStyle}>{counts.total}</div>
          <div style={kpiSubStyle}>Active in merchant queue</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid #10b981" }}>
          <div style={{ ...kpiLabelStyle, color: "#34d399" }}>Defend Queue</div>
          <div style={kpiValueStyle}>{counts.defend}</div>
          <div style={kpiSubStyle}>Mandate-compliant orders</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid #f59e0b" }}>
          <div style={{ ...kpiLabelStyle, color: "#fbbf24" }}>Concede Queue</div>
          <div style={kpiValueStyle}>{counts.concede}</div>
          <div style={kpiSubStyle}>Agent overreach / misread</div>
        </div>

        <div style={{ ...cardStyle, borderLeft: "4px solid #ef4444" }}>
          <div style={{ ...kpiLabelStyle, color: "#f87171" }}>SLA Urgent (&lt;48h)</div>
          <div style={{ ...kpiValueStyle, color: "#f87171" }}>{counts.urgent}</div>
          <div style={kpiSubStyle}>Requires immediate review</div>
        </div>

        <div style={cardStyle}>
          <div style={kpiLabelStyle}>Disputed Volume</div>
          <div style={kpiValueStyle}>{counts.totalAmount}</div>
          <div style={kpiSubStyle}>Minor units converted to USD</div>
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
          <span style={{ fontSize: 13, color: "#8b949e", fontWeight: 600 }}>Decision:</span>
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
                  background: isActive ? "#238636" : "#21262d",
                  color: isActive ? "#ffffff" : "#c9d1d9",
                  borderColor: isActive ? "#2ea043" : "#30363d",
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
            <option value="all">All Statuses</option>
            <option value="ACTION_REQUIRED">Action Required</option>
            <option value="UNDER_REVIEW">Under Review</option>
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
            title="Reload from API"
          >
            {loading ? "Loading..." : "Refresh API"}
          </button>
        </div>
      </div>

      {/* Sorting Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 13,
          color: "#8b949e",
          padding: "0 4px",
        }}
      >
        <div>
          Showing <strong>{displayedDisputes.length}</strong> of <strong>{disputes.length}</strong> disputes
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>Sort by:</span>
          <button
            type="button"
            onClick={() => toggleSort("dueDate")}
            style={sortLinkStyle(sorting.field === "dueDate")}
          >
            Response Due Date {sorting.field === "dueDate" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
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
            <tr style={{ background: "#1c2128", borderBottom: "1px solid #30363d", color: "#8b949e" }}>
              <th style={thStyle}>Dispute & Order ID</th>
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
                Response SLA {sorting.field === "dueDate" ? (sorting.direction === "asc" ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle}>Reasons / Class</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedDisputes.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 48, textAlign: "center", color: "#8b949e" }}>
                  {loading ? "Loading disputes from API..." : "No disputes match the selected filters."}
                </td>
              </tr>
            ) : (
              displayedDisputes.map((item) => {
                const sla = calculateSla(item.sellerResponseDueDate);
                const age = calculateAge(item.createdAt);

                return (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedDispute(item)}
                    style={{
                      borderBottom: "1px solid #21262d",
                      cursor: "pointer",
                      background: selectedDispute?.id === item.id ? "rgba(56, 139, 253, 0.1)" : "transparent",
                      transition: "background 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (selectedDispute?.id !== item.id) {
                        e.currentTarget.style.background = "#161b22";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (selectedDispute?.id !== item.id) {
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {/* Dispute & Order ID */}
                    <td style={tdStyle}>
                      <div style={{ fontFamily: "monospace", fontWeight: 600, color: "#58a6ff" }}>{item.id}</div>
                      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#8b949e" }}>{item.orderId}</div>
                    </td>

                    {/* Agent Platform */}
                    <td style={tdStyle}>
                      <span style={platformBadgeStyle}>{item.agentPlatform}</span>
                    </td>

                    {/* Decision Chip */}
                    <td style={tdStyle}>
                      <span style={decisionBadgeStyle(item.decision)}>
                        {item.decision === "defend" && "🛡️ "}
                        {item.decision === "concede" && "↩️ "}
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
                    <td style={{ ...tdStyle, color: "#8b949e" }}>{age.text}</td>

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
                          background: sla.isUrgent ? "rgba(239, 68, 68, 0.15)" : "rgba(110, 118, 129, 0.1)",
                          color: sla.isUrgent ? "#f87171" : "#c9d1d9",
                        }}
                      >
                        {sla.isUrgent && "⚠️"} {sla.text}
                      </span>
                    </td>

                    {/* Reasons / Class */}
                    <td style={tdStyle}>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        <span style={codeBadgeStyle}>{item.disputeClass}</span>
                        {item.reasons.map((r) => (
                          <span key={r} style={{ ...codeBadgeStyle, color: "#f85149", borderColor: "rgba(248, 81, 73, 0.4)" }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Action */}
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDispute(item);
                        }}
                        style={inspectBtnStyle}
                      >
                        Inspect
                      </button>
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
        <div style={drawerOverlayStyle}>
          <div style={drawerContentStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, color: "#f0f6fc" }}>
                  Dispute Details · <span style={{ fontFamily: "monospace", color: "#58a6ff" }}>{selectedDispute.id}</span>
                </h3>
                <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
                  PayPal Order: <span style={{ fontFamily: "monospace" }}>{selectedDispute.paypalOrderId}</span> · Platform:{" "}
                  <strong>{selectedDispute.agentPlatform}</strong>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedDispute(null)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div style={detailBoxStyle}>
                <div style={kpiLabelStyle}>Decision Verdict</div>
                <div style={{ marginTop: 6 }}>
                  <span style={decisionBadgeStyle(selectedDispute.decision)}>
                    {selectedDispute.decision.toUpperCase()} ({selectedDispute.disputeClass})
                  </span>
                </div>
              </div>

              <div style={detailBoxStyle}>
                <div style={kpiLabelStyle}>Disputed Amount</div>
                <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: "#f0f6fc" }}>
                  {formatMoney(selectedDispute.amount)}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={kpiLabelStyle}>Buyer Claim Reason</div>
              <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 13, color: "#e6edf3" }}>
                {selectedDispute.buyerDisputeReason}
              </div>
            </div>

            {selectedDispute.reasons.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={kpiLabelStyle}>Reason Codes</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {selectedDispute.reasons.map((r) => (
                    <span key={r} style={{ ...codeBadgeStyle, color: "#f85149", borderColor: "rgba(248, 81, 73, 0.4)" }}>
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedDispute.shopperNotes && (
              <div style={{ marginBottom: 16 }}>
                <div style={kpiLabelStyle}>Audit & Copilot Notes</div>
                <div style={{ marginTop: 6, fontSize: 13, color: "#c9d1d9", background: "#0d1117", padding: 12, borderRadius: 6, border: "1px solid #30363d" }}>
                  {selectedDispute.shopperNotes}
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 24 }}>
              <button type="button" onClick={() => setSelectedDispute(null)} style={pillBtnStyle}>
                Close
              </button>
              {selectedDispute.decision === "defend" && (
                <button
                  type="button"
                  style={{ ...pillBtnStyle, background: "#238636", color: "#fff", borderColor: "#2ea043" }}
                  onClick={() => alert(`Submitting evidence package for ${selectedDispute.id}...`)}
                >
                  Submit Evidence
                </button>
              )}
              {selectedDispute.decision === "concede" && (
                <button
                  type="button"
                  style={{ ...pillBtnStyle, background: "#d97706", color: "#fff", borderColor: "#f59e0b" }}
                  onClick={() => alert(`Accepting claim and refunding for ${selectedDispute.id}...`)}
                >
                  Accept Claim (Refund)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Styling Constants
const cardStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 16,
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#8b949e",
};

const kpiValueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 700,
  color: "#f0f6fc",
  marginTop: 4,
};

const kpiSubStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#8b949e",
  marginTop: 4,
};

const pillBtnStyle: React.CSSProperties = {
  padding: "5px 12px",
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid #30363d",
  background: "#21262d",
  color: "#c9d1d9",
  cursor: "pointer",
};

const actionBtnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid #30363d",
  background: "#21262d",
  color: "#58a6ff",
  cursor: "pointer",
};

const inspectBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  border: "1px solid #30363d",
  background: "#21262d",
  color: "#c9d1d9",
  cursor: "pointer",
};

const inputStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  color: "#c9d1d9",
  outline: "none",
  minWidth: 220,
};

const selectStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  color: "#c9d1d9",
  outline: "none",
};

const sortLinkStyle = (active: boolean): React.CSSProperties => ({
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  fontWeight: active ? 600 : 400,
  color: active ? "#58a6ff" : "#8b949e",
  cursor: "pointer",
});

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 12,
  fontWeight: 600,
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  verticalAlign: "middle",
};

const platformBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  background: "#21262d",
  color: "#c9d1d9",
  border: "1px solid #30363d",
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
      background: "rgba(16, 185, 129, 0.15)",
      color: "#34d399",
      border: "1px solid rgba(16, 185, 129, 0.4)",
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
      background: "rgba(245, 158, 11, 0.15)",
      color: "#fbbf24",
      border: "1px solid rgba(245, 158, 11, 0.4)",
    };
  }
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    background: "rgba(100, 116, 139, 0.15)",
    color: "#94a3b8",
    border: "1px solid rgba(100, 116, 139, 0.4)",
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
    background: isActionRequired ? "rgba(248, 81, 73, 0.15)" : "#21262d",
    color: isActionRequired ? "#f85149" : "#8b949e",
    border: isActionRequired ? "1px solid rgba(248, 81, 73, 0.3)" : "1px solid #30363d",
  };
};

const codeBadgeStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  padding: "2px 6px",
  borderRadius: 3,
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#c9d1d9",
};

const drawerOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.7)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  padding: 16,
};

const drawerContentStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  width: "100%",
  maxWidth: 600,
  padding: 24,
  boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
};

const detailBoxStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: 12,
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  color: "#8b949e",
  cursor: "pointer",
  padding: 4,
};
