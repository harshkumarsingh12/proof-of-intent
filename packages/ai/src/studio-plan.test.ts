import { describe, expect, test } from "vitest";
import type { Generate, GenerateRequest } from "./runtime";
import { runStudioTurn, type StudioTurn } from "./studio";
import { STUDIO_CANT_ACT, claimsAnAction, disputeIdsIn, planStudio, readConversation } from "./studio-plan";

// Results shaped like the real tool endpoints (apps/api/src/routes/studio.ts), wrapped the way ag-studio wraps them.
const ok = (data: unknown) => JSON.stringify({ success: true, response: JSON.stringify(data) });
const failed = (message: string) => JSON.stringify({ success: false, issues: [{ message }] });

const HASH = "4f58b757a3c8c517a1cba5b767022040bf2375b8579e3028eec8e22bcc47682c";
const explainResults: Record<string, unknown> = {
  "PP-D-1001": {
    id: "PP-D-1001",
    class: "MANDATE_COMPLIANT",
    action: "PROVIDE_EVIDENCE",
    reasons: [],
    failedChecks: [],
    mandateHash: HASH,
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: "USD 74.00",
    respondBy: "2026-11-07T18:25:48.496Z",
  },
  "PP-D-1002": {
    id: "PP-D-1002",
    class: "AGENT_OVERREACH",
    action: "ACCEPT_CLAIM",
    reasons: ["AMOUNT_EXCEEDS_MAX", "ATTRIBUTE_MISMATCH"],
    failedChecks: ["amount_max", "attributes.color"],
    status: "WAITING_FOR_SELLER_RESPONSE",
    amount: "USD 95.00",
    respondBy: "2026-11-07T19:25:48.496Z",
  },
  "PP-D-1007": {
    id: "PP-D-1007",
    class: "AGENT_OVERREACH",
    action: "ACCEPT_CLAIM",
    reasons: ["ATTRIBUTE_MISMATCH"],
    failedChecks: ["attributes.color"],
  },
};
const DRAFT = "Our review found that the purchase exceeded or conflicted with the instructions you signed.";

// 24 disputes: 19 compliant, 5 overreach (1002, 1007, 1012, 1017, 1022); 17 need a response; 12 rows are returned.
const row = (n: number, cls: string, needs: boolean, amount: string) => ({
  id: `PP-D-${1000 + n}`,
  status: needs ? "WAITING_FOR_SELLER_RESPONSE" : "RESOLVED",
  needsResponse: needs,
  class: cls,
  action: cls === "AGENT_OVERREACH" ? "ACCEPT_CLAIM" : "PROVIDE_EVIDENCE",
  amount,
  respondBy: `2026-11-07T${String(17 + (n % 6)).padStart(2, "0")}:25:00.000Z`,
});
const listResult = {
  counts: { total: 24, needResponse: 17, other: 7, byClass: { MANDATE_COMPLIANT: 19, AGENT_OVERREACH: 5 } },
  disputes: [
    row(1, "MANDATE_COMPLIANT", true, "USD 74.00"),
    row(2, "AGENT_OVERREACH", true, "USD 95.00"),
    row(3, "MANDATE_COMPLIANT", true, "USD 58.00"),
    row(7, "AGENT_OVERREACH", true, "USD 32.00"),
  ],
};

const tools = ["explain_dispute", "draft_buyer_message", "list_disputes", "get_dispute"].map((name) => ({
  name,
  description: name,
  parameters: {},
}));

interface Run {
  calls: string[];
  text: string;
  turns: number;
}

/**
 * The chat's loop, with the planner as the only brain: ask, run the tool it names against these results, feed the result
 * back, and stop at its answer. Replay mode and a generator that fails the test prove no model is involved.
 */
