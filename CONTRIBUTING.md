# Contributing

Four people, thirteen days, one demo. These rules exist so nobody blocks or overwrites anybody.
Read this once, fully, before your first PR.

## Who owns what

The primary owner decides and reviews; the backup can merge if the primary is unavailable for a day.

| # | Area | Paths | Primary | Backup |
|---|---|---|---|---|
| 1 | Repo infra, CI/CD, releases | `.github/`, `scripts/`, root config | **Harsh** | Sristee |
| 2 | PayPal client (Orders, Vault, Webhooks, Disputes REST) | `packages/paypal/` | **Harsh** | Sristee |
| 3 | Merchant API routes | `apps/api/` | **Harsh** | Sristee |
| 4 | Database, migrations, audit log | `packages/db/` | **Harsh** | Sikruti |
| 5 | Team server, Compose, HTTPS, monitoring | `docker-compose.yml`, `Dockerfile`, `Caddyfile` | **Harsh** | Sristee |
| 6 | Shared contracts and reason codes | `packages/contracts/` | **Sristee** | Harsh |
| 7 | Mandate crypto (JCS, hashing, JWS, key registry) | `packages/mandates/` | **Sristee** | Harsh |
| 8 | Policy engine | `packages/policy-engine/` | **Sristee** | Harsh |
| 9 | Buyer app and buyer agent | `apps/buyer/` | **Sristee** | Sikruti |
| 10 | Security checklist | `SECURITY.md` | **Sristee** | Harsh |
| 11 | Dispute copilot, Agent Toolkit, evidence PDF | `apps/worker/` | **Sikruti** | Sumedha |
| 12 | Operations dashboard, AG Studio widgets | `apps/dashboard/` | **Sikruti** | Harsh |
| 13 | LLM jobs, prompts, replay mode, evals | `packages/ai/`, `docs/evals/` | **Sumedha** | Sikruti |
| 14 | Studio agent (DisputeExplainer) | `apps/dashboard/src/studio-agent.ts` | **Sumedha** | Sikruti |
| 15 | Seed data story, demo script, video, Devpost | `docs/DEMO.md`, README pitch | **Sumedha** | everyone |

Two splits that are not obvious:

- **Harsh backs up the dashboard, not the worker.** After the Nov 6 gate the PayPal side is done and the
  dashboard is the biggest remaining surface (and the sponsor prize). The worker stays with Sikruti and Sumedha,
  who share the AI context.
- **Sristee owns the contracts even though Harsh owns the API.** The contracts are mostly mandate shapes and
  reason codes, which come from her area. Every contracts change still needs both of them (CODEOWNERS enforces it).

## Spec first

Anything that changes behaviour other people depend on starts as a spec.

1. Copy `docs/specs/TEMPLATE.md` to `docs/specs/NNNN-short-name.md` (next free number).
2. Open a PR with status **Proposed**. Owners of affected areas review.
3. Merge as **Accepted**. Implement in follow-up PRs that link the spec. Move it to **In Progress**, then **Done**.

Skip the spec for bug fixes, refactors inside one package, docs, tests and dependency bumps.
CI fails a PR that touches `packages/contracts/src/` or `apps/api/src/routes/` without a `docs/specs/NNNN` link
in its description.

## The frozen contract

`packages/contracts` is the only place shared types live. If you need a new field, it goes through a spec and
a PR reviewed by Sristee and Harsh, announced in the team chat before merge, because it can break three apps at once.
Do not copy a type into your package "for now".

## The ledger: acceptance criteria as tests

Every acceptance criterion that is not built yet is a real test wrapped in `ledger()`:

```ts
import { ledger } from "@poi/ledger";

ledger("M1", "srshriv", "budget_cap counts prior captured orders", () => {
  expect(evaluate(overBudget).reasons).toContain("BUDGET_EXCEEDED");
});
```

- It runs as `test.fails`: green today because the assertion fails.
- When you build the feature, the assertion passes and the test turns **red**. Change `ledger(...)` to
  `test(...)` (drop the milestone and owner) in the same PR. Nobody can claim "done" without the test agreeing.
- CI prints a Milestone × Owner burndown from these entries on every run (job summary of the `ci` workflow).
- Calling `test.fails` directly is a lint error; use `ledger()` so the burndown can attribute it.
- Owners and milestones are typed. A typo is a compile error.

## Branches and pull requests

```bash
git switch main && git pull
git switch -c feat/policy-budget-cap      # feat/ fix/ docs/ chore/ test/ refactor/ ci/
```

- **Never push to `main`.** It is protected for everyone, including the repo owner. Even a one-line fix is a PR.
- **One PR, one concern.** A PR that touches four areas is four PRs.
- **CI must be green** (`ci` and `hygiene`) and the branch up to date with `main`.
- **One approval to merge.** Any teammate can approve. Don't wait on one person; ask in the chat.
- **Squash merge.** The PR title becomes the commit message, so it must be a Conventional Commit:
  `feat(policy): count prior captures against budget_cap`. Lowercase subject, no trailing period.
- **Rebase when you drift:** `git pull --rebase origin main`.
- **Resolve every review conversation** before merging.

## Commits

- Conventional Commits in the imperative: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `ci`.
- Commit often; a visible history matters for the hackathon.
- Commits are authored by the person who wrote them. No co-author trailers for tools.

## Definition of done

- `pnpm lint && pnpm typecheck && pnpm test` pass; no test was weakened.
- New behaviour has a test; finished ledger entries became plain tests.
- The spec matches what was built (update it in the same PR if it changed).
- The package or app README reflects any public API change.
- Stayed in your area, or the owner approved the crossing.
- Nothing committed is a secret, credential, `.env`, private key or large binary.

## Working locally

```bash
corepack enable
pnpm install
pnpm test            # all tests, including ledger entries
pnpm test:ci && pnpm ledger   # see the burndown
pnpm dev:api         # http://localhost:3000
```

No PayPal or LLM keys are needed: `PAYPAL_MODE=mock` and `AI_MODE=replay` are the defaults.

## When you are stuck

Say so in the team chat within 30 minutes, with what you tried. A blocked person is the most expensive thing
in a 13-day sprint.
