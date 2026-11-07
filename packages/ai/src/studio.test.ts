import { afterEach, expect, test, vi } from "vitest";
import * as runtime from "./runtime";
import type { Generate, GenerateRequest } from "./runtime";
import {
  ATTENTION_STARTER_PROMPT,
  backtickCodes,
  J4_REPLAY,
  recordableAnswer,
  runStudioTurn,
  studioReplayKey,
  type StudioTurn,
} from "./studio";

afterEach(() => vi.restoreAllMocks());

// An open-ended question the planner (studio-plan.ts) doesn't recognise, so these tests exercise the model path and its
// safeguards. Questions that name a dispute, or ask for counts or what needs attention, are answered by the planner.
const LIST_TOOL = [{ name: "list_disputes", description: "Lists disputes", parameters: {} }];
const FREE_FORM = "Walk me through what is going on with these disputes, in plain words.";

const turn: StudioTurn = {
  kind: "turn",
  instructions: "Explain using the tool results.",
  history: [
    { role: "user", text: FREE_FORM },
    { role: "tool", text: "contact private@example.com" },
  ],
  tools: [{ name: "explain_dispute", description: "Reads a policy result", parameters: {} }],
};

test("Studio replays the recorded turn without a provider and refuses changed questions, data or tools", async () => {
  const recorded = { text: "", tool: { name: "explain_dispute", arguments: '{"disputeId":"PP-D-1001"}' } };
  const replay = vi.spyOn(runtime, "readReplay").mockReturnValue({
    [studioReplayKey(turn)]: { label: "defended starter", output: recorded },
  });
  const generate = vi.fn();
  await expect(runStudioTurn(turn, "replay", generate)).resolves.toEqual(recorded);
  expect(replay).toHaveBeenCalledWith(J4_REPLAY);
  expect(generate).not.toHaveBeenCalled();
  for (const changed of [
    { ...turn, history: [{ role: "user" as const, text: "A different question" }] },
    { ...turn, history: [...turn.history, { role: "tool" as const, text: "Changed dispute findings" }] },
    { ...turn, tools: [] },
    { ...turn, instructions: "Changed instructions" },
  ]) {
    await expect(runStudioTurn(changed, "replay", generate)).rejects.toThrow("no recorded answer");
  }
  replay.mockReturnValue({ [studioReplayKey(turn)]: { label: "invalid", output: { text: 123 } } });
  await expect(runStudioTurn(turn, "replay")).rejects.toThrow("no recorded answer");
  replay.mockReturnValue({
    [studioReplayKey(turn)]: {
      label: "unavailable tool",
      output: { text: "", tool: { name: "accept_claim", arguments: "{}" } },
    },
  });
  await expect(runStudioTurn(turn, "replay")).rejects.toThrow("requested tool is unavailable");
});

test("Studio replay hashes the redacted input and retains the exact dispute facts", () => {
  expect(studioReplayKey({ ...turn, instructions: "Email private@example.com" })).toBe(
    studioReplayKey({ ...turn, instructions: "Email [email]" }),
  );
  expect(
    studioReplayKey({ ...turn, history: [{ role: "tool", text: "PP-D-1002 AGENT_OVERREACH" }] }),
  ).not.toBe(studioReplayKey({ ...turn, history: [{ role: "tool", text: "PP-D-1002 MANDATE_COMPLIANT" }] }));
});

