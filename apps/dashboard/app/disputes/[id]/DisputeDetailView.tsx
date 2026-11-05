"use client";

import { useMemo, useState } from "react";
import type { DisputeDetail } from "../../../src/dispute-types";
import { calculateAge, calculateSla, executeDisputeAction, formatMoney } from "../../../src/api";
import { card, kpiLabel, pillButton } from "../../../src/theme";
import { SampleDataNotice } from "../../SampleDataNotice";

export function DisputeDetailView({
  dispute,
  isDemoData: isDemoDataProp,
}: {
  dispute: DisputeDetail;
  isDemoData?: boolean;
}) {
  const isDemoData = isDemoDataProp ?? dispute.isDemoData ?? true;
  const [onlyViolations, setOnlyViolations] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [hasBeenPreviewed, setHasBeenPreviewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [conceding, setConceding] = useState(false);
  const [conceded, setConceded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Operator override (spec 0005): accept the claim even though the copilot recommends defending. Needs a note.
  const [overrideNote, setOverrideNote] = useState("");

  const handleSubmitEvidence = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await executeDisputeAction(dispute.id, "provide-evidence", {
        evidenceDraft: dispute.evidenceDraftInfo,
      });
      if (result.success) {
        setSubmitted(true);
      } else {
        setActionError(result.error ?? "Failed to submit evidence");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error executing evidence submission");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcceptClaim = async (note?: string) => {
    setConceding(true);
    setActionError(null);
    try {
      const result = await executeDisputeAction(dispute.id, "accept-claim", {
        amount: dispute.amount,
        ...(note ? { note } : {}),
      });
      if (result.success) {
        setConceded(true);
      } else {
        setActionError(result.error ?? "Failed to accept claim");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error executing claim acceptance");
    } finally {
      setConceding(false);
    }
  };

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
      {isDemoData && (
        <SampleDataNotice>
          This dispute comes from the built-in demo set. Live disputes appear here once the merchant API serves them.
        </SampleDataNotice>
      )}

      {/* Header Bar */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "var(--poi-heading)", fontFamily: "monospace" }}>
                {dispute.id}
              </h1>
              <span style={decisionBadgeStyle(dispute.decision)}>
                {dispute.decision.toUpperCase()}
              </span>
              <span style={statusBadgeStyle(dispute.status)}>{dispute.status.replace(/_/g, " ")}</span>
              <span style={platformBadgeStyle}>{dispute.agentPlatform}</span>
            </div>

            <div style={{ marginTop: 8, fontSize: 13, color: "var(--poi-text-muted)", display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span>
                Order: <strong style={{ color: "var(--poi-text)", fontFamily: "monospace" }}>{dispute.orderId}</strong>
              </span>
              <span>·</span>
              <span>
                PayPal Order: <strong style={{ color: "var(--poi-text)", fontFamily: "monospace" }}>{dispute.paypalOrderId}</strong>
              </span>
              <span>·</span>
              <span>
                Created: <strong style={{ color: "var(--poi-text)" }}>{age.text}</strong>
              </span>
            </div>
          </div>

          {/* Amount & SLA Tiles */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={kpiLabelStyle}>Disputed amount</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--poi-heading)" }}>{formatMoney(dispute.amount)}</div>
            </div>

            <div
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                background: sla.isUrgent ? "var(--poi-danger-bg)" : "var(--poi-surface-muted)",
                border: sla.isUrgent ? "1px solid var(--poi-danger-border)" : "1px solid var(--poi-border)",
                textAlign: "right",
              }}
            >
              <div style={{ ...kpiLabelStyle, color: sla.isUrgent ? "var(--poi-danger)" : "var(--poi-text-muted)" }}>Response deadline</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: sla.isUrgent ? "var(--poi-danger)" : "var(--poi-text)", marginTop: 2 }}>
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>Shopper intent mandate</h2>
          </div>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--poi-text-muted)" }}>
            {dispute.mandateId ? `ID: ${dispute.mandateId}` : "No mandate"}
          </span>
        </div>

        {dispute.shopperIntentText ? (
          <blockquote
            style={{
              margin: 0,
              padding: "14px 18px",
              background: "var(--poi-bg)",
              borderLeft: "4px solid var(--poi-blue)",
              borderRadius: "0 6px 6px 0",
              fontSize: 15,
              lineHeight: 1.5,
              color: "var(--poi-text)",
              fontStyle: "italic",
            }}
          >
            &ldquo;{dispute.shopperIntentText}&rdquo;
          </blockquote>
        ) : (
          <div
            style={{
              padding: "14px 18px",
              background: "var(--poi-bg)",
              borderRadius: 6,
              color: "var(--poi-text-muted)",
              fontStyle: "italic",
              fontSize: 14,
            }}
          >
            No verifiable shopper mandate recorded at checkout for this order.
          </div>
        )}

        {dispute.mandateId ? (
          <div style={{ display: "flex", gap: 20, marginTop: 12, fontSize: 12, color: "var(--poi-text-muted)", flexWrap: "wrap" }}>
            <span>
              Issuer: <span style={{ fontFamily: "monospace", color: "var(--poi-text)" }}>{dispute.mandateIssuer || "None"}</span>
            </span>
            <span>
              Nonce: <span style={{ fontFamily: "monospace", color: "var(--poi-text)" }}>{dispute.mandateNonce || "None"}</span>
            </span>
            <span>
              Expiry: <span style={{ fontFamily: "monospace", color: "var(--poi-text)" }}>{dispute.mandateExpiry || "None"}</span>
            </span>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--poi-text-muted)" }}>
            Order processed without customer-signed intent parameters. Standard seller defense evidence required.
          </div>
        )}
      </div>

      {/* Mandate Diff Widget: Cart vs Mandate Side by Side */}
      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>
                Mandate diff · cart vs. intent constraints
              </h2>
            </div>
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "var(--poi-text-muted)" }}>
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
                background: onlyViolations ? "var(--poi-danger-bg)" : "var(--poi-surface-muted)",
                color: onlyViolations ? "var(--poi-danger)" : "var(--poi-text)",
                borderColor: onlyViolations ? "var(--poi-danger-border)" : "var(--poi-border)",
              }}
            >
              {onlyViolations ? "Showing violations only" : "Show all rules"} ({failingCount} violation{failingCount === 1 ? "" : "s"})
            </button>
          </div>
        </div>

        {/* Side-by-Side Summary Columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Left: Mandate Limits */}
          <div style={{ background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 6, padding: 14 }}>
            <div style={{ ...kpiLabelStyle, color: "var(--poi-blue)", marginBottom: 8 }}>Signed intent constraints</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: "var(--poi-text-muted)" }}>Budget ceiling:</span>{" "}
                <strong style={{ color: "var(--poi-heading)" }}>{formatMoney(dispute.constraints.amountMax)}</strong>
              </div>
              {dispute.constraints.attributes.color && (
                <div>
                  <span style={{ color: "var(--poi-text-muted)" }}>Color attribute:</span>{" "}
                  <strong style={{ color: "var(--poi-heading)" }}>{dispute.constraints.attributes.color}</strong>
                </div>
              )}
              {dispute.constraints.attributes.category && (
                <div>
                  <span style={{ color: "var(--poi-text-muted)" }}>Category:</span>{" "}
                  <strong style={{ color: "var(--poi-heading)" }}>{dispute.constraints.attributes.category}</strong>
                </div>
              )}
              <div>
                <span style={{ color: "var(--poi-text-muted)" }}>Allowed merchant:</span>{" "}
                <strong style={{ color: "var(--poi-heading)" }}>{dispute.constraints.merchantAllowlist.join(", ")}</strong>
              </div>
            </div>
          </div>

          {/* Right: Cart Actuals */}
          <div
            style={{
              background: failingCount > 0 ? "var(--poi-danger-bg)" : "var(--poi-bg)",
              border: failingCount > 0 ? "1px solid var(--poi-danger-border)" : "1px solid var(--poi-border)",
              borderRadius: 6,
              padding: 14,
            }}
          >
            <div style={{ ...kpiLabelStyle, color: failingCount > 0 ? "var(--poi-danger)" : "var(--poi-success)", marginBottom: 8 }}>
              Cart mandate contents
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
              <div>
                <span style={{ color: "var(--poi-text-muted)" }}>Cart total:</span>{" "}
                <strong style={{ color: failingCount > 0 && dispute.cartTotal.value > dispute.constraints.amountMax.value ? "var(--poi-danger)" : "var(--poi-heading)" }}>
                  {formatMoney(dispute.cartTotal)}
                </strong>
              </div>
              {dispute.cartLines.map((line) => (
                <div key={line.sku}>
                  <span style={{ color: "var(--poi-text-muted)" }}>Item:</span>{" "}
                  <strong style={{ color: "var(--poi-heading)" }}>{line.title}</strong> ({line.sku})
                  {line.color && (
                    <span style={{ marginLeft: 8, color: line.color !== dispute.constraints.attributes.color ? "var(--poi-danger)" : "var(--poi-text-muted)" }}>
                      [color: {line.color}]
                    </span>
                  )}
                </div>
              ))}
              <div>
                <span style={{ color: "var(--poi-text-muted)" }}>Merchant:</span>{" "}
                <strong style={{ color: "var(--poi-heading)" }}>{dispute.cartMerchantName}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Constraint Checks Table */}
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--poi-surface-muted)", borderBottom: "1px solid var(--poi-border)", color: "var(--poi-text-muted)" }}>
              <th style={thStyle}>Rule</th>
              <th style={thStyle}>Mandate rule</th>
              <th style={thStyle}>Cart actual</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Reason code</th>
              <th style={thStyle}>Explanation</th>
            </tr>
          </thead>
          <tbody>
            {displayedChecks.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ ...tdStyle, textAlign: "center", color: "var(--poi-text-muted)", padding: 24 }}>
                  No automated mandate constraint checks available for this transaction.
                </td>
              </tr>
            ) : (
              displayedChecks.map((check) => {
                const isFail = check.status === "FAIL";
                return (
                  <tr
                    key={check.id}
                    style={{
                      borderBottom: "1px solid var(--poi-surface-muted)",
                      background: isFail ? "var(--poi-danger-bg)" : "transparent",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 600, color: isFail ? "var(--poi-danger)" : "var(--poi-heading)" }}>{check.name}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: "var(--poi-text)" }}>{check.mandateRule}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: isFail ? "var(--poi-danger)" : "var(--poi-text)" }}>{check.cartActual}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: isFail ? "var(--poi-danger-bg)" : "var(--poi-success-bg)",
                          color: isFail ? "var(--poi-danger)" : "var(--poi-success)",
                          border: isFail ? "1px solid var(--poi-danger-border)" : "1px solid var(--poi-success-border)",
                        }}
                      >
                        {check.status === "FAIL" ? "FAIL" : "PASS"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {check.reasonCode ? (
                        <span style={{ ...codeBadgeStyle, color: "var(--poi-danger)", borderColor: "var(--poi-danger-border)" }}>
                          {check.reasonCode}
                        </span>
                      ) : (
                        <span style={{ color: "var(--poi-text-subtle)" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--poi-text-muted)", fontSize: 12 }}>{check.explanation}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Copilot Classification & Recommendation */}
      <div style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>
            Copilot recommendation and classification
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          {/* Classification */}
          <div style={{ background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 6, padding: 14 }}>
            <div style={kpiLabelStyle}>Classification</div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ ...codeBadgeStyle, fontSize: 13, padding: "4px 8px" }}>
                {dispute.classificationInfo.disputeClass}
              </span>
              <span style={{ fontSize: 12, color: "var(--poi-text-muted)" }}>
                Confidence: {(dispute.classificationInfo.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "var(--poi-text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Key findings</div>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 13, color: "var(--poi-text)" }}>
                {dispute.classificationInfo.reasons.map((r, i) => (
                  <li key={i}>{r.text}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommendation */}
          <div style={{ background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 6, padding: 14 }}>
            <div style={kpiLabelStyle}>Recommended action</div>
            <div style={{ marginTop: 8 }}>
              <span style={decisionBadgeStyle(dispute.decision)}>
                ACTION: {dispute.classificationInfo.recommendedAction}
              </span>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: "var(--poi-text-muted)", fontWeight: 600, textTransform: "uppercase" }}>Evidence plan</div>
              <ul style={{ margin: "6px 0 0 0", paddingLeft: 18, fontSize: 13, color: "var(--poi-text)" }}>
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
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>
              Evidence package and operator actions
            </h2>
          </div>
          {dispute.evidenceDraftInfo && (
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--poi-text-muted)" }}>
              Hash: {dispute.evidenceDraftInfo.attestationHash.slice(0, 16)}...
            </span>
          )}
        </div>

        {dispute.evidenceDraftInfo ? (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
              {/* Draft Content */}
              <div style={{ background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 6, padding: 14 }}>
                <div style={{ ...kpiLabelStyle, marginBottom: 6 }}>Cover note for the PayPal reviewer</div>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--poi-text)" }}>
                  {dispute.evidenceDraftInfo.coverNote}
                </p>

                <div style={{ ...kpiLabelStyle, marginTop: 14, marginBottom: 8 }}>Attestation sections</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {dispute.evidenceDraftInfo.attestationSections.map((sec, i) => (
                    <div key={i} style={{ fontSize: 12, borderLeft: "2px solid var(--poi-border)", paddingLeft: 8 }}>
                      <strong style={{ color: "var(--poi-heading)" }}>{sec.heading}</strong>
                      <div style={{ color: "var(--poi-text-muted)", marginTop: 2 }}>{sec.body}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* PDF Preview Trigger & Pointer */}
              <div style={{ background: "var(--poi-bg)", border: "1px solid var(--poi-border)", borderRadius: 6, padding: 14, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div>
                  <div style={{ ...kpiLabelStyle, marginBottom: 8 }}>Deterministic evidence PDF</div>
                  <div style={{ fontSize: 12, color: "var(--poi-text-muted)", marginBottom: 12 }}>
                    Rendered from verifiable audit log. Submit is locked until previewed per operator spec.
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPdfModalOpen(true);
                      setHasBeenPreviewed(true);
                    }}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: hasBeenPreviewed ? "var(--poi-blue)" : "var(--poi-blue)",
                      color: "#fff",
                      border: "none",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    {hasBeenPreviewed ? "Re-open PDF Preview" : "Preview evidence PDF"}
                  </button>

                  {hasBeenPreviewed && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--poi-success)", textAlign: "center" }}>
                      ✓ PDF preview verified
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 16, fontSize: 11, color: "var(--poi-text-muted)", borderTop: "1px solid var(--poi-surface-muted)", paddingTop: 8 }}>
                  <div>custom_id:</div>
                  <div style={{ fontFamily: "monospace", color: "var(--poi-text)", wordBreak: "break-all" }}>
                    {dispute.evidenceDraftInfo.customId}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Error Alert */}
            {actionError && (
              <div
                data-testid="action-error"
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  background: "var(--poi-danger-bg)",
                  border: "1px solid var(--poi-danger-border)",
                  borderRadius: 6,
                  color: "var(--poi-danger)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  style={{ background: "none", border: "none", color: "var(--poi-danger)", cursor: "pointer", fontSize: 13 }}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Operator Submission Action */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, alignItems: "center", borderTop: "1px solid var(--poi-border)", paddingTop: 16 }}>
              {!hasBeenPreviewed && (
                <span style={{ fontSize: 12, color: "var(--poi-text-muted)" }}>
                  Open the PDF preview above to unlock Submit evidence
                </span>
              )}
              <button
                type="button"
                disabled={!hasBeenPreviewed || submitting || submitted}
                onClick={handleSubmitEvidence}
                style={{
                  ...pillBtnStyle,
                  background: submitted ? "var(--poi-surface-muted)" : hasBeenPreviewed && !submitting ? "var(--poi-blue)" : "var(--poi-surface-muted)",
                  color: submitted ? "var(--poi-text-muted)" : hasBeenPreviewed && !submitting ? "#ffffff" : "var(--poi-text-subtle)",
                  borderColor: hasBeenPreviewed && !submitted && !submitting ? "var(--poi-blue)" : "var(--poi-border)",
                  cursor: hasBeenPreviewed && !submitted && !submitting ? "pointer" : "not-allowed",
                  fontSize: 13,
                  padding: "8px 18px",
                }}
              >
                {submitted
                  ? "✓ Evidence submitted to PayPal"
                  : submitting
                    ? "Submitting to PayPal..."
                    : "Submit evidence to PayPal"}
              </button>
            </div>

            {/* Operator override: concede despite a defend recommendation, with the reason on record */}
            <details style={{ marginTop: 16, borderTop: "1px solid var(--poi-border)", paddingTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--poi-text-muted)" }}>
                Override: accept the claim instead
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                <label htmlFor="override-note" style={{ fontSize: 12, color: "var(--poi-text-muted)" }}>
                  Why you are refunding although the mandate verified (sent to PayPal and kept in the audit log)
                </label>
                <textarea
                  id="override-note"
                  value={overrideNote}
                  onChange={(e) => setOverrideNote(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  style={{ fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid var(--poi-border)" }}
                />
                <button
                  type="button"
                  disabled={overrideNote.trim().length < 10 || conceding || conceded || submitted}
                  onClick={() => handleAcceptClaim(overrideNote.trim())}
                  style={{
                    ...pillBtnStyle,
                    alignSelf: "flex-end",
                    fontSize: 13,
                    padding: "8px 18px",
                    cursor: overrideNote.trim().length < 10 || conceding || conceded || submitted ? "not-allowed" : "pointer",
                  }}
                >
                  {conceded
                    ? "✓ Claim accepted, refund issued"
                    : conceding
                      ? "Accepting claim..."
                      : `Accept claim & refund (${formatMoney(dispute.amount)})`}
                </button>
              </div>
            </details>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "var(--poi-warning-bg)",
                border: "1px solid var(--poi-warning-border)",
                borderRadius: 6,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--poi-warning)", marginBottom: 6 }}>
                Concession Recommended (Evidence Drafting Skipped)
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--poi-text)", lineHeight: 1.5 }}>
                The autonomous buyer agent overreached mandate constraints (budget ceiling and/or item attributes).
                Submitting evidence would contradict the verified mandate. Accept the claim to promptly issue a refund
                of {formatMoney(dispute.amount)} to the buyer and charge the agent platform ({dispute.agentPlatform}).
              </p>
            </div>

            {/* Action Error Alert */}
            {actionError && (
              <div
                data-testid="action-error"
                style={{
                  marginBottom: 12,
                  padding: "10px 14px",
                  background: "var(--poi-danger-bg)",
                  border: "1px solid var(--poi-danger-border)",
                  borderRadius: 6,
                  color: "var(--poi-danger)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span>{actionError}</span>
                <button
                  type="button"
                  onClick={() => setActionError(null)}
                  style={{ background: "none", border: "none", color: "var(--poi-danger)", cursor: "pointer", fontSize: 13 }}
                >
                  Dismiss
                </button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, borderTop: "1px solid var(--poi-border)", paddingTop: 16 }}>
              <button
                type="button"
                disabled={conceding || conceded}
                onClick={() => handleAcceptClaim()}
                style={{
                  ...pillBtnStyle,
                  background: conceded ? "var(--poi-surface-muted)" : conceding ? "var(--poi-surface-muted)" : "var(--poi-warning)",
                  color: conceded ? "var(--poi-text-muted)" : conceding ? "var(--poi-text-subtle)" : "#ffffff",
                  borderColor: conceded || conceding ? "var(--poi-border)" : "var(--poi-warning)",
                  cursor: conceded || conceding ? "not-allowed" : "pointer",
                  fontSize: 13,
                  padding: "8px 18px",
                }}
              >
                {conceded
                  ? "✓ Claim conceded and refund issued"
                  : conceding
                    ? "Issuing refund..."
                    : `Accept Claim & Refund (${formatMoney(dispute.amount)})`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PDF Modal Preview */}
      {pdfModalOpen && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: "var(--poi-heading)" }}>
                  Evidence Attestation PDF Preview · {dispute.id}
                </h3>
              </div>
              <button type="button" onClick={() => setPdfModalOpen(false)} style={closeBtnStyle}>
                ✕
              </button>
            </div>

            {!isDemoData ? (
              // Live dispute: the exact PDF that "Submit evidence" sends to PayPal.
              <iframe
                title={`Evidence PDF for ${dispute.id}`}
                src={`/api/disputes/${encodeURIComponent(dispute.id)}/evidence.pdf`}
                style={{ width: "100%", height: "65vh", border: "1px solid var(--poi-border)", borderRadius: 6 }}
              />
            ) : (
            <div
              style={{
                background: "var(--poi-bg)",
                border: "1px solid var(--poi-border)",
                borderRadius: 6,
                padding: 20,
                maxHeight: "65vh",
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                color: "var(--poi-text)",
                lineHeight: 1.6,
              }}
            >
              <div style={{ borderBottom: "1px solid var(--poi-border)", paddingBottom: 10, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--poi-blue)" }}>PROOF OF INTENT · DISPUTE EVIDENCE ATTESTATION</div>
                <div>Dispute ID: {dispute.id} · PayPal Order ID: {dispute.paypalOrderId}</div>
                <div>Generated: {dispute.evidenceDraftInfo?.generatedAt ?? dispute.createdAt}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "var(--poi-text-muted)" }}>[1] SHOPPER VERIFIABLE INTENT MANDATE</div>
                <div>Mandate ID: {dispute.mandateId}</div>
                <div>Description: &ldquo;{dispute.shopperIntentText}&rdquo;</div>
                <div>Budget Limit: {formatMoney(dispute.constraints.amountMax)}</div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "var(--poi-text-muted)" }}>[2] FULFILLED CART MANDATE</div>
                <div>Merchant: {dispute.cartMerchantName}</div>
                <div>Total Charged: {formatMoney(dispute.cartTotal)}</div>
                {dispute.cartLines.map((l) => (
                  <div key={l.sku}>
                    - {l.title} ({l.sku}) Qty: {l.quantity} Unit: {formatMoney(l.unitPrice)}
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ color: "var(--poi-text-muted)" }}>[3] POLICY ENGINE EVALUATION</div>
                <div>
                  Checkout Verdict: {dispute.checkoutVerdict ?? (dispute.decision === "defend" ? "APPROVE" : "REJECT")}
                </div>
                <div>Dispute Classification: {dispute.disputeClass}</div>
                <div>Hash: {dispute.evidenceDraftInfo?.attestationHash}</div>
                <div>custom_id pointer: {dispute.evidenceDraftInfo?.customId}</div>
              </div>
            </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <span style={{ fontSize: 12, color: "var(--poi-success)" }}>
                ✓ Operator opened PDF preview (Submit evidence unlocked)
              </span>
              <button
                type="button"
                onClick={() => setPdfModalOpen(false)}
                style={{ ...pillBtnStyle, background: "var(--poi-surface-muted)", color: "var(--poi-heading)" }}
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
  ...card,
  padding: 20,
};

const kpiLabelStyle: React.CSSProperties = {
  ...kpiLabel,
};

const pillBtnStyle: React.CSSProperties = {
  ...pillButton,
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
  fontFamily: "monospace",
  fontSize: 11,
  padding: "2px 6px",
  borderRadius: 3,
  background: "var(--poi-bg)",
  border: "1px solid var(--poi-border)",
  color: "var(--poi-text)",
};

const modalOverlayStyle: React.CSSProperties = {
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

const modalContentStyle: React.CSSProperties = {
  background: "var(--poi-surface)",
  border: "1px solid var(--poi-border)",
  borderRadius: 8,
  width: "100%",
  maxWidth: 720,
  padding: 24,
  boxShadow: "var(--poi-shadow-lg)",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: 16,
  color: "var(--poi-text-muted)",
  cursor: "pointer",
  padding: 4,
};
