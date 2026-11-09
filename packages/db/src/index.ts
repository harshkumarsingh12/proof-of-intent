/**
 * Postgres schema, migrations and the append-only audit log.
 * Owner: @harshkumarsingh12. Spec: docs/specs/0003-checkout-and-verification.md (tables) and 0008 (ops).
 *
 * Tables live in ../migrations/*.sql. Unique indexes carry idempotency and replay protection;
 * the app never "checks then inserts".
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { AiUsageReservation } from "@poi/contracts";

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
  /**
   * When this merchant first saw the mandate, by its own clock: set on the first save and never changed. This, not the
   * `created_at` or `timestamp` the signer wrote, is what a retired key is judged by (spec 0001, #162). Absent on a save
   * means "now" (the database's clock).
   */
  seenAt?: string;
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
  /** The cart's expiry. Until then a pending order holds its amount against the intent's budget and recurrence (#155). */
  reservedUntil?: string;
}

/** What an intent has already spent or set aside, for budget_cap and recurrence. Integer minor units. */
export interface SpendLedger {
  capturedTotal: number;
  capturedOrderTimes: string[];
}

export type Reservation = { ok: true } | { ok: false; reasons: string[] };

export interface OrderPatch {
  status: string;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  capturedAt?: string;
}

/** An order as stored, with whatever PayPal ids it has collected so far. */
export type StoredOrder = OrderRecord & Partial<OrderPatch> & { createdAt?: string };

export type StoredVerdict = VerdictRecord & { id: number; createdAt: string };

/** A verified webhook delivery the worker has claimed to handle. */
export interface PendingEvent {
  eventId: string;
  eventType: string;
  payload: unknown;
  /** How many times it has been claimed, this claim included: 1 on the first try. */
  attempts: number;
}

/** What happens to a claimed event that failed: tried again at `retryAt`, or quarantined and left alone. */
export type EventFailure = { error: string; retryAt: string } | { error: string; quarantine: true };

/** A PayPal dispute and what the copilot made of it (docs/specs/0005). */
export interface DisputeRow {
  id: string;
  orderId?: string;
  reason?: string;
  status?: string;
  amountValue?: number;
  currency?: string;
  sellerResponseDueDate?: string;
  /** PayPal's create_time; defaults to when we first saw it. */
  createdAt?: string;
  /** The PayPal dispute object as received. */
  paypal: unknown;
  /** PayPal's update_time for that object. */
  paypalUpdatedAt?: string;
  recommendation?: unknown;
  evidencePdf?: Uint8Array;
  evidenceBundle?: unknown;
}

/** Listing view: no PDF bytes, just whether there is one. */
export type DisputeSummary = Omit<DisputeRow, "evidencePdf"> & { hasEvidencePdf: boolean };

/** A step-up waiting for the shopper (docs/specs/0003, #35). No order exists until it is APPROVED. */
export interface StepUpRecord {
  id: string;
  /** sha256 hex of the link token. The token is only ever in the link itself. */
  tokenHash: string;
  intentMandateId: string;
  intentMandateHash: string;
  cartMandateHash: string;
  /** The proposed CartMandate, as JSON. */
  cart: unknown;
  shopperKid: string;
  agentPlatform: string;
  reasons: string[];
  expiresAt: string;
}

export type StepUpStatus = "PENDING" | "APPROVING" | "APPROVED" | "REJECTED" | "EXPIRED" | "FAILED";

export type StoredStepUp = StepUpRecord & {
  status: StepUpStatus;
  orderId?: string;
  createdAt: string;
  approvedAt?: string;
};

export interface Page {
  limit: number;
  offset: number;
}

export interface WebhookStats {
  received: number;
  lastReceivedAt: string | null;
  lastEventType: string | null;
  /** The worker's inbox (#164): dispute events not handled yet and not quarantined, and how long the oldest has waited. */
  pending: number;
  oldestPendingAt: string | null;
  /** Dispute events given up on after repeated failures. They stay in the table for an operator to look at. */
  quarantined: number;
}