test("the attention starter formats the list facts with no additional model calls", async () => {
  const listed: StudioTurn = {
    ...turn,
    tools: [{ name: "list_disputes", description: "Lists disputes", parameters: {} }],
    history: [
      { role: "user", text: "List the disputes and tell me which ones are waiting for my response." },
      { role: "assistant", text: "Called list_disputes with {}" },
      {
        role: "tool",
        text: JSON.stringify({
          counts: { total: 24, needResponse: 13 },
          disputes: [
            {
              id: "PP-D-1002",
              needsResponse: true,
              class: "AGENT_OVERREACH",
              amount: "USD 95.00",
              respondBy: "2026-11-17T00:00:00.000Z",
            },
          ],
        }),
      },
    ],
  };
  const generate = vi.fn();
  const out = await runStudioTurn(listed, "live", generate);
  expect(out.tool).toBeNull();
  expect(out.text).toContain("13 of 24 loaded disputes need your response");
  expect(out.text).toContain("`PP-D-1002` · `AGENT_OVERREACH` · USD 95.00");
  expect(out.text).toContain("respond by 2026-11-17 00:00 UTC");
  expect(out.text).toContain("Showing 1 of the 13");
  expect(generate).not.toHaveBeenCalled();

  // The real dashboard harness wraps the JSON string in ctx.success's envelope.
  const wrappedHistory = [
    ...listed.history.slice(0, -1),
    {
      role: "tool" as const,
      text: JSON.stringify({ success: true, response: listed.history.at(-1)!.text }),
    },
  ];
  await expect(runStudioTurn({ ...listed, history: wrappedHistory }, "live", generate)).resolves.toEqual(out);
  expect(generate).not.toHaveBeenCalled();

  // A different question or malformed tool result still goes through the regular live turn.
  const model: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({ text: "A model answer", tool: null });
  for (const history of [
    [{ role: "user" as const, text: "Compare dispute amounts" }, ...listed.history.slice(1)],
    [...listed.history.slice(0, -1), { role: "tool" as const, text: "invalid JSON" }],
    [
      ...listed.history.slice(0, -1),
      { role: "tool" as const, text: '{"counts":{"total":0,"needResponse":5},"disputes":[]}' },
    ],
  ]) {
    await expect(runStudioTurn({ ...listed, history }, "live", model)).resolves.toMatchObject({
      text: "A model answer",
    });
  }
});

test("Studio validates a turn and never allows a model to invent a tool", async () => {
  const model: Generate = async <T>({ schema, prompt }: GenerateRequest<T>) => {
    expect(prompt).not.toContain("private@example.com");
    return schema.parse({ text: "", tool: { name: "accept_claim", arguments: "{}" } });
  };
  await expect(runStudioTurn(turn, "live", model)).rejects.toThrow("requested tool is unavailable");
  const valid: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({
      text: "",
      tool: { name: "explain_dispute", arguments: '{"disputeId":"PP-D-1001"}' },
    });
  await expect(runStudioTurn(turn, "live", valid)).resolves.toMatchObject({
    tool: { name: "explain_dispute" },
  });
});

test("a reply that only announces a step is retried once, whether or not a tool ran, and a real answer is left alone", async () => {
  const prompts: string[] = [];
  const announcing: Generate = async <T>({ schema, system }: GenerateRequest<T>) => {
    prompts.push(system);
    return schema.parse(
      prompts.length === 1
        ? { text: "I'll help you analyze this dispute. Let me start by examining the data.", tool: null }
        : { text: "", tool: { name: "explain_dispute", arguments: '{"disputeId":"PP-D-1002"}' } },
    );
  };
  const first: StudioTurn = { ...turn, history: [{ role: "user", text: FREE_FORM }] };
  await expect(runStudioTurn(first, "live", announcing)).resolves.toMatchObject({
    tool: { name: "explain_dispute" },
  });
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("announced a step");

  // Announcing the next step right after a tool result is retried too.
  const afterTool: Generate = async <T>({ schema, system }: GenerateRequest<T>) =>
    schema.parse(
      system.includes("announced a step")
        ? { text: "", tool: { name: "explain_dispute", arguments: '{"disputeId":"PP-D-1002"}' } }
        : { text: "Let me start by examining the dispute details.", tool: null },
    );
  await expect(runStudioTurn(turn, "live", afterTool)).resolves.toMatchObject({
    tool: { name: "explain_dispute" },
  });

  // A real summary after a tool result is the answer: no retry.
  let calls = 0;
  const answering: Generate = async <T>({ schema }: GenerateRequest<T>) => {
    calls++;
    return schema.parse({ text: "Let me summarise: the cart broke the price and color limits.", tool: null });
  };
  await expect(runStudioTurn(turn, "live", answering)).resolves.toMatchObject({ tool: null });
  expect(calls).toBe(1);

  // A plain answer to a plain question is not retried either.
  calls = 0;
  const plain: Generate = async <T>({ schema }: GenerateRequest<T>) => {
    calls++;
    return schema.parse({ text: "Northstar has the most disputes.", tool: null });
  };
  await expect(runStudioTurn(first, "live", plain)).resolves.toMatchObject({ tool: null });
  expect(calls).toBe(1);
});

