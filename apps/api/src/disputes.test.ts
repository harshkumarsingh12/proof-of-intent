import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { compliantCart, greyJacketIntent } from "@poi/contracts/fixtures";
import { canonicalJson, mandateHash } from "@poi/mandates";
import { createMockClient, PayPalError, type PayPalClient } from "@poi/paypal";
import { buildApp } from "./app";
import { memoryDb } from "./test-helpers";

const TOKEN = "operator-test-token";
const auth = { authorization: `Bearer ${TOKEN}` };
const intentHash = mandateHash(greyJacketIntent);
const cart = { ...compliantCart, intent_mandate_hash: intentHash };
const cartHash = mandateHash(cart);
const pdf = new Uint8Array(Buffer.from("%PDF-1.4 test"));

const compliantRec = {
  class: "MANDATE_COMPLIANT",
  action: "PROVIDE_EVIDENCE",
  reasons: [],
  constraintChecks: [{ name: "amount_max", rule: "USD 80.00", actual: "USD 74.00", passed: true }],
  checkoutVerdict: "APPROVE",
  draft: { cover_note: "Signed record attached.", attestation_sections: [], buyer_message: "Hello" },
  mandateHash: intentHash,
  customId: "poi:x:y",
  analyzedAt: "2026-11-06T12:00:00.000Z",
};

async function setup(paypal: PayPalClient = createMockClient()) {
  const mem = memoryDb();
  await mem.db.saveMandate({
    hash: intentHash,
    kind: "intent",
    mandateId: greyJacketIntent.mandate_id,
    canonical: canonicalJson(greyJacketIntent),
    jws: "j",
    kid: "k",
  });
  await mem.db.saveMandate({
    hash: cartHash,
    kind: "cart",
    mandateId: "c",
    canonical: canonicalJson(cart),
    jws: "j",
    kid: "m",
  });
  await mem.db.createOrder({
    id: "ord_1",
    intentMandateId: greyJacketIntent.mandate_id,
    intentMandateHash: intentHash,
    cartMandateHash: cartHash,
    customId: "poi:x:y",
    paypalIntent: "AUTHORIZE",
    status: "CAPTURED",
    totalValue: 7400,
    currency: "USD",
    agentPlatform: "Northstar",
    humanPresent: true,
  });
  await mem.db.saveDispute({
    id: "PP-D-1",
    orderId: "ord_1",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    status: "WAITING_FOR_SELLER_RESPONSE",
    amountValue: 7400,
    currency: "USD",
    sellerResponseDueDate: "2026-11-15T10:00:00.000Z",
    paypal: { disputed_transactions: [{ items: [{ notes: "wrong colour" }] }] },
    recommendation: compliantRec,
    evidencePdf: pdf,
  });
  await mem.db.saveDispute({
    id: "PP-D-2",
    orderId: "ord_1",
    status: "WAITING_FOR_SELLER_RESPONSE",
    amountValue: 9500,
    currency: "USD",
    paypal: {},
    recommendation: {
      ...compliantRec,
      class: "AGENT_OVERREACH",
      action: "ACCEPT_CLAIM",
      reasons: ["AMOUNT_EXCEEDS_MAX"],
      draft: undefined,
    },
  });
  await mem.db.saveDispute({ id: "PP-D-PENDING", paypal: {} }); // not analyzed yet
  const app = buildApp({ paypal, db: mem.db, operatorToken: TOKEN });
  return { app, mem, paypal };
}