export interface Db {
  /** A cheap `select 1`: resolves when Postgres answers, rejects when it can't be reached. Used by `/readyz`. */
  ping(): Promise<void>;
  /** Inserts the nonce; returns false if it was already used. */
  claimNonce(nonce: string): Promise<boolean>;
  /** Atomic physical AI-call reservation. UTC day comes from Postgres; lower caps persist through restarts. */
  reserveAiCall(
    merchantId: string,
    limit: number,
    feature?: { name: string; limit: number },
  ): Promise<AiUsageReservation>;
  appendAudit(entry: AuditEntry): Promise<void>;
  /** Every audit row for a subject, oldest first. The evidence timeline is built from these. */
  auditTrail(subjectId: string): Promise<AuditRecord[]>;
  /**
   * Stores a verified PayPal delivery. Returns false for a redelivery (same event id), which the
   * receiver acknowledges without doing anything twice. Rows with no processed_at are the worker's inbox.
   */
  recordWebhookEvent(event: WebhookEventRecord): Promise<boolean>;
  /** How many distinct deliveries we hold and when the last one arrived: a public sign that PayPal reaches us. */
  webhookStats(): Promise<WebhookStats>;
  /** A registered public key, or null. Retired keys are returned with retiredAt; the caller applies the rule. */
  findKey(kind: "shopper" | "agent", kid: string): Promise<KeyRecord | null>;
  /** Registers a shopper's public key under a new shopper. The same kid again returns its shopper (created false). */
  registerShopperKey(k: {
    kid: string;
    publicJwk: Record<string, unknown>;
  }): Promise<{ shopperId: string; created: boolean }>;
  /** Registers an agent platform's key. False when the kid already exists (the caller compares). */
  registerAgentKey(k: {
    kid: string;
    platform: string;
    owner: string;
    publicJwk: Record<string, unknown>;
  }): Promise<boolean>;
  /** Retires a key once (a later call keeps the first date). The effective retired_at, or null for an unknown key. */
  retireKey(kind: "shopper" | "agent", kid: string, at: string): Promise<string | null>;
  /** Vault v3: remembers which shopper a PayPal setup token was made for. */
  createVaultSetup(setupTokenId: string, shopperId: string): Promise<void>;
  /** Marks the setup token as being turned into a payment token. False if it isn't this shopper's or was already used. */
  claimVaultSetup(setupTokenId: string, shopperId: string): Promise<boolean>;
  /** Gives a claimed setup token back when PayPal failed before making the payment token, so the shopper can retry. */
  releaseVaultSetup(setupTokenId: string): Promise<void>;
  /** The shopper's saved PayPal wallet (Vault v3 payment token); replaces an earlier one. */
  saveVaultId(shopperId: string, vaultId: string): Promise<void>;
  /** How many shoppers hold this payment token. The same PayPal wallet can be saved by several browser keys. */
  countVaultHolders(vaultId: string): Promise<number>;
  /** Forgets the shopper's saved wallet, so agent-alone checkout answers no_vaulted_wallet again. */
  clearVaultId(shopperId: string): Promise<void>;
  /** Stores a verified mandate. Same content (same hash) twice is a no-op. */
  saveMandate(m: MandateRecord): Promise<void>;
  /**
   * Prior captures under an intent mandate, for budget_cap and recurrence. Integer minor units.
   * With asOfOrderId: only captures that existed when that order was created, which is what its checkout saw.
   */
  mandateLedger(intentMandateId: string, asOfOrderId?: string): Promise<SpendLedger>;
  /**
   * What the intent has spent or set aside as of `now` (#155): captured orders, orders whose PayPal result is unknown, and
   * pending orders whose reservation (the cart's expiry) has not passed. Voided and failed orders do not count. With
   * `excludeOrderId`, that order is left out, so an order's own reservation is not counted against itself.
   */
  activeLedger(intentMandateId: string, now: string, excludeOrderId?: string): Promise<SpendLedger>;
  /**
   * Creates the order and reserves its amount in one step. Concurrent reservations under the same intent are serialized, and
   * `check` sees the ledger as it is inside that step, so two pending orders cannot both fit under a cap that only one
   * fits. `check` returns the reasons to refuse (none to accept); a refusal creates nothing.
   */
  reserveOrder(o: OrderRecord, now: string, check: (ledger: SpendLedger) => string[]): Promise<Reservation>;
  recordVerdict(v: VerdictRecord): Promise<void>;
  createOrder(o: OrderRecord): Promise<void>;
  getOrder(id: string): Promise<StoredOrder | null>;
  getMandate(hash: string): Promise<MandateRecord | null>;
  updateOrder(id: string, patch: OrderPatch): Promise<void>;
  /**
   * Unattended (CAPTURE) orders under an intent whose PayPal result we never learned (status UNKNOWN_OUTCOME),
   * oldest first. PayPal may have charged; nothing else is attempted under the intent until this list is empty (#159).
   */
  unknownOutcomeOrders(intentMandateId: string): Promise<StoredOrder[]>;
  /** The checkout verdict that created an order. */
  orderVerdict(orderId: string): Promise<VerdictRecord | null>;
  /** Newest first, for the dashboard grids. */
  listOrders(page: Page): Promise<StoredOrder[]>;
  listVerdicts(page: Page): Promise<StoredVerdict[]>;
  createStepUp(s: StepUpRecord): Promise<void>;
  findStepUp(tokenHash: string): Promise<StoredStepUp | null>;
  findStepUpById(id: string): Promise<StoredStepUp | null>;
  /** A shopper key's step-ups still waiting for them (PENDING, unexpired at `now`), newest first. */
  listPendingStepUps(shopperKid: string, now: string): Promise<StoredStepUp[]>;
  /**
   * PENDING → APPROVING, only while the link is unexpired at `now`. False when another approval holds it, it
   * already finished, or it expired: exactly one request can go on to create the order.
   */
  claimStepUp(id: string, now: string): Promise<boolean>;
  /** Sets the outcome. Back to PENDING releases a claim that charged nothing (no vaulted wallet yet). */
  finishStepUp(
    id: string,
    patch: { status: StepUpStatus; orderId?: string; approvedAt?: string },
  ): Promise<void>;
  /** Dispute deliveries the worker hasn't handled yet, oldest first. */
  /**
   * Claims up to `limit` dispute events that are due at `now`, oldest first: each is leased for `leaseMs` (so another worker
   * skips it, and a worker that dies lets it go again after the lease) and has its attempt counted. Safe to call from
   * several workers at once: no event is handed to two of them. Quarantined events are never returned.
   */
  claimDisputeEvents(limit: number, now: string, leaseMs: number): Promise<PendingEvent[]>;
  markEventProcessed(eventId: string): Promise<void>;
  /** Records a failure of a claimed event: release it for a later attempt, or quarantine it. */
  failDisputeEvent(eventId: string, failure: EventFailure, now: string): Promise<void>;
  /** Insert or replace. Returns false when we already hold a newer PayPal version (out-of-order delivery). */
  saveDispute(d: DisputeRow): Promise<boolean>;
  getDispute(id: string): Promise<DisputeRow | null>;
  /** Response deadline first: disputes close to seller_response_due_date sort to the top (spec 0005). */
  listDisputes(page: Page): Promise<DisputeSummary[]>;
  /** Applies pending migrations. Safe to call from several processes at once. */
  migrate(): Promise<string[]>;
  close(): Promise<void>;
}