test("tool arguments sent as an object are accepted and returned as a JSON string", async () => {
  const objectArgs: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({ text: "", tool: { name: "explain_dispute", arguments: { disputeId: "PP-D-1002" } } });
  const out = await runStudioTurn(turn, "live", objectArgs);
  expect(out.tool).toEqual({ name: "explain_dispute", arguments: '{"disputeId":"PP-D-1002"}' });
  const notObject: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({ text: "", tool: { name: "explain_dispute", arguments: "[1,2]" } });
  await expect(runStudioTurn(turn, "live", notObject)).rejects.toThrow("tool arguments were invalid");
});

test("text that tells the user to run a supplied tool is retried once instead of ending the turn", async () => {
  const first: StudioTurn = { ...turn, history: [{ role: "user", text: FREE_FORM }] };
  let calls = 0;
  const model: Generate = async <T>({ schema }: GenerateRequest<T>) => {
    calls++;
    return schema.parse(
      calls === 1
        ? { text: "Please run the explain_dispute tool to see the dispute fields.", tool: null }
        : { text: "", tool: { name: "explain_dispute", arguments: { disputeId: "PP-D-1002" } } },
    );
  };
  await expect(runStudioTurn(first, "live", model)).resolves.toMatchObject({
    tool: { name: "explain_dispute" },
  });
  expect(calls).toBe(2);
});

test("an identical repeat of an earlier tool call is retried without that tool", async () => {
  const tools = [
    { name: "view_schema", description: "Reads the data schema", parameters: {} },
    { name: "delegate_to", description: "Hands a task to another agent", parameters: {} },
  ];
  const looping: StudioTurn = {
    kind: "turn",
    instructions: "Lead agent.",
    history: [
      { role: "user", text: FREE_FORM },
      { role: "assistant", text: "Called view_schema with {}" },
      { role: "tool", text: "schema" },
    ],
    tools,
  };
  const offered: string[][] = [];
  const model: Generate = async <T>({ schema, prompt }: GenerateRequest<T>) => {
    offered.push([...prompt.matchAll(/"name": "(\w+)"/g)].map((m) => m[1]!));
    return schema.parse(
      offered.length === 1
        ? { text: "", tool: { name: "view_schema", arguments: {} } }
        : { text: "", tool: { name: "delegate_to", arguments: { agent: "DisputeExplainer" } } },
    );
  };
  await expect(runStudioTurn(looping, "live", model)).resolves.toMatchObject({
    tool: { name: "delegate_to" },
  });
  expect(offered[0]).toEqual(["view_schema", "delegate_to"]);
  expect(offered[1]).toEqual(["delegate_to"]);

  // A different tool, or the same tool with new arguments, is not a loop.
  let calls = 0;
  const fresh: Generate = async <T>({ schema }: GenerateRequest<T>) => {
    calls++;
    return schema.parse({ text: "", tool: { name: "view_schema", arguments: { table: "disputes" } } });
  };
  await expect(runStudioTurn(looping, "live", fresh)).resolves.toMatchObject({
    tool: { name: "view_schema" },
  });
  expect(calls).toBe(1);
});