describe("GET /disputes paging (#234)", () => {
  const get = async (app: Awaited<ReturnType<typeof setup>>["app"], query = "") => {
    const res = await app.inject({ method: "GET", url: `/disputes${query}`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as {
      disputes: { id: string }[];
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };

  test("says how many there are and whether more exist: the total counts analyzed disputes only", async () => {
    const { app } = await setup();
    expect(await get(app)).toMatchObject({ total: 2, limit: 50, offset: 0, hasMore: false });
  });

  test("pages by limit and offset with no repeats, no gaps, and hasMore true until the last page", async () => {
    const { app } = await setup();
    const first = await get(app, "?limit=1&offset=0");
    const second = await get(app, "?limit=1&offset=1");
    expect([first.disputes.length, first.total, first.hasMore]).toEqual([1, 2, true]);
    expect([second.disputes.length, second.total, second.hasMore]).toEqual([1, 2, false]);
    expect([first.disputes[0]!.id, second.disputes[0]!.id].sort()).toEqual(["PP-D-1", "PP-D-2"]);
    expect((await get(app, "?limit=1&offset=2")).disputes).toEqual([]); // past the end: empty, not an error
  });

  test("a dispute the copilot has not analyzed yet does not use up a place on a page", async () => {
    const { app, mem } = await setup();
    // It sorts before both analyzed ones. Filtering after the page was cut used to give one row for limit=2, which looked
    // like the last page while a dispute was still waiting.
    await mem.db.saveDispute({
      id: "PP-D-EARLY",
      paypal: {},
      sellerResponseDueDate: "2026-11-01T00:00:00.000Z",
    });
    const page = await get(app, "?limit=2");
    expect(page.disputes.map((d) => d.id).sort()).toEqual(["PP-D-1", "PP-D-2"]);
    expect([page.total, page.hasMore]).toEqual([2, false]);
    const one = await get(app, "?limit=1");
    expect([one.disputes.length, one.hasMore]).toEqual([1, true]);
  });
});

describe("dispute reads", () => {
  test("GET /disputes lists analyzed disputes in the dashboard's shape", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/disputes", headers: auth });
    expect(res.statusCode).toBe(200);
    const { disputes } = res.json();
    expect(disputes.map((d: { id: string }) => d.id).sort()).toEqual(["PP-D-1", "PP-D-2"]);
    expect(disputes.find((d: { id: string }) => d.id === "PP-D-1")).toMatchObject({
      orderId: "ord_1",
      decision: "defend",
      disputeClass: "MANDATE_COMPLIANT",
      amount: { value: 7400, currency: "USD" },
      agentPlatform: "Northstar",
      shopperNotes: "wrong colour",
      evidenceDrafted: true,
    });
  });

  test("GET /disputes/:id/recommendation returns the detail with mandate, cart and checks", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/disputes/PP-D-1/recommendation", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: "PP-D-1",
      shopperIntentText: greyJacketIntent.natural_language_description,
      mandateId: greyJacketIntent.mandate_id,
      cartLines: [{ sku: "JKT-GRY-M", color: "grey", quantity: 1 }],
      constraints: { amountMax: { value: 8000, currency: "USD" } },
      constraintChecks: [{ name: "amount_max", status: "PASS" }],
      classificationInfo: {
        disputeClass: "MANDATE_COMPLIANT",
        recommendedAction: "PROVIDE_EVIDENCE",
        confidence: null,
      },
      evidenceDraftInfo: { attestationHash: intentHash, pdfFilename: "evidence-PP-D-1.pdf" },
    });
    expect(
      (await app.inject({ method: "GET", url: "/disputes/PP-D-PENDING/recommendation", headers: auth }))
        .statusCode,
    ).toBe(404);
  });

  test("the detail shows J2's cited reasons and evidence plan when the worker stored them", async () => {
    const { app, mem } = await setup();
    await mem.db.saveDispute({
      id: "PP-D-AI",
      orderId: "ord_1",
      paypal: {},
      recommendation: {
        ...compliantRec,
        ai: {
          confidence: 0.83,
          grounding_version: "source-excerpts-v1",
          reasons: [{ text: "Recorded cart: 1 × Stride Running Jacket", cites: ["cart_mandate"] }],
          evidence_plan: [
            { text: "Shopper request: grey running jacket under USD 80", cites: ["intent_mandate"] },
          ],
        },
      },
    });
    const info = (
      await app.inject({ method: "GET", url: "/disputes/PP-D-AI/recommendation", headers: auth })
    ).json().classificationInfo;
    expect(info.reasons).toContainEqual({
      text: "Recorded cart: 1 × Stride Running Jacket",
      cites: ["cart_mandate"],
    });
    expect(info.confidence).toBe(0.83);
    expect(info.evidencePlan).toEqual(["Shopper request: grey running jacket under USD 80"]);
    // Without J2, the rule-only plan stays.
    const plain = (
      await app.inject({ method: "GET", url: "/disputes/PP-D-1/recommendation", headers: auth })
    ).json();
    expect(plain.classificationInfo.evidencePlan[0]).toBe("Attestation PDF generated from the audit log");
  });

  test("legacy uncensored prose and invalid confidence never become a certain classification", async () => {
    const { app, mem } = await setup();
    for (const confidence of [undefined, 1.2, -1]) {
      await mem.db.saveDispute({
        id: "PP-D-LEGACY",
        orderId: "ord_1",
        paypal: {},
        recommendation: {
          ...compliantRec,
          ai: {
            confidence,
            reasons: [{ text: "Delivered and refunded.", cites: ["cart_mandate"] }],
            evidence_plan: [{ text: "Already authorized by the cardholder.", cites: ["capture_record"] }],
          },
        },
      });
      const info = (
        await app.inject({ method: "GET", url: "/disputes/PP-D-LEGACY/recommendation", headers: auth })
      ).json().classificationInfo;
      expect(info.confidence).toBeNull();
      expect(JSON.stringify(info)).not.toContain("Delivered and refunded");
      expect(JSON.stringify(info)).not.toContain("Already authorized");
    }
  });

  test("GET /disputes/:id/evidence.pdf serves the stored package", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/disputes/PP-D-1/evidence.pdf", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(
      (await app.inject({ method: "GET", url: "/disputes/PP-D-2/evidence.pdf", headers: auth })).statusCode,
    ).toBe(404);
  });

  test("orders and verifications grids", async () => {
    const { app, mem } = await setup();
    await mem.db.recordVerdict({
      intentMandateId: "m",
      cartId: "c",
      outcome: "REJECT",
      reasons: ["AMOUNT_EXCEEDS_MAX"],
    });
    expect(
      (await app.inject({ method: "GET", url: "/orders", headers: auth })).json().orders[0],
    ).toMatchObject({
      id: "ord_1",
    });
    expect(
      (await app.inject({ method: "GET", url: "/verifications?limit=1", headers: auth })).json()
        .verifications,
    ).toEqual([expect.objectContaining({ outcome: "REJECT", reasons: ["AMOUNT_EXCEEDS_MAX"] })]);
  });
});

