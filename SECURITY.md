# Security

Proof of Intent holds three sensitive things: signing keys, buyer addresses, and the ability to move money
through PayPal. Each has one owner, one storage rule and one test.

## Reporting

Hackathon project, sandbox data only. If you find a vulnerability, open a private security advisory on this
repository (Security → Report a vulnerability) or contact @harshkumarsingh12. Please don't open a public issue.

## Secrets

- PayPal client secret, webhook id, LLM key, AG Studio key and the merchant signing key live only in the team
  server's `.env` (mode 600, outside the repo checkout) and in GitHub Actions secrets.
- `.env`, `*.pem` and `*.key` are gitignored. gitleaks runs on every PR.
- Judge sandbox accounts are shared through the Devpost testing instructions, never committed.
- If a secret is committed: rotate it first, then clean history. Rotation is what actually protects us.

## Design rules

| Asset | Rule | Verified by |
|---|---|---|
| Shopper keys | ECDSA P-256, non-extractable WebCrypto keys in IndexedDB; public JWK registered; retired keys keep verifying old mandates | `packages/mandates` tests |
| Merchant key | Generated with `pnpm keys:gen`; Cart Mandates carry the key id so rotation doesn't break old carts | `packages/mandates` tests |
| Agent keys | Registered per agent; unknown key rejected before any PayPal call | `UNKNOWN_KEY` test |
| Replay | Nonces stored with a unique index; carts expire after 15 minutes | `NONCE_REPLAYED`, `CART_EXPIRED` tests |
| Audit integrity | The audit log stores the exact canonical bytes and signature that were verified, never a re-serialized copy | evidence-integrity script |
| Webhooks | Verified with PayPal's verify-signature call before any processing; unverified → 400 | webhook tests |
| Money movement | No order, capture, void, claim acceptance or evidence submission without a verdict (orders) or an audited operator click (disputes) | API + worker tests |
| LLM input | Never receives emails, vault ids, keys or full addresses; a redaction step runs before every call | `packages/ai` tests |
| Prompt injection | Buyer-supplied text is delimited data; "ignore the budget" style strings must fail safe | J1/J2 injection fixtures |
| Public demo | Rate limits on `/checkout`, `/webhooks/paypal`, `/ai/studio`; daily AI budget kill switch; viewer role | spec 0008 |

## Pre-submission checklist (owner: @srshriv, Nov 10)

- [ ] Replay, tampering, expired mandates and unregistered keys are rejected (tests green)
- [ ] Webhook signature failure returns 400 and is logged
- [ ] Upload type and size limits on evidence files
- [ ] Logs contain no secrets, full addresses or mandate payloads above debug level
- [ ] gitleaks clean on the full history
- [ ] Postgres not reachable from outside the server; only the proxy is exposed
- [ ] Demo logins: viewer cannot act; operator limited to the scripted disputes; nightly reset runs
