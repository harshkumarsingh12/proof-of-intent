/**
 * Typed PayPal client: Orders v2, Vault v3, webhook verification, Disputes.
 * Spec: docs/specs/0004-paypal-integration.md. Owner: @harshkumarsingh12.
 *
 * Two implementations behind one interface: `sandbox` (real REST calls) and `mock`
 * (fixtures, no credentials) so the rest of the team and the judges never need PayPal keys.
 */
import { NotImplementedError, type Money } from "@poi/contracts";

export type PayPalMode = "sandbox" | "mock";

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export interface CreateOrderInput {
  intent: "AUTHORIZE" | "CAPTURE";
  ourOrderId: string;
  customId: string;
  total: Money;
  items: { sku: string; name: string; unitAmount: Money; quantity: number }[];
  vaultId?: string;
}

export interface WebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
}

export interface PayPalClient {
  createOrder(input: CreateOrderInput): Promise<{ id: string; status: string }>;
  authorizeOrder(orderId: string): Promise<{ authorizationId: string }>;
  captureAuthorization(authorizationId: string): Promise<{ captureId: string }>;
  voidAuthorization(authorizationId: string): Promise<void>;
  verifyWebhook(headers: WebhookHeaders, rawBody: string): Promise<boolean>;
  provideEvidence(disputeId: string, input: { notes: string; files: { name: string; data: Uint8Array }[] }): Promise<void>;
  sendMessage(disputeId: string, message: string): Promise<void>;
}

export function parseMode(value: string | undefined): PayPalMode {
  if (value === undefined || value === "" || value === "mock") return "mock";
  if (value === "sandbox") return "sandbox";
  throw new Error(`PAYPAL_MODE must be "mock" or "sandbox", got "${value}"`);
}

const todo = (what: string) => async (): Promise<never> => {
  throw new NotImplementedError(what, "harshkumarsingh12", "docs/specs/0004-paypal-integration.md");
};

export function createPayPalClient(mode: PayPalMode): PayPalClient {
  const label = `PayPal ${mode} client`;
  return {
    createOrder: todo(`${label}: createOrder`),
    authorizeOrder: todo(`${label}: authorizeOrder`),
    captureAuthorization: todo(`${label}: captureAuthorization`),
    voidAuthorization: todo(`${label}: voidAuthorization`),
    verifyWebhook: todo(`${label}: verifyWebhook`),
    provideEvidence: todo(`${label}: provideEvidence`),
    sendMessage: todo(`${label}: sendMessage`),
  };
}