describe("merchant reads need the operator token (#163)", () => {
  const reads = [
    "/orders",
    "/verifications",
    "/disputes",
    "/disputes/PP-D-1/recommendation",
    "/disputes/PP-D-1/audit",
    "/disputes/PP-D-1/paypal-actions",
    "/disputes/PP-D-1/evidence.pdf",
  ];
  const get = (
    app: Awaited<ReturnType<typeof setup>>["app"],
    url: string,
    headers: Record<string, string> = {},
  ) => app.inject({ method: "GET", url, headers });

  test("every read refuses a caller with no token or a wrong one, and says what it needs", async () => {
    const { app } = await setup();
    for (const url of reads) {
      const wrong: Record<string, string>[] = [
        {},
        { authorization: "Bearer nope" },
        { authorization: "Basic b3BlcmF0b3I6eA==" },
      ];
      for (const headers of wrong) {
        const res = await get(app, url, headers);
        expect(res.statusCode, `${url} with ${JSON.stringify(headers)}`).toBe(401);
        expect(res.headers["www-authenticate"]).toBe("Bearer");
        expect(res.json().error).toBe("read_unauthorized");
        // Nothing of the data is in the refusal, including the PDF's bytes.
        expect(res.body).not.toContain("PP-D-1");
        expect(res.body).not.toContain("%PDF");
      }
    }
  });

  test("with the operator token, each of them answers", async () => {
    const { app } = await setup();
    for (const url of reads) {
      const res = await get(app, url, auth);
      // paypal-actions asks PayPal live, and the mock does not know this dispute: a 404 is its answer, not a refusal.
      expect(res.statusCode, url).toBe(url.endsWith("paypal-actions") ? 404 : 200);
    }
  });

  test("the evidence PDF is protected like the rest", async () => {
    const { app } = await setup();
    expect((await get(app, "/disputes/PP-D-1/evidence.pdf")).statusCode).toBe(401);
    const ok = await get(app, "/disputes/PP-D-1/evidence.pdf", auth);
    expect(ok.headers["content-type"]).toBe("application/pdf");
  });

  test("liveness and readiness stay open, and readiness says whether reads are protected", async () => {
    const { app, mem, paypal } = await setup();
    expect((await get(app, "/healthz")).statusCode).toBe(200);
    expect((await get(app, "/readyz")).json().reads).toBe("protected");
    const open = buildApp({ paypal, db: mem.db });
    expect((await get(open, "/readyz")).json().reads).toBe("open");
  });

  test("with no OPERATOR_TOKEN the API runs open, as the zero-credential mock stack does", async () => {
    const { mem, paypal } = await setup();
    const open = buildApp({ paypal, db: mem.db });
    for (const url of reads) {
      expect((await get(open, url)).statusCode, url).toBe(url.endsWith("paypal-actions") ? 404 : 200);
    }
  });

  test("a read does not unlock an action: actions still need the token themselves", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/disputes/PP-D-2/actions/accept-claim" });
    expect(res.statusCode).toBe(401);
  });
});

