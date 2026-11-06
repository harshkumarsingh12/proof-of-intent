/** Real REST calls against the PayPal sandbox. Spec: docs/specs/0004-paypal-integration.md. */
import { createToolkit, type ToolkitDisputes } from "./agent-toolkit";
import {
  PayPalError,
  type ProvideEvidenceInput,
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
  /** Dispute reads, accept-claim and tracking go through the PayPal Agent Toolkit; tests inject a fake. */
  toolkit?: ToolkitDisputes;
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
  let toolkit = config.toolkit;
  const agent = () => (toolkit ??= createToolkit(config.clientId, config.clientSecret));
  let token: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - TOKEN_SLACK_MS) return token.value;
    // Concurrent callers share one token request.
    pending ??= (async () => {
      try {
        const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
        // Asking for a token is always safe to repeat; a DNS blip or reset connection gets two more tries.
        let res: Response | undefined;
        for (let attempt = 1; !res; attempt++) {
          try {
            res = await config.fetch(`${config.baseUrl}/v1/oauth2/token`, {
              method: "POST",
              headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
              body: "grant_type=client_credentials",
            });
          } catch (err) {
            if (attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
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
    opts: { body?: string | FormData; requestId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      Prefer: "return=representation",
    };
    // fetch sets multipart/form-data with its boundary itself; only JSON bodies need the header.
    if (!(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
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

    async provideEvidence(disputeId, input) {
      await call("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
        body: evidenceForm(input),
      });
    },

    async sendMessage(disputeId, message) {
      const form = new FormData();
      form.append("input", new Blob([JSON.stringify({ message })], { type: "application/json" }));
      await call("POST", `/v1/customer/disputes/${encodeURIComponent(disputeId)}/send-message`, {
        body: form,
      });
    },

    acceptClaim: (disputeId, note) => agent().acceptClaim(disputeId, note),
    getDispute: (disputeId) => agent().getDispute(disputeId),
    listDisputes: () => agent().listDisputes(),
    addTracking: (input) => agent().addTracking(input),
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

/** PayPal's documented per-file cap for dispute evidence. */
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024;

/** The provide-evidence multipart body: an `input` JSON part naming each file, then the files themselves. */
export function evidenceForm(input: ProvideEvidenceInput): FormData {
  if (input.files.length === 0) throw new RangeError("provide-evidence needs at least one file");
  for (const f of input.files) {
    if (!f.name.toLowerCase().endsWith(".pdf")) throw new RangeError(`evidence ${f.name} must be a PDF`);
    if (f.data.byteLength > MAX_EVIDENCE_FILE_BYTES) throw new RangeError(`evidence ${f.name} is over 10 MB`);
  }
  const evidence = {
    evidence_type: input.evidenceType ?? "OTHER",
    notes: input.notes.slice(0, 2000),
    documents: input.files.map((f) => ({ name: f.name })),
  };
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({ evidences: [evidence] })], { type: "application/json" }));
  input.files.forEach((f, i) =>
    form.append(`file${i + 1}`, new Blob([Uint8Array.from(f.data)], { type: "application/pdf" }), f.name),
  );
  return form;
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