test("a model that keeps repeating a call is made to answer from the results it has", async () => {
  const looping: StudioTurn = {
    kind: "turn",
    instructions: "Dispute agent.",
    history: [
      { role: "user", text: FREE_FORM },
      { role: "assistant", text: 'Called draft_buyer_message with {"disputeId":"PP-D-1002"}' },
      { role: "tool", text: '{"draft":"Our review found that the purchase exceeded your limits."}' },
    ],
    tools: [
      { name: "explain_dispute", description: "Reads a policy result", parameters: {} },
      { name: "draft_buyer_message", description: "Reads a draft", parameters: {} },
    ],
  };
  let calls = 0;
  const stubborn: Generate = async <T>({ schema, system }: GenerateRequest<T>) => {
    calls++;
    return schema.parse(
      system.includes("Answer the user now")
        ? { text: "Draft for review: our review found the purchase exceeded your limits.", tool: null }
        : { text: "", tool: { name: "draft_buyer_message", arguments: { disputeId: "PP-D-1002" } } },
    );
  };
  const out = await runStudioTurn(looping, "live", stubborn);
  expect(out).toMatchObject({ tool: null });
  expect(out.text).toContain("Draft for review");
  expect(calls).toBe(3); // the repeat, the retry that repeated again, then the forced answer

  // One that will not answer at all gets the tool's own result shown instead of an error.
  const never: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({ text: "", tool: { name: "draft_buyer_message", arguments: { disputeId: "PP-D-1002" } } });
  const fallback = await runStudioTurn(looping, "live", never);
  expect(fallback.tool).toBeNull();
  expect(fallback.text).toContain("Our review found that the purchase exceeded your limits");
});

test("codes in the chat answer are wrapped in backticks so markdown keeps their underscores", async () => {
  expect(backtickCodes("PP-D-1002 is AGENT_OVERREACH; amount_max and attributes.color broke.")).toBe(
    "PP-D-1002 is `AGENT_OVERREACH`; `amount_max` and attributes.color broke.",
  );
  // Already wrapped, plain words, ids with hyphens and a 64-character hash are left alone.
  expect(
    backtickCodes("It is `ACCEPT_CLAIM` and hello world, case PP-R-ABC-10196871, hash b6e196ee208d71ce."),
  ).toBe("It is `ACCEPT_CLAIM` and hello world, case PP-R-ABC-10196871, hash b6e196ee208d71ce.");
  const model: Generate = async <T>({ schema }: GenerateRequest<T>) =>
    schema.parse({ text: "The class is MANDATE_COMPLIANT.", tool: null });
  const first: StudioTurn = { ...turn, history: [{ role: "user", text: FREE_FORM }] };
  await expect(runStudioTurn(first, "live", model)).resolves.toMatchObject({
    text: "The class is `MANDATE_COMPLIANT`.",
    tool: null,
  });
});

// Two seeded databases hold the same disputes but differ in every mandate hash (the seed makes a new shopper key
// each run) and in every deadline (relative to when it ran). A recording must answer on both.
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const explainTurn = (hash: string, respondBy: string): StudioTurn => ({
  ...turn,
  history: [
    { role: "user", text: FREE_FORM },
    { role: "assistant", text: "Called explain_dispute with PP-D-1001" },
    {
      role: "tool",
      text: JSON.stringify({ id: "PP-D-1001", class: "MANDATE_COMPLIANT", mandateHash: hash, respondBy }),
    },
  ],
});

test("a recording is keyed on the facts, not on the hashes and timestamps that change per seeded database", () => {
  const a = explainTurn(HASH_A, "2026-11-07T12:00:00.000Z");
  const b = explainTurn(HASH_B, "2026-11-07T15:00:00.000Z");
  expect(studioReplayKey(a)).toBe(studioReplayKey(b));
  // ...while a changed fact still misses, including a different class, a different id and a different structure.
  const changed = (text: string) => ({
    ...a,
    history: [...a.history.slice(0, 2), { role: "tool" as const, text }],
  });
  expect(studioReplayKey(a)).not.toBe(
    studioReplayKey(
      changed(
        JSON.stringify({
          id: "PP-D-1001",
          class: "AGENT_OVERREACH",
          mandateHash: HASH_A,
          respondBy: "2026-11-07T12:00:00.000Z",
        }),
      ),
    ),
  );
  expect(studioReplayKey(a)).not.toBe(
    studioReplayKey(
      changed(
        JSON.stringify({
          id: "PP-D-1009",
          class: "MANDATE_COMPLIANT",
          mandateHash: HASH_A,
          respondBy: "2026-11-07T12:00:00.000Z",
        }),
      ),
    ),
  );
  // Two different hashes stay distinct from one repeated hash: placeholders keep the structure.
  expect(studioReplayKey(changed(`${HASH_A} ${HASH_B}`))).not.toBe(
    studioReplayKey(changed(`${HASH_A} ${HASH_A}`)),
  );
});

