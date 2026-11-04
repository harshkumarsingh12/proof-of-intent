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

export interface KeyRecord {
  kid: string;
  publicJwk: Record<string, unknown>;
  retiredAt?: string;
  /** Shopper keys: who signed, and their vaulted wallet if they saved one. */
  shopperId?: string;
  vaultId?: string;
  /** Agent keys: the platform the key was registered to (KYA-lite). */
  platform?: string;
}

export interface MandateRecord {
  hash: string;
  kind: "intent" | "cart" | "payment";
  mandateId: string;
  canonical: string;
  jws: string;
  kid: string;
}

export interface VerdictRecord {
  intentMandateId: string;
  cartId: string;
  orderId?: string;
  outcome: "APPROVE" | "STEP_UP" | "REJECT";
  reasons: string[];
  semantic?: unknown;
}

export interface OrderRecord {
  id: string;
  intentMandateId: string;
  intentMandateHash: string;
  cartMandateHash: string;
  customId: string;
  paypalIntent: "AUTHORIZE" | "CAPTURE";
  status: string;
  totalValue: number;
  currency: string;
  shopperId?: string;
  agentPlatform: string;
  humanPresent: boolean;
}

export interface OrderPatch {
  status: string;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  capturedAt?: string;
}

/** An order as stored, with whatever PayPal ids it has collected so far. */
export type StoredOrder = OrderRecord & Partial<OrderPatch>;

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
  /** A registered public key, or null. Retired keys are returned with retiredAt; the caller applies the rule. */
  findKey(kind: "shopper" | "agent", kid: string): Promise<KeyRecord | null>;
  /** Stores a verified mandate. Same content (same hash) twice is a no-op. */
  saveMandate(m: MandateRecord): Promise<void>;
  /** Prior captures under an intent mandate, for budget_cap and recurrence. Integer minor units. */
  mandateLedger(intentMandateId: string): Promise<{ capturedTotal: number; capturedOrderTimes: string[] }>;
  recordVerdict(v: VerdictRecord): Promise<void>;
  createOrder(o: OrderRecord): Promise<void>;
  getOrder(id: string): Promise<StoredOrder | null>;
  getMandate(hash: string): Promise<MandateRecord | null>;
  updateOrder(id: string, patch: OrderPatch): Promise<void>;
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

    async findKey(kind, kid) {
      const sql =
        kind === "shopper"
          ? `select k.kid, k.public_jwk, k.retired_at, k.shopper_id, s.vault_id
               from shopper_keys k join shoppers s on s.id = k.shopper_id where k.kid = $1`
          : "select kid, public_jwk, retired_at, platform from agent_keys where kid = $1";
      const row = (await pool.query(sql, [kid])).rows[0];
      if (!row) return null;
      return {
        kid: row.kid,
        publicJwk: row.public_jwk,
        ...(row.retired_at ? { retiredAt: (row.retired_at as Date).toISOString() } : {}),
        ...(row.shopper_id ? { shopperId: row.shopper_id } : {}),
        ...(row.vault_id ? { vaultId: row.vault_id } : {}),
        ...(row.platform ? { platform: row.platform } : {}),
      };
    },

    async saveMandate(m) {
      await pool.query(
        `insert into mandates (hash, kind, mandate_id, canonical, jws, kid) values ($1, $2, $3, $4, $5, $6)
         on conflict (hash) do nothing`,
        [m.hash, m.kind, m.mandateId, m.canonical, m.jws, m.kid],
      );
    },

    async mandateLedger(intentMandateId) {
      const res = await pool.query<{ total_value: string; captured_at: Date }>(
        "select total_value, captured_at from orders where intent_mandate_id = $1 and captured_at is not null order by captured_at",
        [intentMandateId],
      );
      return {
        capturedTotal: res.rows.reduce((sum, r) => sum + Number(r.total_value), 0),
        capturedOrderTimes: res.rows.map((r) => r.captured_at.toISOString()),
      };
    },

    async recordVerdict(v) {
      await pool.query(
        "insert into verdicts (intent_mandate_id, cart_id, order_id, outcome, reasons, semantic) values ($1, $2, $3, $4, $5, $6)",
        [v.intentMandateId, v.cartId, v.orderId ?? null, v.outcome, v.reasons, json(v.semantic)],
      );
    },

    async createOrder(o) {
      await pool.query(
        `insert into orders (id, intent_mandate_id, intent_mandate_hash, cart_mandate_hash, custom_id, paypal_intent,
                             status, total_value, currency, shopper_id, agent_platform, human_present)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          o.id,
          o.intentMandateId,
          o.intentMandateHash,
          o.cartMandateHash,
          o.customId,
          o.paypalIntent,
          o.status,
          o.totalValue,
          o.currency,
          o.shopperId ?? null,
          o.agentPlatform,
          o.humanPresent,
        ],
      );
    },

    async getOrder(id) {
      const r = (await pool.query("select * from orders where id = $1", [id])).rows[0];
      if (!r) return null;
      return {
        id: r.id,
        intentMandateId: r.intent_mandate_id,
        intentMandateHash: r.intent_mandate_hash,
        cartMandateHash: r.cart_mandate_hash,
        customId: r.custom_id,
        paypalIntent: r.paypal_intent,
        status: r.status,
        totalValue: Number(r.total_value),
        currency: r.currency,
        agentPlatform: r.agent_platform,
        humanPresent: r.human_present,
        ...(r.shopper_id ? { shopperId: r.shopper_id } : {}),
        ...(r.paypal_order_id ? { paypalOrderId: r.paypal_order_id } : {}),
        ...(r.authorization_id ? { authorizationId: r.authorization_id } : {}),
        ...(r.capture_id ? { captureId: r.capture_id } : {}),
        ...(r.captured_at ? { capturedAt: (r.captured_at as Date).toISOString() } : {}),
      };
    },

    async getMandate(hash) {
      const r = (await pool.query("select * from mandates where hash = $1", [hash])).rows[0];
      return r
        ? {
            hash: r.hash,
            kind: r.kind,
            mandateId: r.mandate_id,
            canonical: r.canonical,
            jws: r.jws,
            kid: r.kid,
          }
        : null;
    },

    async updateOrder(id, p) {
      const res = await pool.query(
        `update orders set status = $2,
                paypal_order_id = coalesce($3, paypal_order_id), authorization_id = coalesce($4, authorization_id),
                capture_id = coalesce($5, capture_id), captured_at = coalesce($6, captured_at), updated_at = now()
          where id = $1`,
        [
          id,
          p.status,
          p.paypalOrderId ?? null,
          p.authorizationId ?? null,
          p.captureId ?? null,
          p.capturedAt ?? null,
        ],
      );
      if (res.rowCount !== 1) throw new Error(`order ${id} does not exist`);
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
