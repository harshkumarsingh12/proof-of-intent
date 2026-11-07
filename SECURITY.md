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

| Asset            | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Verified by                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Shopper keys     | ECDSA P-256, non-extractable WebCrypto keys in IndexedDB; public JWK registered at `POST /keys/shopper` (private parts refused), `kid` = RFC 7638 thumbprint so ids can't be squatted; retired keys keep verifying old mandates                                                                                                                                                                                                                                                         | `packages/mandates`, `apps/api/src/keys.test.ts`                       |
| Merchant key     | Generated with `pnpm keys:gen`; Cart Mandates carry the key id so rotation doesn't break old carts                                                                                                                                                                                                                                                                                                                                                                                      | `packages/mandates` tests                                              |
| Agent keys       | Registered by the operator per platform (`POST /keys/agent`); a key can't move to another platform; unknown or retired key rejected before any PayPal call                                                                                                                                                                                                                                                                                                                              | `UNKNOWN_KEY` tests                                                    |
| Operator actions | `Bearer OPERATOR_TOKEN` (compared in constant time) held server-side by the dashboard, behind an HTTP Basic login; either variable unset turns actions off. The operator's audit row is written before the PayPal call; evidence rows carry the PDF's SHA-256                                                                                                                                                                                                                           | `apps/api/src/disputes.test.ts`, `apps/dashboard/src/operator.test.ts` |
| Shopper wallet   | Saved with Vault v3 only on a 5-minute proof signed by the shopper's own key; a setup token is stored for one shopper and claimed once; the shopper can remove it the same way (cleared first, then revoked at PayPal); the vault id never leaves the server (`GET /vault/:kid` says only whether one exists)                                                                                                                                                                           | `apps/api/src/vault.test.ts`                                           |
| Shop assistant   | Read-only: it answers with text, product information and unsigned limits, and has no way to sign, buy, propose a checkout or touch a wallet; it receives only the limits and the last verdict (never the signed intent, ids or wallet state), refuses pasted keys, tokens and signed records, redacts emails, and answers a verdict in fixed text; the facts are gathered by plain code and a guard drops an answer that states a price or SKU the store lacks; per-IP and daily limits | `apps/buyer/src/chat.test.ts`, `chat-server.test.ts`                   |
| Near-miss hint   | After a refusal for price or kind, the shop says what would have fit using plain code over the catalog and the signed limits (no model); its one button only refills the limits form, drops the old signed intent and needs a new signature; a cap is never lowered and voice never applies it | `apps/buyer/src/near-miss.ts`, `near-miss.test.ts`, `scripts/smoke/shop.ts` |
| Waiting carts    | The shop lists a shopper's held carts and approves them only with signatures from the key that signed the intent (a 5-minute list proof, then a CartApproval for that step-up and cart); the agent never holds that key; a token is never returned                                                                                                                                                                                                                                      | `apps/api/src/stepup.test.ts`                                          |
| Replay           | Nonces stored with a unique index; carts expire after 15 minutes                                                                                                                                                                                                                                                                                                                                                                                                                        | `NONCE_REPLAYED`, `CART_EXPIRED` tests                                 |
| Dependencies     | `pnpm audit --prod` runs in CI (`--audit-level=high`, not yet blocking); the highs that were reviewed and accepted are explicit in `package.json`, with a reachability note for each in the section below | CI, SECURITY.md §Dependency advisories |
| Backups          | A dump holds everything the database holds, so `./backups` is git-ignored (on Dokploy they live in a named volume) and dumps are to be treated as secrets; a missing or stuck backup shows as an `unhealthy` container; `scripts/deploy/restore-drill.sh` proves a dump restores (and refuses one with errors) without touching live data | `scripts/deploy/restore-drill.sh`, spec 0008 §Restore drill |
| Cart facts       | The agent proposes the cart, the merchant signs it: every line's SKU, title, attributes and price must equal the merchant's catalog or the checkout is rejected with `CATALOG_MISMATCH` (no order, no Cart Mandate); the audit log names the differing fact | `packages/contracts/src/catalog.test.ts`, `apps/api/src/checkout.test.ts` |
| Audit integrity  | The audit log stores the exact canonical bytes and signature that were verified, never a re-serialized copy                                                                                                                                                                                                                                                                                                                                                                             | evidence-integrity script                                              |
| Webhooks         | Verified with PayPal's verify-signature call before any processing; unverified → 400                                                                                                                                                                                                                                                                                                                                                                                                    | webhook tests                                                          |
| Money movement   | No order, capture, void, claim acceptance or evidence submission without a verdict (orders) or an audited operator click (disputes)                                                                                                                                                                                                                                                                                                                                                     | API + worker tests                                                     |
| Logs             | No secret in a log line: a step-up link's token is redacted in the request log (`/stepup/[redacted]`) and the link itself is only logged with `LOG_STEPUP_LINKS=1` (local development); request bodies, headers and mandate payloads are not logged, and a rejected webhook logs only its event id and type | `apps/api/src/logging.test.ts` |
| LLM input        | Never receives emails, vault ids, keys or full addresses; a redaction step runs before every call                                                                                                                                                                                                                                                                                                                                                                                       | `packages/ai` tests                                                    |
| Prompt injection | Buyer-supplied text is delimited data; "ignore the budget" style strings must fail safe                                                                                                                                                                                                                                                                                                                                                                                                 | J1/J2 injection fixtures                                               |
| Public demo      | Rate limits on `/checkout`, `/webhooks/paypal`, `/keys/shopper`, `/vault/setup`, `/vault/save`, `/vault/remove`, `/ai/studio`; daily AI budget kill switch; without the operator login the dashboard is read-only                                                                                                                                                                                                                                                                       | spec 0008                                                              |

