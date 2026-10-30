# Specs

Write the spec, agree on it, then build it. Two people building in parallel without a written agreement build
two incompatible things.

## Lifecycle

**Proposed** → **Accepted** → **In Progress** → **Done** (or **Superseded** / **Rejected**)

- *Proposed:* PR open, owners of affected areas reviewing.
- *Accepted:* merged; the interfaces are the contract. Code PRs link it.
- *In Progress:* first implementation PR merged.
- *Done:* every acceptance criterion is a plain passing test (no `ledger()` entries left for it).

Changing an Accepted spec is a PR to the spec first, reviewed by the same owners, then the code.

## When you need one

Need one: new or changed types in `packages/contracts`, API routes, job payloads, webhook handling, anything two
areas both touch. Skip: bug fixes, refactors inside one package, docs, tests, dependency bumps.

## Index

| # | Spec | Owner | Reviewers | Milestone | Status |
|---|---|---|---|---|---|
| [0001](0001-mandate-model.md) | Mandate model and signatures | @srshriv | @harshkumarsingh12 | M0 | Proposed |
| [0002](0002-policy-engine.md) | Policy engine and reason codes | @srshriv | @harshkumarsingh12, @hoursgotviral-dev | M0 | Proposed |
| [0003](0003-checkout-and-verification.md) | Checkout API and verification flow | @harshkumarsingh12 | @srshriv, @sumedhag28 | M0 | Proposed |
| [0004](0004-paypal-integration.md) | PayPal integration | @harshkumarsingh12 | @hoursgotviral-dev | M0 | Proposed |
| [0005](0005-dispute-copilot.md) | Dispute copilot | @hoursgotviral-dev | @sumedhag28, @harshkumarsingh12 | M0 | Proposed |
| [0006](0006-ai-jobs.md) | AI jobs, replay mode and evals | @sumedhag28 | @hoursgotviral-dev, @srshriv | M0 | Proposed |
| [0007](0007-dashboard.md) | Dashboard and AG Studio | @hoursgotviral-dev | @sumedhag28, @harshkumarsingh12 | M0 | Proposed |
| [0008](0008-hosting-and-deploy.md) | Hosting and deploy | @harshkumarsingh12 | @srshriv | M0 | Proposed |
| [0009](0009-demo-and-submission.md) | Demo and submission | @sumedhag28 | everyone | M0 | Proposed |

All nine are reviewed at the **Oct 31 contracts gate**. New specs take the next free number from
[TEMPLATE.md](TEMPLATE.md).
