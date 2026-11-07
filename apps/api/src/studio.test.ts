import { createMockClient } from "@poi/paypal";
import { expect, test } from "vitest";
import { buildApp } from "./app";
import { memoryDb } from "./test-helpers";

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
    expect(turn.headers["x-poi-ai-mode"]).toBe("replay");
    expect(turn.headers["x-poi-ai-prompt-version"]).toBe("j4-v1");
    expect(turn.json().error).toBe("studio_ai_unavailable");
    expect(turn.json().message).toContain("Replay has no valid recorded answer");
    expect(paypal.disputeActions).toEqual([]);
  } finally {
    await app.close();
  }
});

test("with a database the chat's list_disputes reads our table: class, action, amount, deadline and who owes the next move", async () => {
  const mem = memoryDb();
  const rec = (cls: string, action: string) => ({
    class: cls,
    action,
    reasons: [],
    constraintChecks: [{ name: "amount_max", passed: cls === "MANDATE_COMPLIANT" }],
  });
  await mem.db.saveDispute({
    id: "PP-D-LATER",
    status: "RESOLVED",
    amountValue: 7400,
    currency: "USD",
    sellerResponseDueDate: "2026-12-01T00:00:00.000Z",
    paypal: {},
    recommendation: rec("MANDATE_COMPLIANT", "PROVIDE_EVIDENCE"),
  });
  await mem.db.saveDispute({
    id: "PP-D-SOON",
    status: "WAITING_FOR_SELLER_RESPONSE",
    amountValue: 9550,
    currency: "USD",
    sellerResponseDueDate: "2026-11-09T00:00:00.000Z",
    paypal: {},
    recommendation: rec("AGENT_OVERREACH", "ACCEPT_CLAIM"),
  });
  await mem.db.saveDispute({ id: "PP-D-NEW", paypal: {} }); // not analysed yet
  const app = buildApp({ paypal: createMockClient(), db: mem.db, operatorToken: "t", aiMode: "replay" });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/ai/studio",
      headers: { authorization: "Bearer t" },
      payload: { kind: "tool", tool: "list_disputes" },
    });
    const body = res.json() as { counts: Record<string, number>; disputes: Record<string, unknown>[] };
    const { disputes } = body;
    expect(body.counts).toEqual({ total: 3, needResponse: 1, other: 2 });
    expect(disputes[0]?.id).toBe("PP-D-SOON"); // waiting for the merchant comes first
    const by = Object.fromEntries(disputes.map((d) => [d.id as string, d]));
    expect(by["PP-D-SOON"]).toEqual({
      id: "PP-D-SOON",
      status: "WAITING_FOR_SELLER_RESPONSE",
      needsResponse: true,
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      amount: "USD 95.50",
      respondBy: "2026-11-09T00:00:00.000Z",
    });
    expect(by["PP-D-LATER"]).toMatchObject({ needsResponse: false, class: "MANDATE_COMPLIANT" });
    expect(by["PP-D-NEW"]).toEqual({ id: "PP-D-NEW", needsResponse: false }); // no analysis to report yet
    expect(JSON.stringify(res.json())).not.toMatch(/paypal|notes/i);
  } finally {
    await app.close();
  }
});

test("the buyer draft comes with a note telling the model to quote it and that nothing was sent", async () => {
  const mem = memoryDb();
  await mem.db.saveDispute({
    id: "PP-D-1",
    paypal: {},
    recommendation: {
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      reasons: [],
      constraintChecks: [{ name: "amount_max", passed: false }],
    },
  });
  const app = buildApp({ paypal: createMockClient(), db: mem.db, operatorToken: "t", aiMode: "replay" });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/ai/studio",
      headers: { authorization: "Bearer t" },
      payload: { kind: "tool", tool: "draft_buyer_message", disputeId: "PP-D-1" },
    });
    expect(res.json()).toMatchObject({ id: "PP-D-1", sent: false });
    expect((res.json() as { note: string }).note).toMatch(/quote this draft/i);
  } finally {
    await app.close();
  }
});

test("the chat list is capped and still counts every dispute, soonest deadline first", async () => {
  const mem = memoryDb();
  for (let i = 1; i <= 30; i++) {
    await mem.db.saveDispute({
      id: `PP-D-${String(i).padStart(2, "0")}`,
      status: "WAITING_FOR_SELLER_RESPONSE",
      amountValue: 1000 + i,
      currency: "USD",
      // later ids are due sooner
      sellerResponseDueDate: new Date(Date.UTC(2026, 10, 30 - i)).toISOString(),
      paypal: {},
    });
  }
  const app = buildApp({ paypal: createMockClient(), db: mem.db, operatorToken: "t", aiMode: "replay" });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/ai/studio",
      headers: { authorization: "Bearer t" },
      payload: { kind: "tool", tool: "list_disputes" },
    });
    const body = res.json() as {
      counts: { total: number; needResponse: number };
      disputes: { id: string }[];
      note: string;
    };
    expect(body.counts).toMatchObject({ total: 30, needResponse: 30 });
    expect(body.disputes).toHaveLength(12);
    expect(body.disputes[0]?.id).toBe("PP-D-30");
    expect(body.note).toMatch(/12 of 30/);
  } finally {
    await app.close();
  }
});
