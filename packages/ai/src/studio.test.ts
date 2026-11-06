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