async function converse(
  question: string,
  opts: {
    list?: unknown;
    explain?: Record<string, unknown>;
    drafts?: boolean;
    before?: StudioTurn["history"];
  } = {},
): Promise<Run> {
  const noModel: Generate = async () => {
    throw new Error("a model was called for a question the planner should answer");
  };
  const history: StudioTurn["history"] = [...(opts.before ?? []), { role: "user", text: question }];
  const calls: string[] = [];
  for (let turns = 1; turns <= 8; turns++) {
    const out = await runStudioTurn({ kind: "turn", instructions: "", history, tools }, "replay", noModel);
    if (!out.tool) return { calls, text: out.text, turns };
    const sent =
      typeof out.tool.arguments === "string" ? out.tool.arguments : JSON.stringify(out.tool.arguments);
    const args = JSON.parse(sent) as { disputeId?: string };
    calls.push(`${out.tool.name}${args.disputeId ? `(${args.disputeId})` : ""}`);
    history.push({ role: "assistant", text: `Called ${out.tool.name} with ${sent}` });
    let result: string;
    if (out.tool.name === "list_disputes") result = ok(opts.list ?? listResult);
    else if (out.tool.name === "draft_buyer_message")
      result = ok({ id: args.disputeId, draft: DRAFT, sent: false, note: "Quote this draft." });
    else {
      const data = (opts.explain ?? explainResults)[args.disputeId ?? ""];
      result = data ? ok(data) : failed("No analyzed dispute with this id");
    }
    history.push({ role: "tool", text: result });
  }
  throw new Error("the planner never finished");
}

describe("reading the conversation", () => {
  test("pairs each call with its result, reading ag-studio's success and failure wrappers", () => {
    const { question, calls } = readConversation([
      { role: "user", text: "Explain PP-D-1001" },
      { role: "assistant", text: 'Called explain_dispute with {"disputeId":"PP-D-1001"}' },
      { role: "tool", text: ok({ id: "PP-D-1001" }) },
      { role: "assistant", text: 'Called draft_buyer_message with {"disputeId":"PP-D-9"}' },
      { role: "tool", text: failed("No analyzed dispute with this id") },
    ]);
    expect(question).toBe("Explain PP-D-1001");
    expect(calls).toEqual([
      { name: "explain_dispute", args: '{"disputeId":"PP-D-1001"}', ok: true, data: { id: "PP-D-1001" } },
      {
        name: "draft_buyer_message",
        args: '{"disputeId":"PP-D-9"}',
        ok: false,
        error: "No analyzed dispute with this id",
      },
    ]);
  });

  test("only the calls since the latest question count, so a follow-up fetches again", () => {
    const { question, calls } = readConversation([
      { role: "user", text: "Explain PP-D-1001" },
      { role: "assistant", text: 'Called explain_dispute with {"disputeId":"PP-D-1001"}' },
      { role: "tool", text: ok({ id: "PP-D-1001" }) },
      { role: "assistant", text: "It is compliant." },
      { role: "user", text: "And again, please" },
    ]);
    expect(question).toBe("And again, please");
    expect(calls).toEqual([]);
  });

  test("unreadable results and unknown history lines are tolerated", () => {
    const { calls } = readConversation([
      { role: "user", text: "q" },
      { role: "assistant", text: "Called list_disputes with {}" },
      { role: "tool", text: "not json" },
    ]);
    expect(calls).toEqual([{ name: "list_disputes", args: "{}", ok: false, error: "unreadable" }]);
  });

  test("finds dispute ids in the demo's and in PayPal's forms, once each, at most two", () => {
    expect(disputeIdsIn("Explain pp-d-1001, then PP-D-1001 and PP-R-IFB-10196898 and PP-D-1003")).toEqual([
      "PP-D-1001",
      "PP-R-IFB-10196898",
    ]);
    expect(disputeIdsIn("no ids here, PPE or PP-1001")).toEqual([]);
  });
});

