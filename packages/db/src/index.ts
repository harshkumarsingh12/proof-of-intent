/**
 * Postgres schema, migrations, seed and the append-only audit-log writer.
 * Owner: @harshkumarsingh12. Spec: docs/specs/0003-checkout-and-verification.md (tables) and 0008 (ops).
 *
 * Planned tables: shoppers, shopper_keys (retired_at), agent_keys, mandates (canonical bytes + jws),
 * nonces (UNIQUE), orders, verdicts, webhook_events (UNIQUE event_id), disputes, audit_log (append-only).
 * Unique indexes carry idempotency and replay protection; the app never "checks then inserts".
 */
import { NotImplementedError } from "@poi/contracts";

export interface AuditEntry {
  actor: string;
  action: string;
  subjectId: string;
  priorState?: unknown;
  requestBody?: unknown;
}

export interface Db {
  /** Inserts the nonce; returns false if it was already used. */
  claimNonce(nonce: string): Promise<boolean>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

export function createDb(_databaseUrl: string): Db {
  const todo = (what: string) => async (): Promise<never> => {
    throw new NotImplementedError(what, "harshkumarsingh12", "docs/specs/0003-checkout-and-verification.md");
  };
  return { claimNonce: todo("claimNonce"), appendAudit: todo("appendAudit") };
}
