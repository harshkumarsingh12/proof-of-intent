/** Real REST calls against the PayPal sandbox. Spec: docs/specs/0004-paypal-integration.md. */
import { NotImplementedError } from "@poi/contracts";
import {
  PayPalError,
  toPayPalAmount,
  type CreateOrderInput,
  type PayPalClient,
  type WebhookHeaders,
} from "./index";

export interface SandboxConfig {
  clientId: string;
  clientSecret: string;
  /** Our webhook's id in the PayPal app; verify-webhook-signature checks deliveries against it. */
  webhookId: string;
  baseUrl: string;
  fetch: typeof fetch;
}

/** Refresh this long before PayPal's expiry so a request never goes out with a token that dies in flight. */
const TOKEN_SLACK_MS = 60_000;

type Link = { rel: string; href: string };
interface OrderResponse {
  id: string;
  status: string;
  links?: Link[];
  purchase_units?: {
    payments?: { authorizations?: { id: string }[]; captures?: { id: string }[] };
  }[];
}

export function createSandboxClient(config: SandboxConfig): PayPalClient {
  let token: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - TOKEN_SLACK_MS) return token.value;
    // Concurrent callers share one token request.
    pending ??= (async () => {
      try {
        const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
        const res = await config.fetch(`${config.baseUrl}/v1/oauth2/token`, {
          method: "POST",
          headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: "grant_type=client_credentials",
        });
        if (!res.ok) throw await toError(res);
        const json = (await res.json()) as { access_token: string; expires_in: number };
        token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
        return token.value;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  }

  async function call<T>(
    method: string,
    path: string,
    opts: { body?: string; requestId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (opts.requestId) headers["PayPal-Request-Id"] = opts.requestId;
    const res = await config.fetch(`${config.baseUrl}${path}`, { method, headers, body: opts.body });
    if (!res.ok) throw await toError(res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  return {
    async createOrder(input) {
      const body = JSON.stringify(orderBody(input));
      const order = await call<OrderResponse>("POST", "/v2/checkout/orders", {
        body,
        requestId: input.ourOrderId,
      });
      return {
        id: order.id,
        status: order.status,
        approvalUrl: order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href,
        captureId: order.purchase_units?.[0]?.payments?.captures?.[0]?.id,
      };
    },

    async authorizeOrder(orderId) {
      const order = await call<OrderResponse>(
        "POST",
        `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,
        {
          requestId: `${orderId}-authorize`,
        },
      );
      const authorizationId = order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
      if (!authorizationId)
        throw new Error(`PayPal authorized order ${orderId} but returned no authorization id`);
      return { authorizationId };
    },

    async captureAuthorization(authorizationId) {
      const capture = await call<{ id: string }>(
        "POST",
        `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
        { body: JSON.stringify({ final_capture: true }), requestId: `${authorizationId}-capture` },
      );
      return { captureId: capture.id };
    },

    async voidAuthorization(authorizationId) {
      await call("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
        requestId: `${authorizationId}-void`,
      });
    },

    async verifyWebhook(headers, rawBody) {
      try {
        JSON.parse(rawBody);
      } catch {
        return false;
      }
      try {
        const res = await call<{ verification_status: string }>(
          "POST",
          "/v1/notifications/verify-webhook-signature",
          {
            body: verifyBody(headers, config.webhookId, rawBody),
          },
        );
        return res.verification_status === "SUCCESS";
      } catch (err) {
        // PayPal rejects malformed or forged transmission headers with a 4xx: that's "not verified".
        // Anything else (5xx, network) must surface so the receiver answers 5xx and PayPal redelivers.
        if (err instanceof PayPalError && err.status >= 400 && err.status < 500) return false;
        throw err;
      }
    },

    async provideEvidence() {
      throw new NotImplementedError(
        "sandbox provideEvidence",
        "harshkumarsingh12",
        "docs/specs/0004-paypal-integration.md",
      );
    },

    async sendMessage() {
      throw new NotImplementedError(
        "sandbox sendMessage",
        "harshkumarsingh12",
        "docs/specs/0004-paypal-integration.md",
      );
    },
  };
}

export function orderBody(input: CreateOrderInput) {
  const itemTotal = input.items.reduce((sum, i) => sum + i.unitAmount.value * i.quantity, 0);
  const currencies = new Set([input.total.currency, ...input.items.map((i) => i.unitAmount.currency)]);
  if (currencies.size !== 1) throw new RangeError("order total and items must share one currency");
  // Never invent shipping or tax to make the numbers add up: a mismatch is a bug upstream.
  if (itemTotal !== input.total.value) {
    throw new RangeError(`order total ${input.total.value} does not equal the item total ${itemTotal}`);
  }
  return {
    intent: input.intent,
    purchase_units: [
      {
        reference_id: input.ourOrderId,
        invoice_id: input.ourOrderId,
        custom_id: input.customId,
        amount: { ...toPayPalAmount(input.total), breakdown: { item_total: toPayPalAmount(input.total) } },
        items: input.items.map((i) => ({
          name: i.name.slice(0, 127),
          sku: i.sku,
          quantity: String(i.quantity),
          unit_amount: toPayPalAmount(i.unitAmount),
        })),
      },
    ],
    ...(input.vaultId ? { payment_source: { paypal: { vault_id: input.vaultId } } } : {}),
  };
}

/** Splices the raw body in verbatim: re-serializing the event could change the bytes PayPal signed. */
export function verifyBody(h: WebhookHeaders, webhookId: string, rawBody: string): string {
  const fields = JSON.stringify({
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
    webhook_id: webhookId,
  });
  return `${fields.slice(0, -1)},"webhook_event":${rawBody}}`;
}

async function toError(res: Response): Promise<PayPalError> {
  const text = await res.text();
  let json: {
    name?: string;
    error?: string;
    message?: string;
    error_description?: string;
    debug_id?: string;
    details?: { issue?: string; description?: string }[];
  } = {};
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON body (gateway error page); fall through with the status alone
  }
  const issue = json.details?.[0]?.issue ?? json.name ?? json.error ?? `HTTP_${res.status}`;
  const detail = json.details?.[0]?.description ?? json.message ?? json.error_description ?? res.statusText;
  return new PayPalError(res.status, issue, json.debug_id, `PayPal ${res.status} ${issue}: ${detail}`);
}