const MIGRATIONS_DIR = join(import.meta.dirname, "../migrations");
/** Any fixed 64-bit key; serializes concurrent migrate() calls (api and worker start together). */
const MIGRATION_LOCK = 7_007_001;

export function createDb(
  databaseUrl: string,
  options: { maxConnections?: number; allowExitOnIdle?: boolean } = {},
): Db {
  const max = options.maxConnections ?? 10;
  if (!Number.isSafeInteger(max) || max < 1)
    throw new TypeError("Database pool size must be a positive integer");
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    allowExitOnIdle: options.allowExitOnIdle ?? false,
  });
  // An idle connection can die under us (Postgres restart, failover, an admin terminating it). pg reports that
  // as an 'error' event on the pool, and with no listener Node treats it as uncaught and kills the process.
  // The pool already discards the dead client and opens a new one on the next query, so logging is enough.
  pool.on("error", (err) =>
    console.error(`postgres: idle connection lost (${err.message}); the pool will reconnect`),
  );

  return {
    async ping() {
      await pool.query("select 1");
    },

    async claimNonce(nonce) {
      const res = await pool.query("insert into nonces (nonce) values ($1) on conflict (nonce) do nothing", [
        nonce,
      ]);
      return res.rowCount === 1;
    },

    async reserveAiCall(merchantId, limit, feature) {
      if (!merchantId.trim() || merchantId.length > 128)
        throw new TypeError("AI usage requires a non-empty merchant id of at most 128 characters");
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw new TypeError("AI daily call limit must be a nonnegative safe integer");
      if (
        feature &&
        (!/^[a-z][a-z0-9._-]{0,63}$/.test(feature.name) ||
          !Number.isSafeInteger(feature.limit) ||
          feature.limit < 0)
      )
        throw new TypeError(
          "AI feature allowance requires a bounded name and nonnegative safe integer limit",
        );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL statement_timeout = '2000ms'");
        // The upsert locks this merchant/day until commit, including when a lower limit denies the call.
        const {
          rows: [row],
        } = await client.query<{ utc_day: string }>(
          `INSERT INTO ai_daily_usage (merchant_id, utc_day, daily_limit)
           VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, $2)
           ON CONFLICT (merchant_id, utc_day) DO UPDATE
             SET daily_limit = LEAST(ai_daily_usage.daily_limit, EXCLUDED.daily_limit), updated_at = now()
           RETURNING utc_day::text`,
          [merchantId, limit],
        );
        if (feature)
          await client.query(
            `INSERT INTO ai_feature_usage (merchant_id, utc_day, feature, daily_limit)
           VALUES ($1, $2::date, $3, $4)
           ON CONFLICT (merchant_id, utc_day, feature) DO UPDATE
             SET daily_limit = LEAST(ai_feature_usage.daily_limit, EXCLUDED.daily_limit), updated_at = now()`,
            [merchantId, row!.utc_day, feature.name, feature.limit],
          );
        const taken = await client.query<{ used: string; daily_limit: string }>(
          `UPDATE ai_daily_usage SET used = used + 1, updated_at = now()
           WHERE merchant_id = $1 AND utc_day = $2::date AND used < daily_limit
           RETURNING used, daily_limit`,
          [merchantId, row!.utc_day],
        );
        let allowed = taken.rowCount === 1;
        if (allowed && feature) {
          const featureTaken = await client.query(
            `UPDATE ai_feature_usage SET used = used + 1, updated_at = now()
             WHERE merchant_id = $1 AND utc_day = $2::date AND feature = $3 AND used < daily_limit`,
            [merchantId, row!.utc_day, feature.name],
          );
          if (featureTaken.rowCount !== 1) {
            // The merchant/day lock keeps the provisional increment invisible until this transaction commits.
            await client.query(
              "UPDATE ai_daily_usage SET used = used - 1 WHERE merchant_id = $1 AND utc_day = $2::date",
              [merchantId, row!.utc_day],
            );
            taken.rows.length = 0;
            allowed = false;
          }
        }
        const counter =
          taken.rows[0] ??
          (
            await client.query<{ used: string; daily_limit: string }>(
              "SELECT used, daily_limit FROM ai_daily_usage WHERE merchant_id = $1 AND utc_day = $2::date",
              [merchantId, row!.utc_day],
            )
          ).rows[0]!;
        await client.query(
          "DELETE FROM ai_daily_usage WHERE utc_day < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 7",
        );
        await client.query("COMMIT");
        return { allowed, used: Number(counter.used), limit: Number(counter.daily_limit) };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
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

    async webhookStats() {
      const { rows } = await pool.query(
        `select (select count(*)::int from webhook_events) as received,
                last.received_at, last.event_type,
                inbox.pending, inbox.oldest, inbox.quarantined
           from (select 1) one
           left join lateral (select received_at, event_type from webhook_events order by received_at desc limit 1) last on true
           cross join lateral (
             select count(*) filter (where processed_at is null and quarantined_at is null)::int as pending,
                    min(received_at) filter (where processed_at is null and quarantined_at is null) as oldest,
                    count(*) filter (where quarantined_at is not null)::int as quarantined
               from webhook_events where event_type like 'CUSTOMER.DISPUTE.%') inbox`,
      );
      const r = rows[0] as {
        received: number;
        received_at: Date | null;
        event_type: string | null;
        pending: number;
        oldest: Date | null;
        quarantined: number;
      };
      return {
        received: r.received,
        lastReceivedAt: r.received_at ? r.received_at.toISOString() : null,
        lastEventType: r.event_type,
        pending: r.pending,
        oldestPendingAt: r.oldest ? r.oldest.toISOString() : null,
        quarantined: r.quarantined,
      };
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

    async registerShopperKey({ kid, publicJwk }) {
      const existing = await pool.query<{ shopper_id: string }>(
        "select shopper_id from shopper_keys where kid = $1",
        [kid],
      );
      if (existing.rows[0]) return { shopperId: existing.rows[0].shopper_id, created: false };
      const shopperId = `shopper_${randomUUID()}`;
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("insert into shoppers (id) values ($1)", [shopperId]);
        const res = await client.query(
          "insert into shopper_keys (kid, shopper_id, public_jwk) values ($1, $2, $3) on conflict (kid) do nothing",
          [kid, shopperId, json(publicJwk)],
        );
        if (res.rowCount === 1) {
          await client.query("commit");
          return { shopperId, created: true };
        }
        await client.query("rollback"); // registered concurrently: answer with the winner
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const winner = await pool.query<{ shopper_id: string }>(
        "select shopper_id from shopper_keys where kid = $1",
        [kid],
      );
      return { shopperId: winner.rows[0]!.shopper_id, created: false };
    },

    async registerAgentKey({ kid, platform, owner, publicJwk }) {
      const res = await pool.query(
        "insert into agent_keys (kid, platform, owner, public_jwk) values ($1, $2, $3, $4) on conflict (kid) do nothing",
        [kid, platform, owner, json(publicJwk)],
      );
      return res.rowCount === 1;
    },

    async createVaultSetup(setupTokenId, shopperId) {
      await pool.query("insert into vault_setups (setup_token_id, shopper_id) values ($1, $2)", [
        setupTokenId,
        shopperId,
      ]);
    },

    async claimVaultSetup(setupTokenId, shopperId) {
      const res = await pool.query(
        `update vault_setups set claimed_at = now()
          where setup_token_id = $1 and shopper_id = $2 and claimed_at is null`,
        [setupTokenId, shopperId],
      );
      return res.rowCount === 1;
    },

    async releaseVaultSetup(setupTokenId) {
      await pool.query("update vault_setups set claimed_at = null where setup_token_id = $1", [setupTokenId]);
    },

    async saveVaultId(shopperId, vaultId) {
      await pool.query("update shoppers set vault_id = $2 where id = $1", [shopperId, vaultId]);
    },

    async countVaultHolders(vaultId) {
      const res = await pool.query<{ n: number }>(
        "select count(*)::int as n from shoppers where vault_id = $1",
        [vaultId],
      );
      return res.rows[0]!.n;
    },

    async clearVaultId(shopperId) {
      await pool.query("update shoppers set vault_id = null where id = $1", [shopperId]);
    },

    async retireKey(kind, kid, at) {
      const table = kind === "shopper" ? "shopper_keys" : "agent_keys";
      const res = await pool.query<{ retired_at: Date }>(
        `update ${table} set retired_at = coalesce(retired_at, $2) where kid = $1 returning retired_at`,
        [kid, at],
      );
      return res.rows[0] ? res.rows[0].retired_at.toISOString() : null;
    },

    async saveMandate(m) {
      await pool.query(
        `insert into mandates (hash, kind, mandate_id, canonical, jws, kid, created_at)
         values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()))
         on conflict (hash) do nothing`,
        [m.hash, m.kind, m.mandateId, m.canonical, m.jws, m.kid, m.seenAt ?? null],
      );
    },

    async mandateLedger(intentMandateId, asOfOrderId) {
      const res = await pool.query<{ total_value: string; captured_at: Date }>(
        `select total_value, captured_at from orders
          where intent_mandate_id = $1 and captured_at is not null
            and ($2::text is null or (id <> $2 and captured_at < (select created_at from orders where id = $2)))
          order by captured_at`,
        [intentMandateId, asOfOrderId ?? null],
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
      await insertOrder(pool, o);
    },

    async activeLedger(intentMandateId, now, excludeOrderId) {
      return activeLedgerOf(pool, intentMandateId, now, excludeOrderId);
    },

    async reserveOrder(o, now, check) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // One reservation at a time per intent: the lock is released at commit or rollback.
        await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [o.intentMandateId]);
        const reasons = check(await activeLedgerOf(client, o.intentMandateId, now));
        if (reasons.length > 0) {
          await client.query("rollback");
          return { ok: false, reasons };
        }
        await insertOrder(client, o);
        await client.query("commit");
        return { ok: true };
      } catch (err) {
        await client.query("rollback").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async getOrder(id) {
      const r = (await pool.query("select * from orders where id = $1", [id])).rows[0];
      return r ? toOrder(r) : null;
    },

    async createStepUp(st) {
      await pool.query(
        `insert into stepups (id, token_hash, intent_mandate_id, intent_mandate_hash, cart_mandate_hash, cart,
                              shopper_kid, agent_platform, reasons, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          st.id,
          st.tokenHash,
          st.intentMandateId,
          st.intentMandateHash,
          st.cartMandateHash,
          json(st.cart),
          st.shopperKid,
          st.agentPlatform,
          st.reasons,
          st.expiresAt,
        ],
      );
    },

    async findStepUp(tokenHash) {
      const r = (await pool.query("select * from stepups where token_hash = $1", [tokenHash])).rows[0];
      return r ? toStepUp(r) : null;
    },

    async findStepUpById(id) {
      const r = (await pool.query("select * from stepups where id = $1", [id])).rows[0];
      return r ? toStepUp(r) : null;
    },

    async listPendingStepUps(shopperKid, now) {
      const { rows } = await pool.query(
        `select * from stepups where shopper_kid = $1 and status = 'PENDING' and expires_at > $2
          order by created_at desc limit 20`,
        [shopperKid, now],
      );
      return rows.map(toStepUp);
    },

    async claimStepUp(id, now) {
      const res = await pool.query(
        "update stepups set status = 'APPROVING' where id = $1 and status = 'PENDING' and expires_at > $2",
        [id, now],
      );
      return res.rowCount === 1;
    },

    async finishStepUp(id, { status, orderId, approvedAt }) {
      await pool.query(
        `update stepups set status = $2, order_id = coalesce($3, order_id), approved_at = coalesce($4, approved_at)
         where id = $1`,
        [id, status, orderId ?? null, approvedAt ?? null],
      );
    },

    async listOrders({ limit, offset }) {
      const res = await pool.query("select * from orders order by created_at desc, id limit $1 offset $2", [
        limit,
        offset,
      ]);
      return res.rows.map(toOrder);
    },

    async orderVerdict(orderId) {
      const r = (
        await pool.query("select * from verdicts where order_id = $1 order by id desc limit 1", [orderId])
      ).rows[0];
      if (!r) return null;
      const { id: _id, createdAt: _at, ...verdict } = toVerdict(r);
      return verdict;
    },

    async listVerdicts({ limit, offset }) {
      const res = await pool.query("select * from verdicts order by id desc limit $1 offset $2", [
        limit,
        offset,
      ]);
      return res.rows.map(toVerdict);
    },

    async claimDisputeEvents(limit, now, leaseMs) {
      // FOR UPDATE SKIP LOCKED: two workers claiming at once take different rows.
      const res = await pool.query<{
        event_id: string;
        event_type: string;
        payload: unknown;
        attempts: number;
      }>(
        `with due as (
           select event_id from webhook_events
            where processed_at is null and quarantined_at is null and event_type like 'CUSTOMER.DISPUTE.%'
              and (next_attempt_at is null or next_attempt_at <= $2) and (claimed_until is null or claimed_until <= $2)
            order by coalesce(next_attempt_at, received_at), received_at, event_id
            limit $1
            for update skip locked)
         update webhook_events e
            set attempts = e.attempts + 1, claimed_until = $2::timestamptz + ($3 || ' milliseconds')::interval
           from due
          where e.event_id = due.event_id
        returning e.event_id, e.event_type, e.payload, e.attempts`,
        [limit, now, String(leaseMs)],
      );
      return res.rows
        .map((r) => ({
          eventId: r.event_id,
          eventType: r.event_type,
          payload: r.payload,
          attempts: r.attempts,
        }))
        .sort((x, y) => (x.eventId < y.eventId ? -1 : 1));
    },

    async markEventProcessed(eventId) {
      await pool.query(
        "update webhook_events set processed_at = now(), claimed_until = null, last_error = null where event_id = $1",
        [eventId],
      );
    },

    async failDisputeEvent(eventId, failure, now) {
      const error = failure.error.slice(0, 500);
      if ("quarantine" in failure) {
        await pool.query(
          "update webhook_events set quarantined_at = $2, claimed_until = null, last_error = $3 where event_id = $1",
          [eventId, now, error],
        );
      } else {
        await pool.query(
          "update webhook_events set next_attempt_at = $2, claimed_until = null, last_error = $3 where event_id = $1",
          [eventId, failure.retryAt, error],
        );
      }
    },

    async saveDispute(d) {
      const res = await pool.query(
        `insert into disputes (id, order_id, reason, status, amount_value, currency, seller_response_due_date,
                               paypal, paypal_updated_at, recommendation, evidence_pdf, evidence_bundle, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, coalesce($13, now()))
         on conflict (id) do update set
           order_id = excluded.order_id, reason = excluded.reason, status = excluded.status,
           amount_value = excluded.amount_value, currency = excluded.currency,
           seller_response_due_date = excluded.seller_response_due_date, paypal = excluded.paypal,
           paypal_updated_at = excluded.paypal_updated_at, recommendation = excluded.recommendation,
           evidence_pdf = excluded.evidence_pdf, evidence_bundle = excluded.evidence_bundle, updated_at = now()
         where disputes.paypal_updated_at is null or excluded.paypal_updated_at is null
            or excluded.paypal_updated_at >= disputes.paypal_updated_at`,
        [
          d.id,
          d.orderId ?? null,
          d.reason ?? null,
          d.status ?? null,
          d.amountValue ?? null,
          d.currency ?? null,
          d.sellerResponseDueDate ?? null,
          json(d.paypal),
          d.paypalUpdatedAt ?? null,
          json(d.recommendation),
          d.evidencePdf ? Buffer.from(d.evidencePdf) : null,
          json(d.evidenceBundle),
          d.createdAt ?? null,
        ],
      );
      return res.rowCount === 1;
    },

    async getDispute(id) {
      const r = (await pool.query("select * from disputes where id = $1", [id])).rows[0];
      if (!r) return null;
      const { hasEvidencePdf: _, ...row } = toDispute(r);
      return r.evidence_pdf ? { ...row, evidencePdf: new Uint8Array(r.evidence_pdf as Buffer) } : row;
    },

    async listDisputes({ limit, offset }) {
      const res = await pool.query(
        `select id, order_id, reason, status, amount_value, currency, seller_response_due_date, created_at, paypal,
                paypal_updated_at, recommendation, evidence_bundle, evidence_pdf is not null as has_evidence_pdf
           from disputes order by seller_response_due_date asc nulls last, created_at desc
          limit $1 offset $2`,
        [limit, offset],
      );
      return res.rows.map(toDispute);
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
            seenAt: (r.created_at as Date).toISOString(),
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

    async unknownOutcomeOrders(intentMandateId) {
      const res = await pool.query(
        `select * from orders
          where intent_mandate_id = $1 and paypal_intent = 'CAPTURE' and status = 'UNKNOWN_OUTCOME'
          order by created_at, id`,
        [intentMandateId],
      );
      return res.rows.map(toOrder);
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

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v as Date).toISOString();

type Queryable = Pick<pg.Pool, "query">;

async function insertOrder(db: Queryable, o: OrderRecord): Promise<void> {
  await db.query(
    `insert into orders (id, intent_mandate_id, intent_mandate_hash, cart_mandate_hash, custom_id, paypal_intent,
                         status, total_value, currency, shopper_id, agent_platform, human_present, reserved_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
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
      o.reservedUntil ?? null,
    ],
  );
}

/** Orders that count against an intent right now: see Db.activeLedger. */
async function activeLedgerOf(
  db: Queryable,
  intentMandateId: string,
  now: string,
  excludeOrderId?: string,
): Promise<SpendLedger> {
  const res = await db.query<{ total_value: string; at: Date }>(
    `select total_value, coalesce(captured_at, created_at) as at from orders
      where intent_mandate_id = $1 and ($3::text is null or id <> $3)
        and (captured_at is not null
             or status = 'UNKNOWN_OUTCOME'
             or (status in ('PENDING', 'CREATED', 'APPROVED', 'AUTHORIZED') and reserved_until > $2))
      order by at`,
    [intentMandateId, now, excludeOrderId ?? null],
  );
  return {
    capturedTotal: res.rows.reduce((sum, r) => sum + Number(r.total_value), 0),
    capturedOrderTimes: res.rows.map((r) => r.at.toISOString()),
  };
}

function toOrder(r: Row): StoredOrder {
  return {
    id: r.id as string,
    intentMandateId: r.intent_mandate_id as string,
    intentMandateHash: r.intent_mandate_hash as string,
    cartMandateHash: r.cart_mandate_hash as string,
    customId: r.custom_id as string,
    paypalIntent: r.paypal_intent as StoredOrder["paypalIntent"],
    status: r.status as string,
    totalValue: Number(r.total_value),
    currency: r.currency as string,
    agentPlatform: r.agent_platform as string,
    humanPresent: r.human_present as boolean,
    ...(r.shopper_id ? { shopperId: r.shopper_id as string } : {}),
    ...(r.paypal_order_id ? { paypalOrderId: r.paypal_order_id as string } : {}),
    ...(r.authorization_id ? { authorizationId: r.authorization_id as string } : {}),
    ...(r.capture_id ? { captureId: r.capture_id as string } : {}),
    ...(r.captured_at ? { capturedAt: iso(r.captured_at) } : {}),
    ...(r.created_at ? { createdAt: iso(r.created_at) } : {}),
    ...(r.reserved_until ? { reservedUntil: iso(r.reserved_until) } : {}),
  };
}

function toStepUp(r: Row): StoredStepUp {
  return {
    id: r.id as string,
    tokenHash: (r.token_hash as string).trim(),
    intentMandateId: r.intent_mandate_id as string,
    intentMandateHash: (r.intent_mandate_hash as string).trim(),
    cartMandateHash: (r.cart_mandate_hash as string).trim(),
    cart: r.cart,
    shopperKid: r.shopper_kid as string,
    agentPlatform: r.agent_platform as string,
    reasons: r.reasons as string[],
    expiresAt: iso(r.expires_at),
    status: r.status as StepUpStatus,
    ...(r.order_id ? { orderId: r.order_id as string } : {}),
    createdAt: iso(r.created_at),
    ...(r.approved_at ? { approvedAt: iso(r.approved_at) } : {}),
  };
}

function toVerdict(r: Row): StoredVerdict {
  return {
    id: Number(r.id),
    createdAt: iso(r.created_at),
    intentMandateId: r.intent_mandate_id as string,
    cartId: r.cart_id as string,
    ...(r.order_id ? { orderId: r.order_id as string } : {}),
    outcome: r.outcome as StoredVerdict["outcome"],
    reasons: r.reasons as string[],
    ...(r.semantic === null ? {} : { semantic: r.semantic }),
  };
}

function toDispute(r: Row): DisputeSummary {
  return {
    id: r.id as string,
    ...(r.order_id ? { orderId: r.order_id as string } : {}),
    ...(r.reason ? { reason: r.reason as string } : {}),
    ...(r.status ? { status: r.status as string } : {}),
    ...(r.amount_value !== null && r.amount_value !== undefined
      ? { amountValue: Number(r.amount_value) }
      : {}),
    ...(r.currency ? { currency: r.currency as string } : {}),
    ...(r.seller_response_due_date ? { sellerResponseDueDate: iso(r.seller_response_due_date) } : {}),
    ...(r.created_at ? { createdAt: iso(r.created_at) } : {}),
    paypal: r.paypal,
    ...(r.paypal_updated_at ? { paypalUpdatedAt: iso(r.paypal_updated_at) } : {}),
    ...(r.recommendation === null ? {} : { recommendation: r.recommendation }),
    ...(r.evidence_bundle === null ? {} : { evidenceBundle: r.evidence_bundle }),
    hasEvidencePdf: r.has_evidence_pdf === undefined ? r.evidence_pdf != null : Boolean(r.has_evidence_pdf),
  };
}

/** undefined → SQL null; anything else → JSON text for a jsonb column (pg would send arrays as Postgres arrays). */
const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value));
