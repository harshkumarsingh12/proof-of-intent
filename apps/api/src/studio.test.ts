import { createMockClient } from "@poi/paypal";
import { expect, test } from "vitest";
import { buildApp } from "./app";

test("Studio authenticates the operator and projects only read-only PayPal fields", async () => {
  const paypal = createMockClient();
  paypal.seedDispute({
    dispute_id: "PP-CASE-1",
    status: "WAITING_FOR_SELLER_RESPONSE",
    disputed_transactions: [{ items: [{ notes: "Private note" }] }],
  });
  const app = buildApp({ paypal, operatorToken: "test-only", aiMode: "replay" });
  const post = (payload: object, token = "test-only") =>
    app.inject({ method: "POST", url: "/ai/studio", headers: { authorization: `Bearer ${token}` }, payload });
  try {
    expect((await post({ kind: "tool", tool: "list_disputes" }, "wrong")).statusCode).toBe(401);
    const listed = await post({ kind: "tool", tool: "list_disputes" });
    expect(listed.json()).toEqual({ disputes: [{ id: "PP-CASE-1", status: "WAITING_FOR_SELLER_RESPONSE" }] });
    const found = await post({ kind: "tool", tool: "get_dispute", disputeId: "PP-CASE-1" });
    expect(found.json()).toEqual({ id: "PP-CASE-1", status: "WAITING_FOR_SELLER_RESPONSE" });
    expect((await post({ kind: "tool", tool: "get_dispute", disputeId: "PP-UNKNOWN" })).statusCode).toBe(404);
    const turn = await post({
      kind: "turn",
      history: [{ role: "user", text: "Explain the dispute" }],
      instructions: "",
      tools: [],
    });
    expect(turn.statusCode).toBe(503);
    expect(turn.json().error).toBe("studio_ai_unavailable");
    expect(paypal.disputeActions).toEqual([]);
  } finally {
    await app.close();
  }
});
