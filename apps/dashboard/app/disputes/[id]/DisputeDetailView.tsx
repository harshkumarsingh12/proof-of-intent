"use client";

import { useMemo, useState } from "react";
import type { AuditLogEntry, DisputeDetail, DisputeStatus, OperatorActionType } from "../../../src/dispute-types";
import { calculateAge, calculateSla, formatMoney, isDisputeActionable, recordApprovalAction } from "../../../src/api";

interface ConfirmModalState {
  isOpen: boolean;
  action: OperatorActionType | null;
  operator: string;
  notes: string;
  overrideDecision: "defend" | "concede";
  error: string | null;
  isSubmitting: boolean;
}

export function DisputeDetailView({ dispute }: { dispute: DisputeDetail }) {
  const [currentStatus, setCurrentStatus] = useState<DisputeStatus>(dispute.status);
  const [currentDecision, setCurrentDecision] = useState<"defend" | "concede" | "standard">(dispute.decision);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>(dispute.auditLog ?? []);
  const [onlyViolations, setOnlyViolations] = useState(false);
  const [pdfOpened, setPdfOpened] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Modal confirmation state
  const [modal, setModal] = useState<ConfirmModalState>({
    isOpen: false,
    action: null,
    operator: "@hoursgotviral-dev",
    notes: "",
    overrideDecision: dispute.decision === "defend" ? "concede" : "defend",
    error: null,
    isSubmitting: false,
  });

  const isResolved = !isDisputeActionable({ status: currentStatus });

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

  const openConfirmation = (action: OperatorActionType) => {
    let defaultNotes = "";
    if (action === "SUBMIT_EVIDENCE") {
      defaultNotes = "Attestation PDF and signed mandate verified against order custom_id; submitting evidence package.";
    } else if (action === "ACCEPT_CLAIM") {
      defaultNotes = `Agent overreach confirmed; accepting dispute claim and issuing refund of ${formatMoney(dispute.amount)}.`;
    } else if (action === "REJECT_RECOMMENDATION") {
      defaultNotes = `Operator override: rejecting copilot ${currentDecision.toUpperCase()} recommendation.`;
    }

    setModal({
      isOpen: true,
      action,
      operator: "@hoursgotviral-dev",
      notes: defaultNotes,
      overrideDecision: currentDecision === "defend" ? "concede" : "defend",
      error: null,
      isSubmitting: false,
    });
  };

  const handleConfirmAction = async () => {
    if (!modal.action) return;
    if (!modal.operator.trim()) {
      setModal((prev) => ({ ...prev, error: "Operator identity is required for the audit log." }));
      return;
    }
    if (!modal.notes.trim()) {
      setModal((prev) => ({ ...prev, error: "Written rationale notes are required for the audit log." }));
      return;
    }

    setModal((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      const result = await recordApprovalAction({
        disputeId: dispute.id,
        action: modal.action,
        who: modal.operator,
        notes: modal.notes,
        overrideDecision: modal.action === "REJECT_RECOMMENDATION" ? modal.overrideDecision : undefined,
        metadata: {
          previousStatus: currentStatus,
          agentPlatform: dispute.agentPlatform,
          refundAmount: modal.action === "ACCEPT_CLAIM" ? dispute.amount : undefined,
        },
      });

      // Update local state
      setAuditLog((prev) => [result.auditEntry, ...prev]);
      setCurrentStatus(result.updatedStatus);
      if (result.updatedDecision) {
        setCurrentDecision(result.updatedDecision);
      }
      setActionSuccessMsg(`Action "${modal.action}" confirmed and recorded in audit log.`);
      setModal((prev) => ({ ...prev, isOpen: false }));
    } catch (err) {
      setModal((prev) => ({
        ...prev,
        isSubmitting: false,
        error: err instanceof Error ? err.message : "Failed to record approval action.",
      }));
    }
  };

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
              <span style={decisionBadgeStyle(currentDecision)}>
                {currentDecision === "defend" && "🛡️ "}
                {currentDecision === "concede" && "↩️ "}
                {currentDecision.toUpperCase()}
              </span>
              <span style={statusBadgeStyle(currentStatus)}>{currentStatus.replace(/_/g, " ")}</span>
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
                background: isResolved ? "#21262d" : sla.isUrgent ? "rgba(239, 68, 68, 0.15)" : "#21262d",
                border: isResolved ? "1px solid #30363d" : sla.isUrgent ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid #30363d",
                textAlign: "right",
              }}
            >
              <div style={{ ...kpiLabelStyle, color: isResolved ? "#8b949e" : sla.isUrgent ? "#f87171" : "#8b949e" }}>
                Status
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: isResolved ? "#34d399" : sla.isUrgent ? "#f87171" : "#c9d1d9", marginTop: 2 }}>
                {isResolved ? "✓ RESOLVED" : sla.isUrgent ? `⚠️ ${sla.text}` : sla.text}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Success Notification Banner */}
      {actionSuccessMsg && (
        <div style={successBannerStyle}>
          <span>✓ {actionSuccessMsg}</span>
          <button type="button" onClick={() => setActionSuccessMsg(null)} style={closeBtnStyle}>
            ✕
          </button>
        </div>
      )}

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
              <span style={decisionBadgeStyle(currentDecision)}>
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
              Evidence Package Preview
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
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "rgba(245, 158, 11, 0.08)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: 6,
                padding: 16,
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
          </div>
        )}
      </div>

      {/* Human Approval Controls (Spec 0005 & 0007) */}
      <div style={{ ...cardStyle, borderLeft: isResolved ? "4px solid #30363d" : "4px solid #58a6ff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🛡️</span>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
                Human Approval Controls
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#8b949e" }}>
              Every dispute action requires explicit human approval with confirmation and written audit logging. Actions are disabled once resolved.
            </p>
          </div>

          {isResolved && (
            <div
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                color: "#34d399",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              🔒 Dispute Resolved · Actions Locked
            </div>
          )}
        </div>

        {/* Action Controls Bar */}
        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            paddingTop: 12,
            borderTop: "1px solid #30363d",
          }}
        >
          {/* Action 1: Submit Evidence */}
          <button
            type="button"
            disabled={isResolved || (dispute.decision === "defend" && !pdfOpened)}
            onClick={() => openConfirmation("SUBMIT_EVIDENCE")}
            style={{
              ...actionBtnStyle,
              background: isResolved || (dispute.decision === "defend" && !pdfOpened) ? "#21262d" : "#238636",
              color: isResolved || (dispute.decision === "defend" && !pdfOpened) ? "#484f58" : "#ffffff",
              borderColor: isResolved || (dispute.decision === "defend" && !pdfOpened) ? "#30363d" : "#2ea043",
              cursor: isResolved || (dispute.decision === "defend" && !pdfOpened) ? "not-allowed" : "pointer",
            }}
            title={!pdfOpened && dispute.decision === "defend" ? "Preview PDF first to unlock evidence submission" : undefined}
          >
            🛡️ Approve & Submit Evidence
          </button>

          {/* Action 2: Accept Claim */}
          <button
            type="button"
            disabled={isResolved}
            onClick={() => openConfirmation("ACCEPT_CLAIM")}
            style={{
              ...actionBtnStyle,
              background: isResolved ? "#21262d" : "#d97706",
              color: isResolved ? "#484f58" : "#ffffff",
              borderColor: isResolved ? "#30363d" : "#f59e0b",
              cursor: isResolved ? "not-allowed" : "pointer",
            }}
          >
            ↩️ Accept Claim & Refund ({formatMoney(dispute.amount)})
          </button>

          {/* Action 3: Reject Recommendation */}
          <button
            type="button"
            disabled={isResolved}
            onClick={() => openConfirmation("REJECT_RECOMMENDATION")}
            style={{
              ...actionBtnStyle,
              background: isResolved ? "#21262d" : "#4c1d95",
              color: isResolved ? "#484f58" : "#e9d5ff",
              borderColor: isResolved ? "#30363d" : "#6d28d9",
              cursor: isResolved ? "not-allowed" : "pointer",
            }}
          >
            ⚠️ Reject Copilot Recommendation
          </button>

          {!pdfOpened && dispute.decision === "defend" && !isResolved && (
            <span style={{ fontSize: 12, color: "#8b949e", marginLeft: 4 }}>
              (Preview PDF above to unlock Submit Evidence)
            </span>
          )}
        </div>
      </div>

      {/* Written Append-Only Audit Trail */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📜</span>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#f0f6fc" }}>
              Audit Trail (Who, What, When)
            </h2>
          </div>
          <span style={{ fontSize: 12, color: "#8b949e" }}>
            {auditLog.length} recorded event{auditLog.length === 1 ? "" : "s"} · Append-only
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {auditLog.map((entry) => {
            const isHuman = entry.who.startsWith("@") || entry.who.startsWith("operator:");
            return (
              <div
                key={entry.id}
                style={{
                  background: isHuman ? "rgba(56, 139, 253, 0.05)" : "#0d1117",
                  border: isHuman ? "1px solid rgba(56, 139, 253, 0.3)" : "1px solid #30363d",
                  borderRadius: 6,
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: isHuman ? "#58a6ff" : "#8b949e" }}>
                      {isHuman ? "👤 " : "⚙️ "}
                      {entry.who}
                    </span>
                    <span style={auditActionPillStyle(entry.what)}>{entry.what}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#8b949e", fontFamily: "monospace" }}>
                    {entry.when}
                  </span>
                </div>

                <div style={{ fontSize: 13, color: "#c9d1d9", lineHeight: 1.4 }}>
                  {entry.notes}
                </div>

                {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", fontSize: 11 }}>
                    {entry.metadata.refundAmount && (
                      <span style={codeBadgeStyle}>
                        Refund: {formatMoney(entry.metadata.refundAmount)}
                      </span>
                    )}
                    {entry.metadata.newStatus && (
                      <span style={codeBadgeStyle}>
                        Status: {entry.metadata.previousStatus ?? "—"} → {entry.metadata.newStatus}
                      </span>
                    )}
                    {entry.metadata.attestationHash && (
                      <span style={codeBadgeStyle}>
                        Hash: {entry.metadata.attestationHash.slice(0, 16)}...
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Confirmation Step Dialog (Modal) */}
      {modal.isOpen && modal.action && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 20 }}>
                  {modal.action === "SUBMIT_EVIDENCE" && "🛡️"}
                  {modal.action === "ACCEPT_CLAIM" && "↩️"}
                  {modal.action === "REJECT_RECOMMENDATION" && "⚠️"}
                </span>
                <h3 style={{ margin: 0, fontSize: 17, color: "#f0f6fc" }}>
                  Confirm Human Action: {modal.action.replace(/_/g, " ")}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModal((prev) => ({ ...prev, isOpen: false }))}
                style={closeBtnStyle}
              >
                ✕
              </button>
            </div>

            {/* Action Consequences Explanation */}
            <div
              style={{
                background: "#0d1117",
                border: "1px solid #30363d",
                borderRadius: 6,
                padding: 12,
                fontSize: 13,
                color: "#c9d1d9",
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              {modal.action === "SUBMIT_EVIDENCE" && (
                <span>
                  You are approving the submission of the drafted evidence attestation package to PayPal. This dispute
                  will be marked <strong>RESOLVED</strong> in the merchant queue and further actions will be locked.
                </span>
              )}
              {modal.action === "ACCEPT_CLAIM" && (
                <span>
                  You are conceding this dispute and authorizing an immediate buyer refund of{" "}
                  <strong style={{ color: "#fbbf24" }}>{formatMoney(dispute.amount)}</strong>. Overreach will be
                  attributed to <strong>{dispute.agentPlatform}</strong> and the dispute will be marked{" "}
                  <strong>RESOLVED</strong>.
                </span>
              )}
              {modal.action === "REJECT_RECOMMENDATION" && (
                <span>
                  You are overriding the copilot&apos;s recommendation. Choose the target decision below and enter the
                  mandatory operator rationale for the append-only audit trail.
                </span>
              )}
            </div>

            {/* Form Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              {/* Operator Handle (Who) */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8b949e", marginBottom: 4 }}>
                  Operator Handle (Who):
                </label>
                <input
                  type="text"
                  value={modal.operator}
                  onChange={(e) => setModal((prev) => ({ ...prev, operator: e.target.value }))}
                  style={inputStyle}
                  placeholder="@operator-handle"
                />
              </div>

              {/* Override Decision Selector if Reject */}
              {modal.action === "REJECT_RECOMMENDATION" && (
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8b949e", marginBottom: 4 }}>
                    New Target Decision:
                  </label>
                  <select
                    value={modal.overrideDecision}
                    onChange={(e) =>
                      setModal((prev) => ({ ...prev, overrideDecision: e.target.value as "defend" | "concede" }))
                    }
                    style={selectStyle}
                  >
                    <option value="concede">Concede Claim (Refund Buyer)</option>
                    <option value="defend">Defend (Provide Evidence)</option>
                  </select>
                </div>
              )}

              {/* Written Notes / Rationale */}
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#8b949e", marginBottom: 4 }}>
                  Written Audit Rationale (What &amp; Why) *:
                </label>
                <textarea
                  value={modal.notes}
                  onChange={(e) => setModal((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  style={{ ...inputStyle, width: "100%", boxSizing: "border-box", fontFamily: "inherit" }}
                  placeholder="Provide written justification for this action for the audit log..."
                />
              </div>

              {/* Error Message */}
              {modal.error && (
                <div style={{ fontSize: 12, color: "#f85149", background: "rgba(248, 81, 73, 0.1)", padding: 8, borderRadius: 4 }}>
                  ⚠️ {modal.error}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => setModal((prev) => ({ ...prev, isOpen: false }))}
                style={pillBtnStyle}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={modal.isSubmitting}
                onClick={() => void handleConfirmAction()}
                style={{
                  ...pillBtnStyle,
                  background: modal.action === "SUBMIT_EVIDENCE" ? "#238636" : modal.action === "ACCEPT_CLAIM" ? "#d97706" : "#6d28d9",
                  color: "#ffffff",
                  borderColor: "transparent",
                  fontWeight: 600,
                }}
              >
                {modal.isSubmitting ? "Recording Action..." : "Confirm Action & Log"}
              </button>
            </div>
          </div>
        </div>
      )}

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

// Styling Constants
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

const actionBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 600,
  border: "1px solid #30363d",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const inputStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "8px 12px",
  fontSize: 13,
  color: "#c9d1d9",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 13,
  color: "#c9d1d9",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
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
  const isResolved = status === "RESOLVED";
  return {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: isResolved ? "rgba(16, 185, 129, 0.15)" : isActionRequired ? "rgba(248, 81, 73, 0.15)" : "#21262d",
    color: isResolved ? "#34d399" : isActionRequired ? "#f85149" : "#8b949e",
    border: isResolved ? "1px solid rgba(16, 185, 129, 0.4)" : isActionRequired ? "1px solid rgba(248, 81, 73, 0.3)" : "1px solid #30363d",
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

const auditActionPillStyle = (action: string): React.CSSProperties => {
  if (action === "SUBMIT_EVIDENCE") {
    return {
      padding: "2px 6px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      background: "rgba(16, 185, 129, 0.15)",
      color: "#34d399",
      border: "1px solid rgba(16, 185, 129, 0.4)",
    };
  }
  if (action === "ACCEPT_CLAIM") {
    return {
      padding: "2px 6px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      background: "rgba(245, 158, 11, 0.15)",
      color: "#fbbf24",
      border: "1px solid rgba(245, 158, 11, 0.4)",
    };
  }
  if (action === "REJECT_RECOMMENDATION") {
    return {
      padding: "2px 6px",
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600,
      background: "rgba(239, 68, 68, 0.15)",
      color: "#f87171",
      border: "1px solid rgba(239, 68, 68, 0.4)",
    };
  }
  return {
    padding: "2px 6px",
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 500,
    background: "#21262d",
    color: "#8b949e",
    border: "1px solid #30363d",
  };
};

const successBannerStyle: React.CSSProperties = {
  background: "rgba(16, 185, 129, 0.15)",
  border: "1px solid rgba(16, 185, 129, 0.4)",
  color: "#34d399",
  borderRadius: 6,
  padding: "10px 16px",
  fontSize: 13,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
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
  maxWidth: 620,
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
