# 0006: AI jobs, replay mode and evals

| | |
|---|---|
| **Status** | Proposed |
| **Owner** | @sumedhag28 |
| **Reviewers** | @hoursgotviral-dev, @srshriv |
| **Milestone** | M1 (J1, replay), M2 (J2, J3), M3 (J4, full evals) |
| **Code** | `packages/ai`, `docs/evals/` |

## Context

The model judges what code can't (does "hooded rain shell" fit "running jacket"?) and writes explanations. It must
never move money, never override a hard rule, and give the same answer on every demo take.

## Design

| Job | Input | Output (strict schema in `packages/ai`) | Budget | Used by |
|---|---|---|---|---|
| J1 semantic fit | shopper's words, cart lines | `SemanticFit` | 2 s | checkout stage 1 |
| J2 dispute classification | reason, buyer note, bundle, verdict, timeline | `DisputeClassification` | 5 s | worker |
| J3 evidence drafting | classification, bundle, policy text | `EvidenceDraft` | 10 s | worker, on request |
| J4 operator questions | question, dashboard schema | AG Studio tool calls | 10 s | Studio harness |

**Rules everywhere:** structured output only (invalid → retry once → `confidence: 0` → human); temperature 0;
buyer-supplied text inside delimited data blocks, never followed as instructions; J2/J3 must cite bundle ids
(uncited reasons dropped); redaction before every call (no emails, vault ids, keys, full addresses); per-merchant
daily budget with a kill switch to rule-only mode.

**Provider:** configurable through the Vercel AI SDK (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`). D1: choose and
record here by Oct 31.

**Replay mode (`AI_MODE=replay`, the default):** responses recorded during eval runs, keyed by SHA-256 of the
canonical input, stored in `packages/ai/replay/*.json`. Unknown input in replay mode → `confidence: 0` → human.

**Prompts:** `packages/ai/prompts/*.md` with front matter (`version`, `model`, `schema`). Each verdict records its
prompt version in the audit log.

**Evals:** J1 set of 20 (7 match, 7 partial, 6 mismatch); J2 set of 12 covering all four classes. `pnpm eval`
writes `docs/evals/<date>.md`. Targets: J1 accuracy ≥ 0.9 with **zero mismatch labelled match**; J2 at least 11/12;
schema validity 100% after retry.

## Acceptance criteria

1. Replay: compliant fixture → `match` ≥ 0.8; rain shell → `partial`. *(ledger M1)*
2. An injected "ignore the budget" title never yields `match`. *(ledger M1)*
3. Overreach dispute → `AGENT_OVERREACH`, `ACCEPT_CLAIM`. *(ledger M2)*
4. Stack runs end to end with no API key in replay mode.
5. Eval report committed with numbers quoted in the README. *(M3)*

## Open questions

- D1 provider and model. @sumedhag28, Oct 31.