## Dependency advisories

Audited Nov 8, 2026 with `pnpm audit --prod` (#167). It reported **21 advisories (2 critical, 8 high, 9 moderate, 2 low)**.
After the changes below, **10 remain: none critical, 3 high, 5 moderate, 2 low.** A count alone does not say what an attacker
can reach, so each group says whether the vulnerable code is even loaded. I checked that by importing what the API imports
(`@paypal/agent-toolkit/ai-sdk`, `ai`) and listing the modules Node loaded.

**Fixed (12):**

| What | Change | Checked |
|---|---|---|
| `vitest` and `tinypool` (**both criticals**) and `@vitest/mocker` (5) | `packages/ledger` declared `vitest` only as a *peer* dependency, which pnpm installs as a production dependency of the ledger. It is now also a `devDependency`. | `pnpm audit --prod` no longer lists them; they are test tooling and never ship |
| `postcss` via Next (2 high, 2 moderate) | `pnpm.overrides`: `postcss ^8.5.23`. It only processes our own CSS at build time. | Both Next apps build |
| `mathjs` via the PayPal toolkit (2 high) | `pnpm.overrides`: `mathjs ^15.2.0`. The toolkit calls only `round(x, 2)`, never the expression parser the advisories are about. | The toolkit loads and `round` is correct |
| `@langchain/core` via the toolkit (1 high) | `pnpm.overrides`: `0.3.80` (same minor line). It is not loaded by anything we import. | n/a (not loaded) |

**Accepted, with the reason (10):** the three highs are listed in `package.json` under `pnpm.auditConfig.ignoreGhsas`, so CI
fails on a *new* high or critical and not on these.

| Package (advisories) | Why it is not reachable | What would fix it |
|---|---|---|
| `langsmith` (1 high, 3 moderate), `uuid` (1 moderate), via `@langchain/core` | Not loaded when the API starts (`@langchain/core`, `langsmith` and `uuid` are absent from the loaded modules). The advisories need LangSmith prompt pulls or LangChain deserialization, which we never call. | A toolkit that updates LangChain: the newest `@paypal/agent-toolkit` (1.11.0) pins `@langchain/core` exactly |
| `jsondiffpatch` (1 high, 1 moderate), via `ai@4.3.19` | Used only by `ai/rsc` (React Server Components), which we do not import; not loaded. | `ai` 5, or `jsondiffpatch` 0.7 (`ai` pins 0.6.0 exactly) |
| `zod` (1 high) | The advisory is in zod's **v4** array validation. We and our dependencies use the v3 API; `zod/v4` is not imported or loaded. Request bodies also have size limits. | zod 4.6.6, a major migration |
| `ai` (1 low), `@ai-sdk/provider-utils` (1 low) | File-type allowlist and resource-use issues in features we do not use. | `ai` 5 |

**Dev tooling only** (a full `pnpm audit`, which is not gated): `vitest`/`tinypool` 3.x (2 critical, 3 moderate) and `minimatch`
via `typescript-eslint` (1 moderate). The test runner needs an attacker who can already pollute the prototype inside the
process, and only runs in development and CI. Fixing them is a major `vitest` upgrade.

**Next:** after the hackathon, move to `ai` 5 and zod 4 and remove the matching `ignoreGhsas` entries, and delete
`continue-on-error` on the CI audit step so a new advisory blocks the merge. Re-run `pnpm audit --prod` whenever dependencies
change and update this section.

## Pre-submission checklist (owner: @srshriv, Nov 10)

Swept Nov 8, 2026 against `main`; each line says what was checked. Items marked "needs the server" cannot be verified
from the repository or from outside, and stay unticked until someone looks at the server.

- [x] Replay, tampering, expired mandates and unregistered keys are rejected (tests green). `NONCE_REPLAYED`,
  `SIGNATURE_INVALID` and `UNKNOWN_KEY` in `apps/api/src/checkout.test.ts`, `packages/mandates/src/mandates.test.ts` and
  `apps/api/src/keys.test.ts`; an expired or not-yet-valid intent through `POST /checkout` in `checkout.test.ts`; an intent
  that expires between checkout and capture in `approve.test.ts`. The full suite is green.
- [ ] Webhook signature failure returns 400 and is logged. The 400 is tested (`webhooks.test.ts`); the log line (a `warn`
  with the event id and type, no signature or body) is asserted by the tests in #186. Tick once #186 is merged.
- [x] Upload type and size limits on evidence files. There is no upload endpoint: the only evidence file is the PDF the worker
  generates, sent to PayPal as `application/pdf` with a 10 MB cap (`MAX_EVIDENCE_FILE_BYTES`, `packages/paypal`). Request
  bodies have explicit size limits (webhook 256 KB, checkout 64 KB, approve 16 KB, dispute actions 32 KB, tracking 8 KB).
- [ ] Logs contain no secrets, full addresses or mandate payloads above debug level. Found and fixed: a step-up link's token
  was written to the access log and to an explicit log line. Fixed and tested in #186. Tick once #186 is merged. No
  address is ever stored (only a hash), and request bodies, headers and mandate payloads are not logged. Proxy logs outside
  this app (Dokploy, Cloudflare) can still record URL paths: needs the server.
- [x] gitleaks clean on the full history. gitleaks (default rules) scanned 176 commits: no leaks. Separately, every secret
  value in the developer's local `.env` (the same variables the server uses: the signing keys, the AI keys, the PayPal client
  secret, the operator token and the AG Studio license) was searched for in all 180 revisions: none found. The server's own
  `.env` was not read, so a value that exists only there is not covered. `.env` is git-ignored and was never committed.
- [ ] Postgres not reachable from outside the server; only the proxy is exposed. In `docker-compose.yml`, Postgres publishes
  no port at all, and the api, shop and dashboard publish only to `127.0.0.1`. The server's firewall and Dokploy's
  settings need the server.
- [x] Demo logins: viewer cannot act. On the hosted site, the operator-only API routes (dispute actions, tracking, agent
  keys, `/ai/studio`) answer 401 with no token and with a wrong one, and the dashboard's proxy answers 401 to a viewer or a
  wrong password and 404 to any POST it doesn't allow.
- [x] Seeded demo disputes are read-only (409 `demo_read_only`); the operator acts on real sandbox disputes. _Reworded from
  "operator limited to the scripted disputes", which is not how it works and would contradict the judge flow: judges
  file their own fresh disputes and the operator acts on those (`docs/JUDGE_TESTING.md`)._
- [ ] Nightly demo reset runs. **Not built:** nothing in the repository does this, and it may not be safe to build on a
  database that holds judges' real sandbox cases. Decide to scope it carefully or drop it from spec 0008 and this list.