test("a recorded answer shows the current database's own hash and times, including a hash the model shortened", async () => {
  const a = explainTurn(HASH_A, "2026-11-07T12:00:00.000Z");
  const live = {
    text: `PP-D-1001 is defended. Mandate \`${HASH_A}\` (short form ${HASH_A.slice(0, 12)}…), respond by 2026-11-07T12:00:00.000Z.`,
    tool: null,
  };
  const stored = recordableAnswer(a, live);
  expect(stored.text).not.toContain(HASH_A.slice(0, 8));
  expect(stored.text).not.toContain("2026-11-07");

  vi.spyOn(runtime, "readReplay").mockReturnValue({
    [studioReplayKey(a)]: { label: "defended", output: stored },
  });
  const b = explainTurn(HASH_B, "2026-11-07T15:00:00.000Z");
  const out = await runStudioTurn(b, "replay", vi.fn());
  expect(out.text).toContain(`\`${HASH_B}\``);
  expect(out.text).toContain(`${HASH_B.slice(0, 12)}…`);
  expect(out.text).toContain("respond by 2026-11-07T15:00:00.000Z");
  expect(out.text).not.toContain(HASH_A.slice(0, 8));
  // The same database gets exactly what was said.
  expect((await runStudioTurn(a, "replay", vi.fn())).text).toContain(`\`${HASH_A}\``);
});

test("a recording that needs a value the data doesn't have is unavailable, not a guess", async () => {
  const a = explainTurn(HASH_A, "2026-11-07T12:00:00.000Z");
  vi.spyOn(runtime, "readReplay").mockReturnValue({
    [studioReplayKey(a)]: { label: "x", output: { text: "Mandate ⟦9⟧", tool: null } },
  });
  await expect(runStudioTurn(a, "replay", vi.fn())).rejects.toThrow("needs a value this data lacks");
});

test("the attention starter answers in replay mode with no recording, from the current data's own deadlines", async () => {
  const history = (respondBy: string): StudioTurn["history"] => [
    { role: "user", text: ATTENTION_STARTER_PROMPT },
    { role: "assistant", text: "Called list_disputes with {}" },
    {
      role: "tool",
      text: JSON.stringify({
        counts: { total: 24, needResponse: 1 },
        disputes: [
          {
            id: "PP-D-1001",
            needsResponse: true,
            class: "MANDATE_COMPLIANT",
            amount: "USD 74.00",
            respondBy,
          },
        ],
      }),
    },
  ];
  vi.spyOn(runtime, "readReplay").mockReturnValue({}); // nothing recorded
  const generate = vi.fn();
  const early = await runStudioTurn(
    { ...turn, tools: LIST_TOOL, history: history("2026-11-07T12:00:00.000Z") },
    "replay",
    generate,
  );
  const late = await runStudioTurn(
    { ...turn, tools: LIST_TOOL, history: history("2026-12-01T09:30:00.000Z") },
    "replay",
    generate,
  );
  expect(early.text).toContain("respond by 2026-11-07 12:00 UTC");
  expect(late.text).toContain("respond by 2026-12-01 09:30 UTC");
  expect(generate).not.toHaveBeenCalled();
  // Any other question still needs a recording in replay mode.
  await expect(
    runStudioTurn({ ...turn, history: [{ role: "user", text: "Something unrecorded" }] }, "replay", generate),
  ).rejects.toThrow("no recorded answer");
});
