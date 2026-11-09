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

/** The parts of a PayPal dispute object we read (GET /v1/customer/disputes/{id} and dispute webhooks). */
export interface PayPalDispute {
  dispute_id: string;
  create_time?: string;
  update_time?: string;
  status?: string;
  reason?: string;
  dispute_amount?: { currency_code: string; value: string };
  seller_response_due_date?: string;
  /** INQUIRY, CHARGEBACK, PRE_ARBITRATION, ARBITRATION. */
  dispute_life_cycle_stage?: string;
  /** HATEOAS: the actions PayPal allows right now (rel accept_claim, provide_evidence, escalate, ...). */
  links?: { rel: string; href?: string; method?: string }[];
  disputed_transactions?: {
    seller_transaction_id?: string;
    /** Our order id: we send it to PayPal as invoice_id. */
    invoice_number?: string;
    /** The mandate pointer PayPal holds for the order (our custom_id). */
    custom?: string;
    items?: { notes?: string }[];
  }[];
}

/** One row of GET /v1/customer/disputes. */
export interface DisputeListItem {
  dispute_id: string;
  update_time?: string;
  status?: string;
}

/** How many disputes one `list_disputes` page holds: the Agent Toolkit's maximum (`page_size`, 1 to 50). */
export const DISPUTES_PAGE_SIZE = 50;

/** One page of the merchant's disputes. The toolkit pages by number (`page`, from 1), not by a next link or token. */
export interface DisputeListPage {
  items: DisputeListItem[];
  page: number;
  /** PayPal's own page count, when it says. Absent means: keep going until a page comes back short. */
  totalPages?: number;
}

/** Shipment tracking for a captured payment: the proof of fulfillment for "not received" disputes. */
export interface TrackingInput {
  captureId: string;
  trackingNumber: string;
  /** PayPal carrier code, e.g. USPS, UPS, FEDEX, DHL. */
  carrier: string;
  status?: "SHIPPED" | "ON_HOLD" | "DELIVERED" | "CANCELLED";
}

/** Vault v3 step 1: where the shopper approves saving their PayPal wallet for the merchant. */
export interface VaultSetupInput {
  /** PayPal sends the shopper here with `approval_token_id` (the setup token id) once they approve. */
  returnUrl: string;
  cancelUrl: string;
}

export interface VaultSetup {
  setupTokenId: string;
  approvalUrl: string;
}

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** Vault v3: a setup token with `usage_type: MERCHANT`, so the merchant can charge the wallet later. */
  createVaultSetupToken(input: VaultSetupInput): Promise<VaultSetup>;
  /** Vault v3: revokes a saved wallet at PayPal (`DELETE /v3/vault/payment-tokens/{id}`). A token PayPal no longer knows is not an error. */
  deletePaymentToken(vaultId: string): Promise<void>;
  /** Vault v3 step 2, after the shopper approved: turns the setup token into the payment token (our `vault_id`). One use. */
  createVaultPaymentToken(setupTokenId: string): Promise<{ vaultId: string }>;
  /** Authorizes an order the shopper approved. */
  authorizeOrder(orderId: string): Promise<{ authorizationId: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  /** False for a delivery PayPal didn't sign. Throws only when PayPal can't be reached, so the caller answers 5xx and PayPal retries. */
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
  /** Multipart provide-evidence: the attestation PDF(s) plus notes. Only after an operator click (invariant 4). */
  provideEvidence(disputeId: string, input: ProvideEvidenceInput): Promise<void>;
  sendMessage(disputeId: string, message: string): Promise<void>;
  /** Inquiry → claim, so PayPal reviews it and accepts evidence. Only after an operator click. */
  escalate(disputeId: string, note: string): Promise<void>;
  /** Concede: PayPal refunds the buyer. Only after an operator click (invariant 4). Agent Toolkit `accept_dispute_claim`. */
  acceptClaim(disputeId: string, note: string): Promise<void>;
  /** The current dispute. Agent Toolkit `get_dispute`. */
  getDispute(disputeId: string): Promise<PayPalDispute>;
  /** The merchant's most recent disputes (the first page, up to 50). Agent Toolkit `list_disputes`. */
  listDisputes(): Promise<DisputeListItem[]>;
  /** One page of the merchant's disputes, numbered from 1, so a caller can read past the first 50. */
  listDisputesPage(page: number): Promise<DisputeListPage>;
  /** Only after an operator click. Agent Toolkit `create_shipment_tracking`. */
  addTracking(input: TrackingInput): Promise<void>;
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

/** PayPal's decimal string → minor units, the inverse of toPayPalAmount. */
export function fromPayPalAmount(amount: { currency_code: string; value: string }): Money {
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: amount.currency_code,
  }).resolvedOptions().maximumFractionDigits!;
  return { currency: amount.currency_code, value: Math.round(Number(amount.value) * 10 ** digits) };
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
    toolkit: config.toolkit,
  });
}

export type { SandboxConfig };
export { createToolkit, toolkitDisputes, type ToolkitDisputes, type ToolkitTool } from "./agent-toolkit";
export { createMockClient, MOCK_WEBHOOK_SIGNATURE, type DisputeAction, type MockPayPalClient } from "./mock";
