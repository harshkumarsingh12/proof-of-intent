-- Step-up approval links (docs/specs/0003, #35). Agent alone and not sure enough: the cart waits here, with no
-- order and no PayPal call, until the shopper approves it from the emailed link or the link expires.
create table stepups (
  id                    text primary key,                  -- stp_<uuid>; the CartApproval's order_id
  token_hash            char(64) not null unique,          -- sha256 of the link token; the token itself is never stored
  intent_mandate_id     text not null,
  intent_mandate_hash   char(64) not null references mandates (hash),
  cart_mandate_hash     char(64) not null,                 -- of `cart`; the Cart Mandate is signed only on approval
  cart                  jsonb not null,                    -- the proposed cart, exactly as the agent sent it
  shopper_kid           text not null,                     -- the key that signed the intent, and must sign the approval
  agent_platform        text not null,
  reasons               text[] not null default '{}',
  status                text not null default 'PENDING'
                        check (status in ('PENDING', 'APPROVING', 'APPROVED', 'REJECTED', 'EXPIRED', 'FAILED')),
  order_id              text references orders (id),
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  approved_at           timestamptz
);
