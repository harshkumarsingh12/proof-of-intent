-- Dispute copilot state (docs/specs/0005). The worker writes it from the webhook inbox, the API reads it.
alter table disputes
  add column paypal             jsonb,         -- the latest PayPal dispute object we received
  add column paypal_updated_at  timestamptz,   -- its update_time: an older delivery never overwrites a newer one
  add column recommendation     jsonb,         -- class, action, reasons and constraint checks (deterministic tree)
  add column evidence_pdf       bytea,         -- attestation PDF, MANDATE_COMPLIANT only
  add column evidence_bundle    jsonb;         -- the JSON bundle the PDF was generated from
