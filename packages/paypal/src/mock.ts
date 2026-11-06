/**
 * PAYPAL_MODE=mock: an in-memory PayPal with the same state rules and error names as the sandbox,
 * so code that works here doesn't surprise anyone on the sandbox. No credentials, no network.
 * Simplification: every order counts as approved by the shopper, since there's no buyer to click.
 */
import { randomBytes } from "node:crypto";
import { PayPalError, type CreatedOrder, type PayPalClient, type PayPalDispute } from "./index";
import { evidenceForm, orderBody } from "./sandbox";

/** Mock mode accepts a webhook delivery only when it carries this transmission signature. */
export const MOCK_WEBHOOK_SIGNATURE = "mock-signature";

export type DisputeAction =
  | { kind: "provide-evidence"; disputeId: string; evidenceType: string; notes: string; files: string[] }
  | { kind: "send-message"; disputeId: string; message: string }
  | { kind: "accept-claim"; disputeId: string; note: string }
  | { kind: "escalate"; disputeId: string; note: string }
  | { kind: "add-tracking"; captureId: string; trackingNumber: string; carrier: string; status: string };

export interface MockPayPalClient extends PayPalClient {
  /** Every dispute action the mock received, oldest first. Lets tests prove what was (not) sent. */
  readonly disputeActions: readonly DisputeAction[];
  /** Mock mode has no buyers to open disputes; tests and demos add them here. */
  seedDispute(dispute: PayPalDispute): void;
}

/** PayPal-shaped ids: 17 uppercase alphanumerics. */
const paypalId = () =>
  randomBytes(13)
    .toString("base64url")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "7")
    .slice(0, 17);

export function createMockClient(): MockPayPalClient {
  const byRequestId = new Map<string, CreatedOrder>();
  const orders = new Map<string, { status: string; authorizationId?: string }>();
  const authorizations = new Map<string, "CREATED" | "CAPTURED" | "VOIDED">();
  const disputeActions: DisputeAction[] = [];
  const disputes = new Map<string, PayPalDispute>();

  const notFound = (what: string, id: string) =>
    new PayPalError(
      404,
      "RESOURCE_NOT_FOUND",
      undefined,
      `PayPal 404 RESOURCE_NOT_FOUND: ${what} ${id} does not exist`,
    );
  const unprocessable = (issue: string) => new PayPalError(422, issue, undefined, `PayPal 422 ${issue}`);

  return {
    disputeActions,
    seedDispute: (d) => void disputes.set(d.dispute_id, d),

    async createOrder(input) {
      orderBody(input); // same validation as the sandbox: one currency, totals add up
      const existing = byRequestId.get(input.ourOrderId); // PayPal-Request-Id idempotency
      if (existing) return existing;
      const id = paypalId();
      let created: CreatedOrder;
      if (input.intent === "CAPTURE" && input.vaultId) {
        created = { id, status: "COMPLETED", captureId: paypalId() };
      } else {
        created = {
          id,
          status: "CREATED",
          approvalUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`,
        };
      }
      orders.set(id, { status: created.status });
      byRequestId.set(input.ourOrderId, created);
      return created;
    },

    async authorizeOrder(orderId) {
      const order = orders.get(orderId);
      if (!order) throw notFound("order", orderId);
      if (order.authorizationId) return { authorizationId: order.authorizationId }; // idempotent retry
      if (order.status !== "CREATED") throw unprocessable("ORDER_ALREADY_COMPLETED");
      order.authorizationId = paypalId();
      order.status = "COMPLETED";
      authorizations.set(order.authorizationId, "CREATED");
      return { authorizationId: order.authorizationId };
    },

    async captureAuthorization(authorizationId) {
      const state = authorizations.get(authorizationId);
      if (!state) throw notFound("authorization", authorizationId);
      if (state === "CAPTURED") throw unprocessable("AUTHORIZATION_ALREADY_CAPTURED");
      if (state === "VOIDED") throw unprocessable("AUTHORIZATION_VOIDED");
      authorizations.set(authorizationId, "CAPTURED");
      return { captureId: paypalId() };
    },

    async voidAuthorization(authorizationId) {
      const state = authorizations.get(authorizationId);
      if (!state) throw notFound("authorization", authorizationId);
      if (state === "CAPTURED") throw unprocessable("AUTHORIZATION_ALREADY_CAPTURED");
      authorizations.set(authorizationId, "VOIDED");
    },

    async verifyWebhook(headers, rawBody) {
      try {
        JSON.parse(rawBody);
      } catch {
        return false;
      }
      return headers.transmissionSig === MOCK_WEBHOOK_SIGNATURE;
    },

    async provideEvidence(disputeId, input) {
      evidenceForm(input); // same validation as the sandbox: PDFs only, size cap, at least one file
      disputeActions.push({
        kind: "provide-evidence",
        disputeId,
        evidenceType: input.evidenceType ?? "OTHER",
        notes: input.notes,
        files: input.files.map((f) => f.name),
      });
    },

    async sendMessage(disputeId, message) {
      disputeActions.push({ kind: "send-message", disputeId, message });
    },

    async escalate(disputeId, note) {
      disputeActions.push({ kind: "escalate", disputeId, note });
    },

    async acceptClaim(disputeId, note) {
      disputeActions.push({ kind: "accept-claim", disputeId, note });
    },

    async getDispute(disputeId) {
      const d = disputes.get(disputeId);
      if (!d) throw notFound("dispute", disputeId);
      return d;
    },

    async listDisputes() {
      return [...disputes.values()].map(({ dispute_id, update_time, status }) => ({
        dispute_id,
        update_time,
        status,
      }));
    },

    async addTracking(input) {
      disputeActions.push({ kind: "add-tracking", status: "SHIPPED", ...input });
    },
  };
}
