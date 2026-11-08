"use client";

import { useEffect, useState } from "react";
import {
  actionLabel,
  actorLabel,
  fetchDisputeAudit,
  operatorRowsPrecedePayPal,
  type DisputeAuditEntry,
} from "../../../src/audit";
import { card, kpiLabel } from "../../../src/theme";

/**
 * The dispute's audit log, read from audit_log through the API on every load and after each action (#74), never from
 * the page's state. Seeded sample disputes have no log and say so.
 */
export function AuditPanel({
  disputeId,
  isDemoData,
  refreshKey,
}: {
  disputeId: string;
  isDemoData: boolean;
  /** Changes when the page did something that writes audit rows, so the panel reloads. */
  refreshKey: string;
}) {
  const [state, setState] = useState<{ entries: DisputeAuditEntry[] } | { unavailable: true } | null>(null);

  useEffect(() => {
    if (isDemoData) return;
    let cancelled = false;
    void fetchDisputeAudit(disputeId).then((r) => !cancelled && setState(r));
    return () => {
      cancelled = true;
    };
  }, [disputeId, isDemoData, refreshKey]);

  const entries = state && "entries" in state ? state.entries : [];
  return (
    <section style={{ ...card, marginTop: 20 }} aria-label="Audit log" data-testid="audit-panel">
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "var(--poi-heading)" }}>Audit log</h2>
      <p style={{ ...kpiLabel, fontWeight: 400, margin: "4px 0 12px" }}>
        Every webhook, operator click and PayPal call on this dispute, read from the merchant&apos;s audit
        log.
      </p>
      {isDemoData ? (
        <p style={{ margin: 0, fontSize: 13 }}>Seeded sample disputes have no audit log.</p>
      ) : state === null ? (
        <p style={{ margin: 0, fontSize: 13 }}>Loading the audit log…</p>
      ) : "unavailable" in state ? (
        <p style={{ margin: 0, fontSize: 13 }} role="alert">
          The audit log could not be loaded. Try again in a moment.
        </p>
      ) : entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13 }}>Nothing has been recorded for this dispute yet.</p>
      ) : (
        <>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
            {entries.map((e) => (
              <li
                key={e.id}
                data-testid="audit-row"
                style={{ borderLeft: "3px solid var(--poi-border)", paddingLeft: 12, fontSize: 13 }}
              >
                <div style={{ fontWeight: 600, color: "var(--poi-heading)" }}>{actionLabel(e)}</div>
                <div style={{ color: "var(--poi-text-muted)", fontSize: 12 }}>
                  {actorLabel(e.actor)} · {new Date(e.at).toLocaleString()} · #{e.id}
                  {e.recommended ? ` · copilot said ${e.recommended}` : ""}
                </div>
                {e.note && <div style={{ marginTop: 4 }}>&ldquo;{e.note}&rdquo;</div>}
                {e.detail && <div style={{ marginTop: 4, color: "var(--poi-text-muted)" }}>{e.detail}</div>}
              </li>
            ))}
          </ol>
          <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--poi-text-muted)" }}>
            {operatorRowsPrecedePayPal(entries)
              ? "Each operator click is recorded before the PayPal call it authorized."
              : "Warning: a PayPal call is recorded with no operator click before it."}
          </p>
        </>
      )}
    </section>
  );
}