describe("operator actions", () => {
  const post = (
    app: Awaited<ReturnType<typeof setup>>["app"],
    url: string,
    headers: Record<string, string> = auth,
    payload: object = {},
  ) => app.inject({ method: "POST", url, headers, payload });

  test("no token, a wrong token, or no OPERATOR_TOKEN configured: nothing reaches PayPal", async () => {
    const { app, mem, paypal } = await setup();
    expect((await post(app, "/disputes/PP-D-2/actions/accept-claim", {})).statusCode).toBe(401);
    expect(
      (await post(app, "/disputes/PP-D-2/actions/accept-claim", { authorization: "Bearer nope" })).statusCode,
    ).toBe(401);
    const off = buildApp({ paypal, db: mem.db });
    expect((await post(off, "/disputes/PP-D-2/actions/accept-claim")).statusCode).toBe(503);
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([]);
    expect(mem.audit).toEqual([]);
  });

  test("accept-claim: operator row first, then PayPal, then the result", async () => {
    const { app, mem, paypal } = await setup();
    const res = await post(app, "/disputes/PP-D-2/actions/accept-claim", {
      ...auth,
      "x-operator": "sikruti",
    });
    expect(res.statusCode).toBe(200);
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([
      { kind: "accept-claim", disputeId: "PP-D-2", note: expect.stringContaining("AMOUNT_EXCEEDS_MAX") },
    ]);
    expect(mem.audit.map((a) => [a.actor, a.action])).toEqual([
      ["operator:sikruti", "operator.accept-claim"],
      ["api", "paypal.accept-claim"],
    ]);
  });

  test("provide-evidence sends the stored PDF with the evidence type for the reason", async () => {
    const { app, mem, paypal } = await setup();
    expect((await post(app, "/disputes/PP-D-1/actions/provide-evidence")).statusCode).toBe(200);
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([
      {
        kind: "provide-evidence",
        disputeId: "PP-D-1",
        evidenceType: "OTHER",
        notes: "Signed record attached.",
        files: ["evidence-PP-D-1.pdf"],
      },
    ]);
    const sent = mem.audit.find((a) => a.action === "operator.provide-evidence")!.requestBody as {
      pdfSha256: string;
    };
    expect(sent.pdfSha256).toBe(createHash("sha256").update(pdf).digest("hex"));
  });

  test("provide-evidence without a package is refused before anything is recorded", async () => {
    const { app, mem } = await setup();
    expect((await post(app, "/disputes/PP-D-2/actions/provide-evidence")).statusCode).toBe(409);
    expect(mem.audit).toEqual([]);
  });

  test("PayPal refusing (e.g. inquiry stage) is a 409 with PayPal's issue, and the failure is audited", async () => {
    const paypal = {
      ...createMockClient(),
      acceptClaim: async () => {
        throw new PayPalError(422, "NOT_ELIGIBLE", "dbg", "PayPal 422 NOT_ELIGIBLE");
      },
    };
    const { app, mem } = await setup(paypal);
    const res = await post(app, "/disputes/PP-D-2/actions/accept-claim");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "paypal_refused", issue: "NOT_ELIGIBLE" });
    expect(mem.audit.map((a) => a.action)).toEqual(["operator.accept-claim", "paypal.accept-claim.failed"]);
  });

  test("PayPal unreachable is a retryable 503 with a message, and the failure is audited", async () => {
    const paypal = {
      ...createMockClient(),
      acceptClaim: async () => {
        throw new PayPalError(
          502,
          "AGENT_TOOLKIT_ERROR",
          undefined,
          "getaddrinfo EAI_AGAIN api.sandbox.paypal.com",
        );
      },
    };
    const { app, mem } = await setup(paypal);
    const res = await post(app, "/disputes/PP-D-2/actions/accept-claim");
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toEqual({
      error: "paypal_unavailable",
      message: "PayPal accept-claim failed; try again",
    });
    expect(mem.audit.map((a) => a.action)).toEqual(["operator.accept-claim", "paypal.accept-claim.failed"]);
  });

  test("escalate is an audited operator action like the others", async () => {
    const { app, mem, paypal } = await setup();
    expect((await post(app, "/disputes/PP-D-1/actions/escalate")).statusCode).toBe(200);
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([
      { kind: "escalate", disputeId: "PP-D-1", note: expect.stringContaining("signed record") },
    ]);
    expect(mem.audit.map((a) => a.action)).toEqual(["operator.escalate", "paypal.escalate"]);
  });

  test("paypal-actions asks PayPal live and maps its links to our action names", async () => {
    const paypal = createMockClient();
    paypal.seedDispute({
      dispute_id: "PP-D-1",
      status: "WAITING_FOR_SELLER_RESPONSE",
      dispute_life_cycle_stage: "INQUIRY",
      links: [{ rel: "self" }, { rel: "accept_claim" }, { rel: "escalate" }, { rel: "make_offer" }],
    });
    const { app } = await setup(paypal);
    const res = await app.inject({ method: "GET", url: "/disputes/PP-D-1/paypal-actions", headers: auth });
    expect(res.json()).toEqual({
      stage: "INQUIRY",
      status: "WAITING_FOR_SELLER_RESPONSE",
      allowed: ["accept-claim", "escalate"],
    });
    expect(
      (await app.inject({ method: "GET", url: "/disputes/PP-D-404/paypal-actions", headers: auth }))
        .statusCode,
    ).toBe(404);
  });

  test("make-offer is out of scope, unknown actions and disputes are 404", async () => {
    const { app } = await setup();
    expect((await post(app, "/disputes/PP-D-1/actions/make-offer")).statusCode).toBe(501);
    expect((await post(app, "/disputes/PP-D-1/actions/refund-everything")).statusCode).toBe(404);
    expect((await post(app, "/disputes/PP-D-404/actions/accept-claim")).statusCode).toBe(404);
  });
});