describe("a named dispute", () => {
  test("is explained from its own recommendation in one step, with no model", async () => {
    const r = await converse("Explain dispute PP-D-1001 and cite the available mandate evidence.");
    expect(r.calls).toEqual(["explain_dispute(PP-D-1001)"]);
    expect(r.turns).toBe(2);
    expect(r.text).toContain("`PP-D-1001` is `MANDATE_COMPLIANT`");
    expect(r.text).toContain("No limit was broken.");
    expect(r.text).toContain("submit the evidence package (`PROVIDE_EVIDENCE`)");
    expect(r.text).toContain(
      "Status: waiting for your response, respond by 2026-11-07 18:25 UTC, amount USD 74.00.",
    );
    expect(r.text).toContain(`Signed mandate: \`${HASH}\`.`);
  });

  test("an overreach says which limits broke and why, in the merchant's words", async () => {
    const r = await converse("Why is PP-D-1007 an overreach?");
    expect(r.calls).toEqual(["explain_dispute(PP-D-1007)"]);
    expect(r.text).toContain("`PP-D-1007` is `AGENT_OVERREACH`");
    expect(r.text).toContain(
      "Broken limits: color (`ATTRIBUTE_MISMATCH`: the item didn't match the shopper's color or category).",
    );
    expect(r.text).toContain("accept the claim and refund the buyer (`ACCEPT_CLAIM`)");
  });

  test("asked for a reply, it fetches the draft too, quotes it, and says nothing was sent", async () => {
    const r = await converse("Explain dispute PP-D-1002 and draft a reply for the buyer to review.");
    expect(r.calls).toEqual(["explain_dispute(PP-D-1002)", "draft_buyer_message(PP-D-1002)"]);
    expect(r.text).toContain("Broken limits: price limit, color");
    expect(r.text).toContain("`AMOUNT_EXCEEDS_MAX`: the price was above the shopper's maximum");
    expect(r.text).toContain("Draft reply for the buyer (nothing has been sent; you review it first):");
    expect(r.text).toContain(`> ${DRAFT}`);
  });

  test("two disputes are each explained, in the order asked", async () => {
    const r = await converse("Compare PP-D-1002 with PP-D-1001");
    expect(r.calls).toEqual(["explain_dispute(PP-D-1002)", "explain_dispute(PP-D-1001)"]);
    expect(r.text.indexOf("PP-D-1002")).toBeLessThan(r.text.indexOf("PP-D-1001"));
    expect(r.text).toContain("AGENT_OVERREACH");
    expect(r.text).toContain("MANDATE_COMPLIANT");
  });

  test("a resolved dispute shows no response deadline, since nothing is left to respond to", async () => {
    const resolved = {
      ...explainResults,
      "PP-D-1007": {
        ...(explainResults["PP-D-1007"] as object),
        status: "RESOLVED",
        amount: "USD 120.00",
        respondBy: "2026-11-08T00:25:00.000Z",
      },
    };
    const r = await converse("Why is PP-D-1007 an overreach?", { explain: resolved });
    expect(r.text).toContain("Status: resolved, amount USD 120.00.");
    expect(r.text).not.toContain("respond by");
  });

  test("an unknown id gets a short 'couldn't find it', not a list of other disputes", async () => {
    const r = await converse("Explain dispute PP-D-9999.");
    expect(r.calls).toEqual(["explain_dispute(PP-D-9999)"]);
    expect(r.text).toContain("I couldn't find a dispute `PP-D-9999`.");
    expect(r.text).not.toContain("PP-D-1001 ·");
    expect(r.text.length).toBeLessThan(300);
  });

  test("a follow-up about the same dispute fetches it again", async () => {
    const r = await converse("And what is the status of PP-D-1001?", {
      before: [
        { role: "user", text: "Explain PP-D-1001" },
        { role: "assistant", text: 'Called explain_dispute with {"disputeId":"PP-D-1001"}' },
        { role: "tool", text: ok({ ...(explainResults["PP-D-1001"] as object), status: "RESOLVED" }) },
        { role: "assistant", text: "It was resolved." },
      ],
    });
    expect(r.calls).toEqual(["explain_dispute(PP-D-1001)"]);
    expect(r.text).toContain("waiting for your response");
  });
});

