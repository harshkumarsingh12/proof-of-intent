"use client";

import { useMemo, useState } from "react";
import type { DisputeDetail } from "../../../src/dispute-types";
import { calculateAge, calculateSla, formatMoney } from "../../../src/api";

export function DisputeDetailView({ dispute }: { dispute: DisputeDetail }) {
  const [onlyViolations, setOnlyViolations] = useState(false);
  const [pdfOpened, setPdfOpened] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [conceded, setConceded] = useState(false);

  const age = useMemo(() => calculateAge(dispute.createdAt), [dispute.createdAt]);
  const sla = useMemo(() => calculateSla(dispute.sellerResponseDueDate), [dispute.sellerResponseDueDate]);

  // Filter constraint checks by violations if toggled
  const displayedChecks = useMemo(() => {
    if (onlyViolations) {
      return dispute.constraintChecks.filter((c) => c.status === "FAIL");
    }
    return dispute.constraintChecks;
  }, [dispute.constraintChecks, onlyViolations]);

  const failingCount = useMemo(
    () => dispute.constraintChecks.filter((c) => c.status === "FAIL").length,
    [dispute.constraintChecks]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header Bar */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#f0f6fc", fontFamily: "monospace" }}>
                {dispute.id}
              </h1>
              <span style={decisionBadgeStyle(dispute.decision)}>
                {dispute.decision === "defend" && "🛡️ "}
                {dispute.decision === "concede" && "↩️ "}
                {dispute.decision.toUpperCase()}
              </span>
              <span style={statusBadgeStyle(dispute.status)}>{dispute.status.replace(/_/g, " ")}</span>
              <span style={platformBadgeStyle}>{dispute.agentPlatform}</span>
            </div>

            <div style={{ marginTop: 8, fontSize: 13, color: "#8b949e", display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>
                Order: <strong style={{ color: "#c9d1d9", fontFamily: "monospace" }}>{dispute.orderId}</strong>
              </span>
              <span>·</span>
              <span>
                PayPal Order: <strong style={{ color: "#c9d1d9", fontFamily: "monospace" }}>{dispute.paypalOrderId}</strong>
              </span>
              <span>·</span>
              <span>
                Created: <strong style={{ color: "#c9d1d9" }}>{age.text}</strong>
              </span>
            </div>
          </div>

          {/* Amount & SLA Tiles */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={kpiLabelStyle}>Disputed Amount</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "#f0f6fc" }}>{formatMoney(dispute.amount)}</div>
            </div>

            <div
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                background: sla.isUrgent ? "rgba(239, 68, 68, 0.15)" : "#21262d",
                border: sla.isUrgent ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid #30363d",
                textAlign: "right",
              }}
            >
              <div style={{ ...kpiLabelStyle, color: sla.isUrgent ? "#f87171" : "#8b949e" }}>Response Deadline</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: sla.isUrgent ? "#f87171" : "#c9d1d9", marginTop: 2 }}>
                {sla.isUrgent && "⚠️ "}
                {sla.text}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Shopper Mandate Intent Text */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📜</span>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>Shopper Intent Mandate</h2>
          </div>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8b949e" }}>ID: {dispute.mandateId}</span>
        </div>

        <blockquote
          style={{
            margin: 0,
            padding: "14px 18px",
            background: "#0d1117",
            borderLeft: "4px solid #58a6ff",
            borderRadius: "0 6px 6px 0",
            fontSize: 15,
            lineHeight: 1.5,
            color: "#e6edf3",
            fontStyle: "italic",
          }}
        >
          &ldquo;{dispute.shopperIntentText}&rdquo;
        </blockquote>

        <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 12, color: "#8b949e", flexWrap: "wrap" }}>
          <span>
            Issuer: <span style={{ fontFamily: "monospace", color: "#c9d1d9" }}>{dispute.mandateIssuer}</span>
          </span>
          <span>
            Nonce: <span style={{ fontFamily: "monospace", color: "#c9d1d9" }}>{dispute.mandateNonce}</span>
          </span>
          <span>
            Expiry: <span style={{ fontFamily: "monospace", color: "#c9d1d9" }}>{dispute.mandateExpiry}</span>
          </span>
        </div>
      </div>

      {/* Mandate Diff Widget: Cart vs Mandate Side by Side */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚖️</span>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
                Mandate Diff · Cart vs Intent Constraints
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#8b949e" }}>
              Side-by-side evaluation of signed constraints versus merchant cart contents.
            </p>
          </div>

          {/* Violations Only Toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={() => setOnlyViolations((v) => !v)}
              style={{
                ...pillBtnStyle,
                background: onlyViolations ? "rgba(248, 81, 73, 0.2)" : "#21262d",
                color: onlyViolations ? "#f85149" : "#c9d1d9",
                borderColor: onlyViolations ? "rgba(248, 81, 73, 0.5)" : "#30363d",
              }}
            >
              {onlyViolations ? "Showing Violations Only" : "Show All Rules"} ({failingCount} violation{failingCount === 1 ? "" : "s"})
            </button>
          </div>
        </div>

        {/* Side-by-Side Summary Columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Left: Mandate Limits */}
          <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: 14 }}>
            <div style={{ ...kpiLabelStyle, color: "#58a6ff", marginBottom: 8 }}>Signed Intent Constraints (Left)</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: "#8b949e" }}>Budget Ceiling:</span>{" "}
                <strong style={{ color: "#f0f6fc" }}>{formatMoney(dispute.constraints.amountMax)}</strong>
              </div>
              {dispute.constraints.attributes.color && (
                <div>
                  <span style={{ color: "#8b949e" }}>Color Attribute:</span>{" "}
                  <strong style={{ color: "#f0f6fc" }}>{dispute.constraints.attributes.color}</strong>
                </div>
              )}
              {dispute.constraints.attributes.category && (
                <div>
                  <span style={{ color: "#8b949e" }}>Category:</span>{" "}
                  <strong style={{ color: "#f0f6fc" }}>{dispute.constraints.attributes.category}</strong>
                </div>
              )}
              <div>
                <span style={{ color: "#8b949e" }}>Allowed Merchant:</span>{" "}
                <strong style={{ color: "#f0f6fc" }}>{dispute.constraints.merchantAllowlist.join(", ")}</strong>
              </div>
            </div>
          </div>

          {/* Right: Cart Actuals */}
          <div
            style={{
              background: failingCount > 0 ? "rgba(248, 81, 73, 0.05)" : "#0d1117",
              border: failingCount > 0 ? "1px solid rgba(248, 81, 73, 0.4)" : "1px solid #30363d",
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ ...kpiLabelStyle, color: failingCount > 0 ? "#f87171" : "#34d399", marginBottom: 8 }}>
              Cart Mandate Contents (Right)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: "#8b949e" }}>Cart Total:</span>{" "}
                <strong style={{ color: failingCount > 0 && dispute.cartTotal.value > dispute.constraints.amountMax.value ? "#f85149" : "#f0f6fc" }}>
                  {formatMoney(dispute.cartTotal)}
                </strong>
              </div>
              {dispute.cartLines.map((line) => (
                <div key={line.sku}>
                  <span style={{ color: "#8b949e" }}>Item:</span>{" "}
                  <strong style={{ color: "#f0f6fc" }}>{line.title}</strong> ({line.sku})
                  {line.color && (
                    <span style={{ marginLeft: 8, color: line.color !== dispute.constraints.attributes.color ? "#f85149" : "#8b949e" }}>
                      [color: {line.color}]
                    </span>
                  )}
                </div>
              ))}
              <div>
                <span style={{ color: "#8b949e" }}>Merchant:</span>{" "}
                <strong style={{ color: "#f0f6fc" }}>{dispute.cartMerchantName}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Constraint Checks Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#1c2128", borderBottom: "1px solid #30363d", color: "#8b949e" }}>
              <th style={thStyle}>Rule Name</th>
              <th style={thStyle}>Mandate Rule</th>
              <th style={thStyle}>Cart Actual</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Reason Code</th>
              <th style={thStyle}>Explanation</th>
            </tr>
          </thead>
          <tbody>
            {displayedChecks.map((check) => {
              const isFail = check.status === "FAIL";
              return (
                <tr
                  key={check.id}
                  style={{
                    borderBottom: "1px solid #21262d",
                    background: isFail ? "rgba(248, 81, 73, 0.08)" : "transparent",
                  }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600, color: isFail ? "#f87171" : "#f0f6fc" }}>{check.name}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: "#c9d1d9" }}>{check.mandateRule}</td>
                  <td style={{ ...tdStyle, fontFamily: "monospace", color: isFail ? "#f85149" : "#c9d1d9" }}>{check.cartActual}</td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: isFail ? "rgba(248, 81, 73, 0.2)" : "rgba(16, 185, 129, 0.2)",
                        color: isFail ? "#f85149" : "#34d399",
                        border: isFail ? "1px solid rgba(248, 81, 73, 0.4)" : "1px solid rgba(16, 185, 129, 0.4)",
                      }}
                    >
                      {check.status === "FAIL" ? "❌ FAIL" : "✅ PASS"}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {check.reasonCode ? (
                      <span style={{ ...codeBadgeStyle, color: "#f85149", borderColor: "rgba(248, 81, 73, 0.4)" }}>
                        {check.reasonCode}
                      </span>
                    ) : (
                      <span style={{ color: "#484f58" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e", fontSize: 12 }}>{check.explanation}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Copilot Classification & Recommendation */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>🤖</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
            Dispute Copilot Recommendation & Classification
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {/* Classification */}
          <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: 14 }}>
            <div style={kpiLabelStyle}>Classification Class</div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...codeBadgeStyle, fontSize: 13, padding: "4px 8px" }}>
                {dispute.classificationInfo.disputeClass}
              </span>
              <span style={{ fontSize: 12, color: "#8b949e" }}>
                Confidence: {(dispute.classificationInfo.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 600, textTransform: "uppercase" }}>Key Findings</div>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 13, color: "#c9d1d9" }}>
                {dispute.classificationInfo.reasons.map((r, i) => (
                  <li key={i}>{r.text}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommendation */}
          <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: 14 }}>
            <div style={kpiLabelStyle}>Recommended Action</div>
            <div style={{ marginTop: 8 }}>
              <span style={decisionBadgeStyle(dispute.decision)}>
                ACTION: {dispute.classificationInfo.recommendedAction}
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 600, textTransform: "uppercase" }}>Evidence Plan</div>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 13, color: "#c9d1d9" }}>
                {dispute.classificationInfo.evidencePlan.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Evidence Preview / Concession Section */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📑</span>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
              Evidence Package & Operator Actions
            </h2>
          </div>
          {dispute.evidenceDraftInfo && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "#8b949e" }}>
              Hash: {dispute.evidenceDraftInfo.attestationHash.slice(0, 16)}...
            </span>
          )}
        </div>

        {dispute.evidenceDraftInfo ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Draft Content */}
              <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: 14 }}>
                <div style={{ ...kpiLabelStyle, marginBottom: 6 }}>Cover Note for PayPal Reviewer</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#c9d1d9" }}>
                  {dispute.evidenceDraftInfo.coverNote}
                </p>

                <div style={{ ...kpiLabelStyle, marginTop: 14, marginBottom: 8 }}>Attestation Sections</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {dispute.evidenceDraftInfo.attestationSections.map((sec, i) => (
                    <div key={i} style={{ fontSize: 12, borderLeft: "2px solid #30363d", paddingLeft: 8 }}>
                      <strong style={{ color: "#f0f6fc" }}>{sec.heading}</strong>
                      <div style={{ color: "#8b949e", marginTop: 2 }}>{sec.body}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* PDF Preview Trigger & Pointer */}
              <div style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ ...kpiLabelStyle, marginBottom: 8 }}>Deterministic Evidence PDF</div>
                  <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 12 }}>
                    Rendered from verifiable audit log. Submit is locked until previewed per operator spec.
                  </div>

                  <button
                    type="button"
                    onClick={() => setPdfOpened(true)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: pdfOpened ? "#1f6feb" : "#238636",
                      color: "#fff",
                      border: "none",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    📄 {pdfOpened ? "Re-open PDF Preview" : "Preview Evidence PDF"}
                  </button>

                  {pdfOpened && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#34d399", textAlign: "center" }}>
                      ✓ PDF preview verified
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 16, fontSize: 11, color: "#8b949e", borderTop: "1px solid #21262d", paddingTop: 8 }}>
                  <div>custom_id:</div>
                  <div style={{ fontFamily: "monospace", color: "#c9d1d9", wordBreak: "break-all" }}>
                    {dispute.evidenceDraftInfo.customId}
                  </div>
                </div>
              </div>
            </div>

            {/* Operator Submission Action */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", borderTop: "1px solid #30363d", paddingTop: 16 }}>
              {!pdfOpened && (
                <span style={{ fontSize: 12, color: "#8b949e" }}>
                  ⚠️ Open PDF preview above to unlock Submit Evidence
                </span>
              )}
              <button
                type="button"
                disabled={!pdfOpened || submitted}
                onClick={() => setSubmitted(true)}
                style={{
                  ...pillBtnStyle,
                  background: submitted ? "#21262d" : pdfOpened ? "#238636" : "#21262d",
                  color: submitted ? "#8b949e" : pdfOpened ? "#ffffff" : "#484f58",
                  borderColor: pdfOpened && !submitted ? "#2ea043" : "#30363d",
                  cursor: pdfOpened && !submitted ? "pointer" : "not-allowed",
                  fontSize: 13,
                  padding: "8px 18px",
                }}
              >
                {submitted ? "✓ Evidence Submitted to PayPal" : "Submit Evidence to PayPal"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fbbf24", marginBottom: 6 }}>
                Concession Recommended (Evidence Drafting Skipped)
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#c9d1d9", lineHeight: 1.5 }}>
                The autonomous buyer agent overreached mandate constraints (budget ceiling and/or item attributes).
                Submitting evidence would contradict the verified mandate. Accept the claim to promptly issue a refund
                of {formatMoney(dispute.amount)} to the buyer and charge the agent platform ({dispute.agentPlatform}).
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, borderTop: "1px solid #30363d", paddingTop: 16 }}>
              <button
                type="button"
                disabled={conceded}
                onClick={() => setConceded(true)}
                style={{
                  ...pillBtnStyle,
                  background: conceded ? "#21262d" : "#d97706",
                  color: conceded ? "#8b949e" : "#ffffff",
                  borderColor: conceded ? "#30363d" : "#f59e0b",
                  cursor: conceded ? "not-allowed" : "pointer",
                  fontSize: 13,
                  padding: "8px 18px",
                }}
              >
                {conceded ? "✓ Claim Conceded & Refund Issued" : `Accept Claim & Refund (${formatMoney(dispute.amount)})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PDF Modal Preview */}
      {pdfOpened && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>📄</span>
                <h3 style={{ margin: 0, fontSize: 16, color: "#f0f6fc" }}>
                  Evidence Attestation PDF Preview · {dispute.id}
                </h3>
              </div>
              <button type="button" onClick={() => setPdfOpened(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            <div
              style={{
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 20,
                maxHeight: "65vh",
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                color: "#c9d1d9",
                lineHeight: 1.6,
              }}
            >
              <div style={{ borderBottom: "1px solid #30363d", paddingBottom: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#58a6ff" }}>PROOF OF INTENT · DISPUTE EVIDENCE ATTESTATION</div>
                <div>Dispute ID: {dispute.id} · PayPal Order ID: {dispute.paypalOrderId}</div>
                <div>Generated: {dispute.evidenceDraftInfo?.generatedAt ?? dispute.createdAt}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "#8b949e" }}>[1] SHOPPER VERIFIABLE INTENT MANDATE</div>
                <div>Mandate ID: {dispute.mandateId}</div>
                <div>Description: &ldquo;{dispute.shopperIntentText}&rdquo;</div>
                <div>Budget Limit: {formatMoney(dispute.constraints.amountMax)}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "#8b949e" }}>[2] FULFILLED CART MANDATE</div>
                <div>Merchant: {dispute.cartMerchantName}</div>
                <div>Total Charged: {formatMoney(dispute.cartTotal)}</div>
                {dispute.cartLines.map((l) => (
                  <div key={l.sku}>
                    - {l.title} ({l.sku}) Qty: {l.quantity} Unit: {formatMoney(l.unitPrice)}
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "#8b949e" }}>[3] POLICY ENGINE EVALUATION</div>
                <div>Checkout Verdict: APPROVE (all hard and semantic rules satisfied)</div>
                <div>Dispute Classification: {dispute.disputeClass}</div>
                <div>Hash: {dispute.evidenceDraftInfo?.attestationHash}</div>
                <div>custom_id pointer: {dispute.evidenceDraftInfo?.customId}</div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 12, color: "#34d399" }}>
                ✓ Operator opened PDF preview (Submit evidence unlocked)
              </span>
              <button
                type="button"
                onClick={() => setPdfOpened(false)}
                style={{ ...pillBtnStyle, background: "#21262d", color: "#f0f6fc" }}
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Styling Constants matching dark theme
const cardStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  padding: 20,
};

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#8b949e",
};

const pillBtnStyle: React.CSSProperties = {
  padding: "5px 14px",
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid #30363d",
  background: "#21262d",
  color: "#c9d1d9",
  cursor: "pointer",
};

const thStyle: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 600,
  userSelect: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  verticalAlign: "middle",
};

const platformBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 8px",
  borderRadius: 4,
  fontSize: 12,
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
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 3,
  background: "#0d1117",
  border: "1px solid #30363d",
  color: "#c9d1d9",
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: "rgba(0, 0, 0, 0.75)",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  zIndex: 1000,
  padding: 16,
};

const modalContentStyle: React.CSSProperties = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 8,
  width: "100%",
  maxWidth: 720,
  padding: 24,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  color: "#8b949e",
  cursor: "pointer",
  padding: 4,
};
