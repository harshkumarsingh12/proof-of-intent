/**
 * The shopper's controls over a signed intent (docs/specs/0013, #176): what the browser signs to revoke it or to read what is
 * left of it, and how the merchant's receipt reads. Pure: no network, no keys.
 */
import type { IntentReceipt, IntentReceiptProof, IntentRevocation, Money } from "@poi/contracts";
import { usd } from "./intent";

/** Stops this exact intent: names it by id and by the hash of the bytes that were signed. */
export const intentRevocation = (mandateId: string, intentHash: string, now: Date): IntentRevocation => ({
  purpose: "intent.revoke",
  mandate_id: mandateId,
  intent_mandate_hash: intentHash,
  issued_at: now.toISOString(),
});

export const intentReceiptProof = (intentHash: string, now: Date): IntentReceiptProof => ({
  purpose: "intent.receipt",
  intent_mandate_hash: intentHash,
  issued_at: now.toISOString(),
});

const money = (m: Money) =>
  m.currency === "USD" ? usd(m.value) : `${(m.value / 100).toFixed(2)} ${m.currency}`;

const STATE_TEXT: Record<IntentReceipt["state"], string> = {
  ACTIVE: "Active: your agent can still buy within these limits",
  NOT_YET_VALID: "Not started yet",
  USED_UP: "Used up: nothing more can be bought under it",
  EXPIRED: "Expired: nothing more can be bought under it",
  REVOKED: "Revoked: nothing more can be bought under it",
};

/** The receipt as label and value rows, every figure the merchant's own. */
export function receiptRows(r: IntentReceipt): { label: string; value: string }[] {
  // Used up only by an order still waiting: if that order is released (declined, voided, expired), the authority comes back.
  const waiting = r.state === "USED_UP" && r.held.value > 0;
  const status = waiting
    ? "In use: an order is waiting to be paid; nothing more can be bought unless it is released"
    : STATE_TEXT[r.state];
  const rows = [{ label: "Status", value: status }];
  rows.push({ label: "Spent", value: money(r.spent) });
  if (r.held.value > 0)
    rows.push({ label: "Set aside", value: `${money(r.held)}, waiting to be paid or released` });
  if (r.remaining.per_purchase && r.remaining.per_purchase.value > 0)
    rows.push({ label: "Next purchase", value: `up to ${money(r.remaining.per_purchase)}` });
  if (r.remaining.total) rows.push({ label: "Budget left", value: money(r.remaining.total) });
  if (r.remaining.purchases !== null) {
    const n = r.remaining.purchases;
    rows.push({ label: "Purchases left", value: n === 0 ? "None" : n === 1 ? "One" : String(n) });
  }
  return rows;
}