describe("a request to act: the chat only reads", () => {
  test("'accept the claim' is refused plainly, with the recommendation underneath, and never says it did it", async () => {
    const r = await converse("Accept the claim for PP-D-1002 now.");
    expect(r.calls).toEqual(["explain_dispute(PP-D-1002)"]);
    expect(r.text.startsWith(STUDIO_CANT_ACT)).toBe(true);
    expect(r.text).toContain("accept the claim and refund the buyer (`ACCEPT_CLAIM`)");
    expect(r.text).not.toMatch(/Accepting the claim/);
    expect(claimsAnAction(r.text)).toBe(false);
  });

  test("an action with no dispute named asks which one, and calls nothing", async () => {
    for (const q of ["Refund every buyer", "Please submit the evidence", "go ahead and escalate"]) {
      const r = await converse(q);
      expect(r.calls, q).toEqual([]);
      expect(r.text, q).toContain(STUDIO_CANT_ACT);
      expect(r.text, q).toContain("Name a dispute");
    }
  });

  test("a question about an action is a question: it gets the recommendation without the refusal", async () => {
    const r = await converse("Should I accept the claim on PP-D-1002?");
    expect(r.text.startsWith(STUDIO_CANT_ACT)).toBe(false);
    expect(r.text).toContain("`ACCEPT_CLAIM`");
  });

  test("a model answer that claims an action is caught", () => {
    for (const text of [
      "I've accepted the claim for PP-D-1002.",
      "I have refunded the buyer.",
      "Accepting the claim for dispute PP-D-1002 (class AGENT_OVERREACH).",
      "We just submitted the evidence.",
    ])
      expect(claimsAnAction(text), text).toBe(true);
    for (const text of [
      "The recommended action is to accept the claim.",
      "You could accept the claim from the dispute page.",
      "Nothing was accepted or sent.",
    ])
      expect(claimsAnAction(text), text).toBe(false);
  });
});

describe("terms and counts", () => {
  test("what a class, action or reason means is answered without any tool", async () => {
    const one = await converse("What does MANDATE_COMPLIANT mean?");
    expect(one.calls).toEqual([]);
    expect(one.text).toBe(
      "`MANDATE_COMPLIANT`: the cart met every limit the shopper signed, so the merchant defends with the signed record.",
    );
    const two = await converse("What's the difference between overreach and misread?");
    expect(two.calls).toEqual([]);
    expect(two.text).toContain("`AGENT_OVERREACH`");
    expect(two.text).toContain("`INTENT_MISREAD`");
    expect((await converse("What is AMOUNT_EXCEEDS_MAX?")).text).toContain(
      "the price was above the shopper's maximum",
    );
  });

  test("how many are overreach comes from the counts over every dispute: 5, not the 7 that don't need a response", async () => {
    const r = await converse("How many disputes are agent overreach?");
    expect(r.calls).toEqual(["list_disputes"]);
    expect(r.text).toContain("There are 5 `AGENT_OVERREACH` disputes out of 24.");
    expect(r.text).not.toMatch(/\b7\b/);
    expect(r.text).toContain("`PP-D-1002`");
    expect(r.text).toContain("Showing 2 of the 5.");
  });

  test("a plain count gives the breakdown by class and who is waiting", async () => {
    const r = await converse("How many disputes are there?");
    expect(r.text).toBe(
      "24 disputes: 19 `MANDATE_COMPLIANT`, 5 `AGENT_OVERREACH`. 17 need your response; 7 don't.",
    );
    expect((await converse("How many need a response?")).text).toBe(
      "17 of 24 disputes need your response; 7 don't.",
    );
  });

  test("without counts by class a class total is not guessed: the question goes to the model", () => {
    const noClasses = { ...listResult, counts: { total: 24, needResponse: 17, other: 7 } };
    const turn: StudioTurn = {
      kind: "turn",
      instructions: "",
      tools,
      history: [
        { role: "user", text: "How many disputes are agent overreach?" },
        { role: "assistant", text: "Called list_disputes with {}" },
        { role: "tool", text: ok(noClasses) },
      ],
    };
    expect(planStudio(turn)).toBeUndefined();
  });

  test("which one first is the soonest deadline among those waiting, with the next two", async () => {
    const r = await converse("Which dispute should I handle first?");
    expect(r.calls).toEqual(["list_disputes"]);
    expect(r.text).toContain("Start with `PP-D-1001` (`MANDATE_COMPLIANT`, USD 74.00): it is due soonest");
    expect(r.text).toContain("Then:");
    expect(r.text).toContain("`PP-D-1002`");
    const none = await converse("What should I do first?", {
      list: { counts: { total: 2, needResponse: 0, other: 2, byClass: {} }, disputes: [] },
    });
    expect(none.text).toBe("Nothing is waiting for your response right now.");
  });

  test("what needs attention lists who is waiting, soonest first", async () => {
    const r = await converse("List the disputes and tell me which ones are waiting for my response.");
    expect(r.text).toContain("17 of 24 loaded disputes need your response.");
    expect(r.text).toContain("- `PP-D-1002` · `AGENT_OVERREACH` · USD 95.00 · respond by");
    expect(r.text).toContain("Showing 4 of the 17 disputes needing a response.");
  });

  test("which are overreach lists the ones in the list, with the true total", async () => {
    const r = await converse("Which disputes are overreach?");
    expect(r.text).toContain("There are 5 `AGENT_OVERREACH` disputes out of 24.");
    expect(r.text).toContain("`PP-D-1007`");
  });
});