describe("GET /disputes/:id/audit (#74)", () => {
  const act = (
    app: Awaited<ReturnType<typeof setup>>["app"],
    id: string,
    action: string,
    payload: object = {},
  ) => app.inject({ method: "POST", url: `/disputes/${id}/actions/${action}`, headers: auth, payload });

  test("returns the dispute's rows from audit_log, the operator's before the PayPal call it authorized", async () => {
    const { app, mem } = await setup();
    expect(
      (await act(app, "PP-D-1", "provide-evidence", { note: "Signed mandate attached." })).statusCode,
    ).toBe(200);
    const res = await app.inject({ method: "GET", url: "/disputes/PP-D-1/audit", headers: auth });
    expect(res.statusCode).toBe(200);
    const { entries } = res.json() as {
      entries: { id: number; actor: string; action: string; note?: string }[];
    };
    expect(entries.map((e) => [e.actor, e.action])).toEqual([
      ["operator:dashboard", "operator.provide-evidence"],
      ["api", "paypal.provide-evidence"],
    ]);
    expect(entries[0]!.id).toBeLessThan(entries[1]!.id);
    expect(entries[0]!.note).toBe("Signed mandate attached.");
    expect(mem.audit).toHaveLength(2); // it reads; it writes nothing
  });

  test("accepting the claim against a defend recommendation is marked as an override, with its note", async () => {
    const { app } = await setup();
    await act(app, "PP-D-1", "accept-claim", { note: "Refunding as a goodwill gesture." });
    const { entries } = (
      await app.inject({ method: "GET", url: "/disputes/PP-D-1/audit", headers: auth })
    ).json();
    expect(entries[0]).toMatchObject({
      action: "operator.accept-claim",
      recommended: "MANDATE_COMPLIANT",
      override: true,
      note: "Refunding as a goodwill gesture.",
    });
    // The copilot's own recommendation was to concede on PP-D-2, so accepting there is not an override.
    await act(app, "PP-D-2", "accept-claim");
    const other = (await app.inject({ method: "GET", url: "/disputes/PP-D-2/audit", headers: auth })).json();
    expect(other.entries[0].override).toBeUndefined();
  });

  test("a failed PayPal call and a webhook are shown with the useful field only, never the raw body", async () => {
    const { app, mem } = await setup();
    await mem.db.appendAudit({
      actor: "paypal",
      action: "webhook.received",
      subjectId: "PP-D-1",
      requestBody: { eventId: "WH-1", eventType: "CUSTOMER.DISPUTE.CREATED", transmissionId: "secret-ish" },
    });
    await mem.db.appendAudit({
      actor: "api",
      action: "paypal.escalate.failed",
      subjectId: "PP-D-1",
      requestBody: { message: "PayPal 422 ESCALATE_NOT_ALLOWED" },
    });
    const body = (await app.inject({ method: "GET", url: "/disputes/PP-D-1/audit", headers: auth })).json();
    expect(body.entries.map((e: { detail?: string }) => e.detail)).toEqual([
      "CUSTOMER.DISPUTE.CREATED",
      "PayPal 422 ESCALATE_NOT_ALLOWED",
    ]);
    expect(JSON.stringify(body)).not.toContain("transmissionId");
    expect(JSON.stringify(body)).not.toContain("WH-1");
  });

  test("another dispute's rows are not included, and an unknown dispute is a 404", async () => {
    const { app } = await setup();
    await act(app, "PP-D-2", "accept-claim");
    expect(
      (await app.inject({ method: "GET", url: "/disputes/PP-D-1/audit", headers: auth })).json(),
    ).toEqual({
      entries: [],
    });
    expect(
      (await app.inject({ method: "GET", url: "/disputes/PP-D-NOPE/audit", headers: auth })).statusCode,
    ).toBe(404);
  });
});

