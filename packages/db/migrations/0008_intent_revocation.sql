-- A shopper can stop a signed intent before it expires (docs/specs/0013, #176). Written once, by the merchant's clock; there is
-- no un-revoke. Purchases made before it stay valid. Only intent rows carry it.
alter table mandates add column revoked_at timestamptz;
alter table mandates add constraint mandates_revoked_intent_only check (revoked_at is null or kind = 'intent');
