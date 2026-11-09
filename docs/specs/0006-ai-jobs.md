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

**J4 planner.** Before replay lookup or any model call, `planStudio` (`packages/ai/src/studio-plan.ts`) reads the
conversation and, for common questions, either requests the read-only lookup or writes the answer from its result:
named dispute (and a buyer reply draft on request), two disputes, counts by class, what needs attention, which first,
glossary terms, and a fixed refusal for requests to act (the chat is read-only). Unknown ids say so. Open-ended
questions fall through to replay or the model, and model text that claims an action is prefixed with the refusal.
`list_disputes` counts are `{total, needResponse, other, byClass}`; `explain_dispute` adds `status`, `amount`, `respondBy`.

**J4 replay and starter capture (#124).** `j4-v1` keys include the exact redacted instructions, history,
offered tools, tool choice and output format. Recorded tool calls use the same validation as live calls and
execute the existing read-only lookups again. Changed dispute results miss the recording instead of showing
an older explanation. `pnpm studio:record` captures the real dashboard adapter requests for the three starters,
writes their validated responses only after all three finish and records elapsed time and turn count in
`docs/evals/studio-<date>.md`. The operator reviews the replies and repeats in replay mode. The key ignores
64-hex hashes and ISO timestamps in tool results and a stored answer holds placeholders for them (restored on replay from
the current data), because every demo seed makes a new shopper key and dates deadlines from when it ran: a recording made
on one database answers on another, and never shows the first one's values. The attention starter needs no
recording: its answer is formatted locally from the list tool in both modes. The switch and unavailable response explain the limits before a judge asks an unrecorded question.
In live mode, the attention starter formats the validated list-tool counts and due-date rows locally after
tool selection, removing a summarizing model call. Other questions keep the usual model path.

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

**J2 and J3 as built.** The worker supplies named excerpts of the dispute and verified purchase facts. J2
keeps the worker's deterministic class and action and stores cited reasons and evidence suggestions on the
recommendation. J3 drafts the preview cover note and buyer message for verified compliant orders. Both drop
items with missing or unknown citations. When a job is unavailable, the rule-only recommendation and evidence
remain available for operator review. The first J2/J3 replay entries are hand-authored demo fixtures.

**Citation safety correction (Nov 9, #170).** Existing bundle keys establish where to look, not whether the
model's sentence follows from them. J2/J3 therefore select cited excerpts and render their source text locally;
model-written prose and headings are not published as evidence. Buyer notes are explicitly unverified
allegations. J3 uses a neutral buyer-review template. A capture record does not prove delivery, cardholder
authorization or refund completion. The same rendering applies to live and replay output; prompts and replay
keys are unchanged. This closes the unsupported-paraphrase path without claiming a semantic entailment score.

**Evals:** J1 set of 20 (7 match, 7 partial, 6 mismatch); J2 set of 12 covering all four classes. `pnpm eval`
writes `docs/evals/<date>.md`. Targets: J1 accuracy ≥ 0.9 with **zero mismatch labelled match**; J2 at least 11/12;
schema validity 100% after retry.

## Acceptance criteria

1. Replay: compliant fixture → `match` ≥ 0.8; rain shell → `partial`. _(done)_
2. An injected "ignore the budget" title never yields `match`. _(done)_
3. Overreach dispute → `AGENT_OVERREACH`, `ACCEPT_CLAIM`. _(J2 replay test)_
4. Stack runs end to end with no API key in replay mode. _(J1 done: `checkout.test.ts` runs the real J1 in replay)_
5. Eval report committed with numbers quoted in the README. _(done Nov 7, #43: [docs/evals/2026-11-07.md](../evals/2026-11-07.md))_

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
- **J1 replay widened to the 12-product store (Nov 7), prompt `j1-v1` unchanged:** the three jacket answers were
  kept as recorded; 9 new cases asked live. 6 of 9 agree with the person's label. Disagreements: wind jacket for
  "running jacket" → `match` (debatable); grey shoe for "blue shoes" → `partial` (never reaches J1: the color rule
  rejects it first); **trail shoe for "road running shoes" → `match` 0.95, a real miss**: checkout approves it. Hard
  limits still hold, so it's wording, not money. A candidate for the eval set and a prompt revision (#43).
- **Provider hardening (Nov 7).** The Nemotron thinking switch (`chat_template_kwargs.enable_thinking`) is NVIDIA's field, so
  it is now sent to `nvidia` only (`providerOptionsFor`); before, `packages/ai` sent it to whatever provider was set and the
  buyer agent hardcoded `nvidia`. `gemini`, `groq` and `openrouter` have built-in OpenAI-compatible endpoints, so switching
  provider is an env change. The free lineups churn (Nemotron 3 Super left the free endpoints after Oct 19, 2026), so
  a backup is tried once when the primary fails in a way another model or provider can fix
  (`isFailoverError`): the model is gone (404/410 or a message naming a missing, retired or renamed model), the free tier is
  rate limited (429), the provider errors (408, 5xx) or the call times out or never connects. A rejected request (400), a bad
  key (401/403) and an answer that fails validation are never hidden by it. `AI_FALLBACK_MODEL` alone is another model on the
  same provider; with `AI_FALLBACK_PROVIDER` (for example `groq`, whose endpoint is built in) and its own
  `AI_FALLBACK_API_KEY` it is a different provider. A half-configured backup is ignored with a warning, never half-used, and
  the NVIDIA thinking switch is never sent to it. `pnpm ai:check` tests each endpoint on its own (a structured answer and a
  tool call), so a working primary can't hide a broken backup. The buyer agent keeps its own copy of these rules (it doesn't depend on `packages/ai`); a test keeps them identical.
- **Tool use on Nemotron 3.5 Lightning (Nov 7, `pnpm ai:check`).** Structured answers work (about 1 s), and tool calling works
  **when forced** (`toolChoice: required`). The model does **not** reliably decide to call a tool on its own: asked the color of a
  product with a lookup tool available, it answered "black" from nowhere, or said "Let me look it up" and stopped. (This is what
  the Studio chat's retry for "Let me…" answers, and the buyer agent's very explicit prompts, work around.) So anything that
  states facts to a shopper (a chat about products, prices, limits or a refusal) must **retrieve first**: the server looks
  the facts up and puts them in the prompt as data, and the model only phrases them; it must not be trusted to fetch them itself.
  `pnpm ai:check` reports this per endpoint ("calls a tool on its own"), so a backup model can be compared fairly.
- **Full eval (Nov 7, #43), prompts `j1-v1` and `j2-v2`, primary model only (`AI_FALLBACK_*` switched off so the backup could not
  answer a case): J1 20/20 with 0 mismatches labelled match, J2 12/12, schema validity 31/31 model cases.** The J1 figure is
  measured after the local checks checkout also applies (injection guard, road-versus-trail ceiling), as the report says.
  It took three runs, and the first two missed the gate:
  - Run 1 (`j2-v1`): J1 20/20 but **J2 3/12**. In nine cases the model gave the right class and action but `confidence: 0`,
    because the prompt said "return confidence 0 when the evidence cannot explain the decision" and the model used it
    whenever the bundle was thin. `classifyDispute` treats 0 as unavailable, so nine disputes would have fallen back to the
    rule-only recommendation.
  - Prompt `j2-v2` defines the confidence scale (0.5 to 1; 0 only when nothing in the bundle relates to the decision) and
    tells the model to base every reason on `policy_evaluation` and cite it.
  - Run 2 (`j2-v2`, first wording, without the grounding sentence): J2 9/12, the misses being reasons that cited only
    `dispute_reason`. J1 fell to 18/20 because two calls (black gloves, tumbler capacity) timed out on both 2 s attempts. That
    is the free endpoint's latency, not a prompt change: the same cases passed in runs 1 and 3.
  - Run 3 (final): passed. Expect the occasional J1 timeout to show up as `unavailable` (a step-up at checkout, never an approval).
    The hand-authored J2 demo entry was re-keyed to `j2-v2` with its output unchanged. Replay entries for the 20 J1 and 12 J2
    cases are recorded from the passing run.