describe("shipment tracking (operator)", () => {
  const track = (
    app: Awaited<ReturnType<typeof setup>>["app"],
    headers: Record<string, string>,
    payload: object,
  ) => app.inject({ method: "POST", url: "/orders/ord_1/tracking", headers, payload });

  test("needs the operator token, validates input and refuses an uncaptured order", async () => {
    const { app, mem, paypal } = await setup();
    expect((await track(app, {}, { trackingNumber: "T1", carrier: "USPS" })).statusCode).toBe(401);
    expect((await track(app, auth, { trackingNumber: "T 1", carrier: "usps" })).statusCode).toBe(400);
    expect((await track(app, auth, { trackingNumber: "T1", carrier: "USPS" })).statusCode).toBe(409); // no capture id
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([]);
    expect(mem.audit).toEqual([]);
  });

  test("records the operator, sends the tracker on the capture, records the result", async () => {
    const { app, mem, paypal } = await setup();
    await mem.db.updateOrder("ord_1", {
      status: "CAPTURED",
      captureId: "CAP-1",
      capturedAt: "2026-11-02T10:05:00Z",
    });
    const res = await track(app, auth, { trackingNumber: "9400100000000000000000", carrier: "USPS" });
    expect(res.statusCode).toBe(200);
    expect((paypal as ReturnType<typeof createMockClient>).disputeActions).toEqual([
      {
        kind: "add-tracking",
        captureId: "CAP-1",
        trackingNumber: "9400100000000000000000",
        carrier: "USPS",
        status: "SHIPPED",
      },
    ]);
    expect(mem.audit.map((a) => [a.actor, a.action])).toEqual([
      ["operator:dashboard", "operator.add-tracking"],
      ["api", "paypal.add-tracking"],
    ]);
  });
});
