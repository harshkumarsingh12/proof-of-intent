import { expect, test } from "vitest";
import type { Generate, GenerateRequest } from "./runtime";
import { runStudioTurn, type StudioTurn } from "./studio";

const turn: StudioTurn = {
  kind: "turn",
  instructions: "Explain using the tool results.",
  history: [
    { role: "user", text: "Explain PP-D-1001" },
    { role: "tool", text: "contact private@example.com" },
  ],
  tools: [{ name: "explain_dispute", description: "Reads a policy result", parameters: {} }],
};

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
  const first: StudioTurn = { ...turn, history: [{ role: "user", text: "Explain PP-D-1002" }] };
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
  const first: StudioTurn = { ...turn, history: [{ role: "user", text: "Explain PP-D-1002" }] };
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
      { role: "user", text: "Explain PP-D-1002" },
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
      { role: "user", text: "Draft a reply for PP-D-1002" },
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
