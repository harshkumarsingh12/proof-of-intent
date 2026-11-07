-- Vault v3 wallet saving (docs/specs/0004 §Vault, #17). A setup token is created for one shopper and turns into a
-- payment token (shoppers.vault_id) at most once, so a setup token PayPal handed to someone else can't be saved
-- onto another shopper, and a repeated save can't run twice.
create table vault_setups (
  setup_token_id  text primary key,                          -- PayPal's setup token id
  shopper_id      text not null references shoppers (id),
  created_at      timestamptz not null default now(),
  claimed_at      timestamptz                                -- set while (and after) it is turned into a payment token
);