describe("what the planner leaves to the model", () => {
  const base = (question: string, over: Partial<StudioTurn> = {}): StudioTurn => ({
    kind: "turn",
    instructions: "",
    tools,
    history: [{ role: "user", text: question }],
    ...over,
  });

  test("open-ended questions", () => {
    for (const q of [
      "Walk me through what is going on with these disputes, in plain words.",
      "Is there a pattern in why buyers dispute?",
      "Write me a short note for the team.",
    ])
      expect(planStudio(base(q)), q).toBeUndefined();
  });

  test("structured-output and forced-tool turns, and tools the turn wasn't offered", () => {
    const named = "Explain dispute PP-D-1001";
    expect(planStudio(base(named, { format: { type: "object" } }))).toBeUndefined();
    expect(planStudio(base(named, { toolChoice: "required" }))).toBeUndefined();
    expect(planStudio(base(named, { toolChoice: { name: "list_disputes" } }))).toBeUndefined();
    expect(planStudio(base(named, { tools: [] }))).toBeUndefined();
    expect(planStudio(base(named, { toolChoice: "none" }))).toBeUndefined(); // it would need a call, and none are allowed
    expect(planStudio(base("What does AGENT_OVERREACH mean?", { toolChoice: "none" }))).toMatchObject({
      kind: "answer",
    });
  });

  test("a model that is asked something else still gets its turn, with no planner call in the way", async () => {
    let asked = 0;
    const generate: Generate = async <T>({ schema }: GenerateRequest<T>) => {
      asked++;
      return schema.parse({ text: "A model answer", tool: null });
    };
    const out = await runStudioTurn(base("Is there a pattern in why buyers dispute?"), "live", generate);
    expect(out.text).toBe("A model answer");
    expect(asked).toBe(1);
  });

  test("and what the model writes can't claim an action", async () => {
    const generate: Generate = async <T>({ schema }: GenerateRequest<T>) =>
      schema.parse({ text: "I've accepted the claim and refunded the buyer.", tool: null });
    const out = await runStudioTurn(base("Is there a pattern in why buyers dispute?"), "live", generate);
    expect(out.text.startsWith(STUDIO_CANT_ACT)).toBe(true);
  });
});
