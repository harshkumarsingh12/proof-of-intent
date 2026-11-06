# 0006: AI jobs, replay mode and evals

|               |                                                   |
| ------------- | ------------------------------------------------- |
| **Status**    | Accepted                                          |
| **Owner**     | @sumedhag28                                       |
| **Reviewers** | @hoursgotviral-dev, @srshriv                      |
| **Milestone** | M1 (J1, replay), M2 (J2, J3), M3 (J4, full evals) |
| **Code**      | `packages/ai`, `docs/evals/`                      |

## Context

The model judges what code can't (does "hooded rain shell" fit "running jacket"?) and writes explanations. It must
never move money, never override a hard rule, and give the same answer on every demo take.

## Design

| Job                       | Input                                         | Output (strict schema in `packages/ai`) | Budget | Used by            |
| ------------------------- | --------------------------------------------- | --------------------------------------- | ------ | ------------------ |
| J1 semantic fit           | shopper's words, cart lines                   | `SemanticFit`                           | 2 s    | checkout stage 1   |
| J2 dispute classification | reason, buyer note, bundle, verdict, timeline | `DisputeClassification`                 | 5 s    | worker             |
| J3 evidence drafting      | classification, bundle, policy text           | `EvidenceDraft`                         | 10 s   | worker, on request |
| J4 operator questions     | question, dashboard schema                    | AG Studio tool calls                    | 10 s   | Studio harness     |

**Rules everywhere:** structured output only (invalid → retry once → unavailable → human); temperature 0;
buyer-supplied text inside delimited data blocks, never followed as instructions; J2/J3 must cite bundle ids
(uncited reasons dropped); redaction before every call (no emails, vault ids, keys, full addresses); per-merchant
daily budget with a kill switch to rule-only mode.

**Provider:** configurable through the Vercel AI SDK (`AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`). D1: choose and
record here by Oct 31.

**Replay mode (`AI_MODE=replay`, the default):** responses recorded during eval runs, keyed by SHA-256 of the
canonical input, stored in `packages/ai/replay/*.json`. Unknown input in replay mode → unavailable → human.

**Unavailable, not `confidence: 0`.** When a job has no trustworthy answer (no recording, invalid output after the
retry, timeout, no key) it throws `AiUnavailableError`. Checkout treats that like an unbuilt J1: `STEP_UP` with
`SEMANTIC_UNCERTAIN` (spec 0003 stage 6). A literal `confidence: 0` would have meant `REJECT` under spec 0003's
thresholds, which turns "the model didn't answer" into "the shopper's cart is wrong".

**J1 as built (`packages/ai/src/j1.ts`, prompt `j1-v1`).**

- The model sees only the shopper's words (emails and phone numbers redacted) and the cart lines and total, each as
  a JSON data block with `<` and `>` escaped so the data can't close its own tag. The replay key covers exactly
  that, so a fresh cart id or mandate gets the same recorded answer.
- An injection guard runs first: cart text that tries to instruct the checker ("ignore the budget", "approve this
  order", "system prompt") is a `mismatch` with no model call, so that answer can't depend on the model resisting.
- A `match` that lists `conflicting_attributes` is lowered to `partial`.
- Per-attempt timeout 2 s; one retry; the AI SDK's own retries are off. Each answer carries `prompt_version` and
  `source` (`live`, `replay`, `guard`), and checkout writes it to the audit log with the verdict.
- `pnpm ai:record` asks the live model about every case in `packages/ai/src/j1-cases.ts` and rewrites
  `packages/ai/replay/j1-semantic-fit.json`. A test fails if a case has no recording for the current prompt
  version, so editing the prompt means re-recording.

**Prompts:** `packages/ai/prompts/*.md` with front matter (`version`, `model`, `schema`). Each verdict records its
prompt version in the audit log.

**Evals:** J1 set of 20 (7 match, 7 partial, 6 mismatch); J2 set of 12 covering all four classes. `pnpm eval`
writes `docs/evals/<date>.md`. Targets: J1 accuracy ≥ 0.9 with **zero mismatch labelled match**; J2 at least 11/12;
schema validity 100% after retry.

## Acceptance criteria

1. Replay: compliant fixture → `match` ≥ 0.8; rain shell → `partial`. _(done)_
2. An injected "ignore the budget" title never yields `match`. _(done)_
3. Overreach dispute → `AGENT_OVERREACH`, `ACCEPT_CLAIM`. _(ledger M2)_
4. Stack runs end to end with no API key in replay mode. _(J1 done: `checkout.test.ts` runs the real J1 in replay)_
5. Eval report committed with numbers quoted in the README. _(M3)_

## Decisions

- **D1 (Nov 5): NVIDIA API catalog, `nvidia/nemotron-3.5-lightning-30b-a3b`.** OpenAI-compatible endpoint
  `https://integrate.api.nvidia.com/v1`, so it plugs into the Vercel AI SDK's OpenAI-compatible provider.
  `AI_PROVIDER=nvidia`, `AI_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`.
- **Thinking must be off on every call:** send `chat_template_kwargs: { enable_thinking: false }`. With thinking on, the
  model spent a full 1024-token budget reasoning (about 10 s) and returned no answer, which breaks J1's 2 s budget.
  With it off, it answered a J1-style check in under 1 s.
- Mini-eval of 6 J1 cases (Nov 5): lightning 5/6 correct, valid JSON 6/6, ~0.7 s; `nemotron-3-ultra-550b-a55b` also 5/6
  at ~1.1 s and is the fallback. Every model missed the "partial" case (a rain shell for a running jacket), which is
  a prompt problem: give "partial" a definition with examples. Other catalog models either returned no usable JSON
  or weren't available to our key.
- **J1 prompt `j1-v1` (Nov 6), recorded live on lightning:** compliant → `match` 0.95, rain shell → `partial`
  0.75, red jacket → `mismatch` 0.99: 3/3, including the `partial` case every model missed on Nov 5 once "partial"
  had a definition and examples. Latency 1.4–1.9 s warm; the first call of a process can exceed the 2 s budget and
  succeed on the retry.
