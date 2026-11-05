/**
 * Typed PayPal client: Orders v2, webhook verification, Disputes.
 * Spec: docs/specs/0004-paypal-integration.md. Owner: @harshkumarsingh12.
 *
 * Two implementations behind one interface: `sandbox` (real REST calls) and `mock`
 * (in memory, no credentials) so the rest of the team and the judges never need PayPal keys.
 * Money crosses this boundary as integer minor units; PayPal's decimal strings stay inside.
 */
import type { Money } from "@poi/contracts";
import { createMockClient } from "./mock";
import { createSandboxClient, type SandboxConfig } from "./sandbox";

export type PayPalMode = "sandbox" | "mock";

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface CreateOrderInput {
  intent: "AUTHORIZE" | "CAPTURE";
  /** Our order id. Sent as invoice_id and as PayPal-Request-Id, so a retry never creates a second order. */
  ourOrderId: string;
  /** The mandate pointer, `poi:<mandate_id>:<16 hex>` (docs/CONVENTIONS.md). */
  customId: string;
  total: Money;
  items: { sku: string; name: string; unitAmount: Money; quantity: number }[];
  /** Agent-alone checkout: charge the shopper's vaulted PayPal wallet without them present. */
  vaultId?: string;
}

export interface CreatedOrder {
  id: string;
  /** CREATED (buyer must approve), APPROVED, or COMPLETED (vaulted CAPTURE charged at once). */
  status: string;
  /** Where the shopper approves a human-present order. Absent once the order is completed. */
  approvalUrl?: string;
  /** Present when a CAPTURE order completed at creation. */
  captureId?: string;
}

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

/** The evidence types we send (PayPal accepts more). */
export type EvidenceType = "OTHER" | "PROOF_OF_FULFILLMENT" | "PROOF_OF_REFUND";

export interface ProvideEvidenceInput {
  notes: string;
  /** PDFs, at most 10 MB each. */
  files: { name: string; data: Uint8Array }[];
  /** Defaults to OTHER; use evidenceTypeFor(dispute reason). */
  evidenceType?: EvidenceType;
}

/** Which evidence answers which PayPal dispute reason (docs/specs/0004 §Disputes). */
export function evidenceTypeFor(reason: string): EvidenceType {
  if (reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") return "PROOF_OF_FULFILLMENT";
  if (reason === "CREDIT_NOT_PROCESSED") return "PROOF_OF_REFUND";
  return "OTHER"; // NOT_AS_DESCRIBED, UNAUTHORISED and the rest: the mandate attestation
}

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** Authorizes an order the shopper approved. */
  authorizeOrder(orderId: string): Promise<{ authorizationId: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  /** False for a delivery PayPal didn't sign. Throws only when PayPal can't be reached, so the caller answers 5xx and PayPal retries. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
  /** Multipart provide-evidence: the attestation PDF(s) plus notes. Only after an operator click (invariant 4). */
  provideEvidence(disputeId: string, input: ProvideEvidenceInput): Promise<void>;
  sendMessage(disputeId: string, message: string): Promise<void>;
}

/** A non-2xx answer from PayPal, with the fields their support asks for. */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly issue: string,
    readonly debugId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function parseMode(value: string | undefined): PayPalMode {
  if (value === undefined || value === "" || value === "mock") return "mock";
  if (value === "sandbox") return "sandbox";
  throw new Error(`PAYPAL_MODE must be "mock" or "sandbox", got "${value}"`);
}

/** Minor units → PayPal's decimal string, using the currency's own exponent (USD 2, JPY 0). */
export function toPayPalAmount(money: Money): { currency_code: string; value: string } {
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: money.currency,
  }).resolvedOptions().maximumFractionDigits!;
  return { currency_code: money.currency, value: (money.value / 10 ** digits).toFixed(digits) };
}

export function createPayPalClient(mode: PayPalMode, config: Partial<SandboxConfig> = {}): PayPalClient {
  if (mode === "mock") return createMockClient();
  const clientId = config.clientId ?? process.env.PAYPAL_CLIENT_ID;
  const clientSecret = config.clientSecret ?? process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = config.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;
  if (!clientId || !clientSecret || !webhookId) {
    throw new Error("PAYPAL_MODE=sandbox needs PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_WEBHOOK_ID");
  }
  return createSandboxClient({
    clientId,
    clientSecret,
    webhookId,
    baseUrl: config.baseUrl ?? SANDBOX_BASE_URL,
    fetch: config.fetch ?? fetch,
  });
}

export type { SandboxConfig };
export { createMockClient, MOCK_WEBHOOK_SIGNATURE, type DisputeAction, type MockPayPalClient } from "./mock";
