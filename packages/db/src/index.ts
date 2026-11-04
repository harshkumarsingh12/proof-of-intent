/**
 * Postgres schema, migrations and the append-only audit log.
 * Owner: @harshkumarsingh12. Spec: docs/specs/0003-checkout-and-verification.md (tables) and 0008 (ops).
 *
 * Tables live in ../migrations/*.sql. Unique indexes carry idempotency and replay protection;
 * the app never "checks then inserts".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export interface AuditEntry {
  actor: string;
  action: string;
  subjectId: string;
  priorState?: unknown;
  requestBody?: unknown;
}

/** An audit row as stored: the entry plus when it happened. */
export interface AuditRecord extends AuditEntry {
  id: number;
  at: string;
}

export interface WebhookEventRecord {
  eventId: string;
  eventType: string;
  resourceId?: string;
  payload: unknown;
}

export interface Db {
  /** Inserts the nonce; returns false if it was already used. */
  claimNonce(nonce: string): Promise<boolean>;
  appendAudit(entry: AuditEntry): Promise<void>;
  /** Every audit row for a subject, oldest first. The evidence timeline is built from these. */
  auditTrail(subjectId: string): Promise<AuditRecord[]>;
  /**
   * Stores a verified PayPal delivery. Returns false for a redelivery (same event id), which the
   * receiver acknowledges without doing anything twice. Rows with no processed_at are the worker's inbox.
   */
  recordWebhookEvent(event: WebhookEventRecord): Promise<boolean>;
  /** Applies pending migrations. Safe to call from several processes at once. */
  migrate(): Promise<string[]>;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations");
/** Any fixed 64-bit key; serializes concurrent migrate() calls (api and worker start together). */
const MIGRATION_LOCK = 7_007_001;

export function createDb(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });

  return {
    async claimNonce(nonce) {
      const res = await pool.query("insert into nonces (nonce) values ($1) on conflict (nonce) do nothing", [
        nonce,
      ]);
      return res.rowCount === 1;
    },

    async appendAudit(entry) {
      await pool.query(
        "insert into audit_log (actor, action, subject_id, prior_state, request_body) values ($1, $2, $3, $4, $5)",
        [entry.actor, entry.action, entry.subjectId, json(entry.priorState), json(entry.requestBody)],
      );
    },

    async recordWebhookEvent(e) {
      const res = await pool.query(
        "insert into webhook_events (event_id, event_type, resource_id, payload) values ($1, $2, $3, $4) on conflict (event_id) do nothing",
        [e.eventId, e.eventType, e.resourceId ?? null, json(e.payload)],
      );
      return res.rowCount === 1;
    },

    async auditTrail(subjectId) {
      const res = await pool.query<{
        id: string;
        at: Date;
        actor: string;
        action: string;
        subject_id: string;
        prior_state: unknown;
        request_body: unknown;
      }>("select * from audit_log where subject_id = $1 order by at, id", [subjectId]);
      return res.rows.map((r) => ({
        id: Number(r.id),
        at: r.at.toISOString(),
        actor: r.actor,
        action: r.action,
        subjectId: r.subject_id,
        ...(r.prior_state === null ? {} : { priorState: r.prior_state }),
        ...(r.request_body === null ? {} : { requestBody: r.request_body }),
      }));
    },

    async migrate() {
      const client = await pool.connect();
      try {
        await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
        await client.query(
          "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())",
        );
        const done = new Set(
          (await client.query<{ version: string }>("select version from schema_migrations")).rows.map(
            (r) => r.version,
          ),
        );
        const applied: string[] = [];
        for (const file of readdirSync(MIGRATIONS_DIR)
          .filter((f) => f.endsWith(".sql"))
          .sort()) {
          if (done.has(file)) continue;
          await client.query("begin");
          try {
            await client.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
            await client.query("insert into schema_migrations (version) values ($1)", [file]);
            await client.query("commit");
          } catch (err) {
            await client.query("rollback");
            throw new Error(`migration ${file} failed: ${(err as Error).message}`, { cause: err });
          }
          applied.push(file);
        }
        return applied;
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  };
}

/** undefined → SQL null; anything else → JSON text for a jsonb column (pg would send arrays as Postgres arrays). */
const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
