/** The dispute audit panel's data and wording (docs/specs/0007, #74). Pure, so the labels are unit tested. */

/** One row of GET /disputes/:id/audit: the API whitelists these fields, never the raw request body. */
export interface DisputeAuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  recommended?: string;
  override?: boolean;
  note?: string;
  detail?: string;
}

const ACTION_TEXT: Record<string, string> = {
  "operator.provide-evidence": "Operator submitted the evidence package",
  "operator.accept-claim": "Operator accepted the claim",
  "operator.escalate": "Operator escalated the dispute",
  "operator.send-message": "Operator sent the buyer a message",
  "paypal.provide-evidence": "PayPal accepted the evidence",
  "paypal.accept-claim": "PayPal recorded the refund",
  "paypal.escalate": "PayPal escalated the dispute",
  "paypal.send-message": "PayPal delivered the message",
  "webhook.received": "PayPal webhook received",
};

/** Who acted, in words: the dashboard's shared login is "operator", PayPal and the API are named for what they are. */
export function actorLabel(actor: string): string {
  if (actor.startsWith("operator:"))
    return actor.slice("operator:".length) === "dashboard" ? "operator" : actor.slice(9);
  if (actor === "paypal") return "PayPal";
  if (actor === "api") return "merchant API";
  return actor;
}

export function actionLabel(e: Pick<DisputeAuditEntry, "action" | "override">): string {
  const known = ACTION_TEXT[e.action];
  if (known) return e.override ? `${known} (overriding the recommendation to defend)` : known;
  const failed = /^paypal\.(.+)\.failed$/.exec(e.action);
  if (failed) return `PayPal did not complete: ${failed[1]!.replace(/-/g, " ")}`;
  return e.action;
}

/**
 * Whether each operator action is recorded before the PayPal call it authorized (invariant 4): every `paypal.<x>` row
 * must come after an `operator.<x>` row. Anything else in the trail (webhooks, failures) is not checked.
 */
export function operatorRowsPrecedePayPal(entries: DisputeAuditEntry[]): boolean {
  const operator = new Set<string>();
  for (const e of entries) {
    if (e.action.startsWith("operator.")) operator.add(e.action.slice("operator.".length));
    const done = /^paypal\.([a-z-]+)$/.exec(e.action);
    if (done && !operator.has(done[1]!)) return false;
  }
  return true;
}

/** The dispute's audit trail through the same-origin proxy. `unavailable` means the panel cannot say, not that it is empty. */
export async function fetchDisputeAudit(
  disputeId: string,
  options: { apiBaseUrl?: string; fetchFn?: typeof fetch } = {},
): Promise<{ entries: DisputeAuditEntry[] } | { unavailable: true }> {
  const runner = options.fetchFn ?? fetch;
  try {
    const res = await runner(
      `${options.apiBaseUrl ?? "/api"}/disputes/${encodeURIComponent(disputeId)}/audit`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store",
      },
    );
    if (!res.ok) return { unavailable: true };
    const data = (await res.json()) as { entries?: DisputeAuditEntry[] };
    return Array.isArray(data.entries) ? { entries: data.entries } : { unavailable: true };
  } catch {
    return { unavailable: true };
  }
}
