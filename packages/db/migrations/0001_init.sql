-- Proof of Intent schema v1. Tables from docs/specs/0003-checkout-and-verification.md.
-- Unique indexes carry idempotency and replay protection, so the app never "checks then inserts".
-- Money is integer minor units plus an ISO 4217 code (docs/CONVENTIONS.md).

create table shoppers (
  id          text primary key,
  vault_id    text unique,                       -- Vault v3 payment token, once the wallet is saved
  created_at  timestamptz not null default now()
);

-- Public keys only. A retired key still verifies mandates created before retired_at (spec 0001).
create table shopper_keys (
  kid         text primary key,
  shopper_id  text not null references shoppers (id),
  public_jwk  jsonb not null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

create table agent_keys (
  kid         text primary key,
  platform    text not null,
  owner       text not null,
  public_jwk  jsonb not null,
  created_at  timestamptz not null default now(),
  retired_at  timestamptz
);

-- Every mandate exactly as verified: the canonical bytes that were signed, and the JWS.
-- Keyed by content hash: ids inside mandates (a cart_id especially) are chosen by the sender and not unique.
create table mandates (
  hash        char(64) primary key check (hash ~ '^[0-9a-f]{64}$'),
  kind        text not null check (kind in ('intent', 'cart', 'payment')),
  mandate_id  text not null,                     -- mandate_id, cart_id or payment_mandate_id as sent
  canonical   text not null,
  jws         text not null,
  kid         text not null,
  created_at  timestamptz not null default now()
);
create index mandates_id_idx on mandates (kind, mandate_id);

-- Replay protection: a nonce can be claimed once, ever.
create table nonces (
  nonce       text primary key,
  claimed_at  timestamptz not null default now()
);

create table orders (
  id                 text primary key,           -- ord_<id>, also PayPal invoice_id and PayPal-Request-Id
  intent_mandate_id    text not null,          -- for budget and recurrence lookups
  intent_mandate_hash  char(64) not null references mandates (hash),
  cart_mandate_hash    char(64) references mandates (hash),
  custom_id          text not null check (length(custom_id) <= 127),
  paypal_intent      text not null check (paypal_intent in ('AUTHORIZE', 'CAPTURE')),
  paypal_order_id    text unique,
  authorization_id   text unique,
  capture_id         text unique,
  status             text not null,
  total_value        bigint not null check (total_value >= 0),
  currency           char(3) not null,
  shopper_id         text references shoppers (id),
  agent_platform     text,
  human_present      boolean not null,
  captured_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index orders_intent_idx on orders (intent_mandate_id);

-- Every checkout decision, including REJECTs that never become an order.
create table verdicts (
  id                 bigint generated always as identity primary key,
  intent_mandate_id  text not null,
  cart_id            text not null,
  order_id           text references orders (id),
  outcome            text not null check (outcome in ('APPROVE', 'STEP_UP', 'REJECT')),
  reasons            text[] not null default '{}',
  semantic           jsonb,                      -- J1 output and prompt version, when it ran
  created_at         timestamptz not null default now()
);
create index verdicts_intent_idx on verdicts (intent_mandate_id);

-- Verified PayPal deliveries. The primary key makes redelivery a no-op.
create table webhook_events (
  event_id      text primary key,
  event_type    text not null,
  resource_id   text,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);
create index webhook_events_unprocessed_idx on webhook_events (received_at) where processed_at is null;

create table disputes (
  id                        text primary key,    -- PayPal dispute id
  order_id                  text references orders (id),
  reason                    text,
  status                    text,
  amount_value              bigint,
  currency                  char(3),
  seller_response_due_date  timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Append-only. Evidence is generated from these rows (ARCHITECTURE.md invariant 5).
create table audit_log (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  actor         text not null,
  action        text not null,
  subject_id    text not null,
  prior_state   jsonb,
  request_body  jsonb
);
create index audit_log_subject_idx on audit_log (subject_id, at, id);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only (% refused)', tg_op;
end;
$$;
create trigger audit_log_no_update_delete
  before update or delete on audit_log
  for each statement execute function audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on audit_log
  for each statement execute function audit_log_append_only();
