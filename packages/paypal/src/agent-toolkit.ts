/**
 * PayPal Agent Toolkit (`@paypal/agent-toolkit`) as the sandbox client's dispute and tracking transport
 * (docs/specs/0004, 0005; issue #30). Its tools are AI SDK tools; we call them directly, never from a model:
 * which dispute action runs is always an operator's click, recorded by the API before the call.
 *
 * A tool answers with a JSON string and reports PayPal errors inside it instead of throwing, so every call
 * goes through `run`, which turns those into a PayPalError the API already knows how to answer.
 */
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import {
  DISPUTES_PAGE_SIZE,
  PayPalError,
  type DisputeListItem,
  type DisputeListPage,
  type PayPalDispute,
  type TrackingInput,
} from "./index";

/** The tools we enable: dispute get/list/accept and shipment tracking create. Nothing else. */
export const TOOLKIT_ACTIONS = {
  disputes: { get: true, list: true, create: true }, // `create` is the toolkit's switch for accept_dispute_claim
  shipment: { create: true },
};

export type ToolkitTool = { execute?: (args: never, options: never) => PromiseLike<unknown> };

export interface ToolkitDisputes {
  getDispute(disputeId: string): Promise<PayPalDispute>;
  listDisputes(): Promise<DisputeListItem[]>;
  listDisputesPage(page: number): Promise<DisputeListPage>;
  acceptClaim(disputeId: string, note: string): Promise<void>;
  addTracking(input: TrackingInput): Promise<void>;
}

export function createToolkit(clientId: string, clientSecret: string): ToolkitDisputes {
  const toolkit = new PayPalAgentToolkit({
    clientId,
    clientSecret,
    configuration: { actions: TOOLKIT_ACTIONS, context: { sandbox: true } },
  });
  return toolkitDisputes(toolkit.getTools() as Record<string, ToolkitTool>);
}

/** Wraps the toolkit's tools; tests pass fakes with the same JSON-string contract. */
export function toolkitDisputes(tools: Record<string, ToolkitTool>): ToolkitDisputes {
  async function run<T>(name: string, args: Record<string, unknown>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await runOnce<T>(name, args);
      } catch (err) {
        // A DNS or token failure means the call itself never left us, so retrying can't do anything twice.
        if (attempt >= RETRIES || !(err instanceof PayPalError) || !NOT_SENT.test(err.message)) throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }

  async function runOnce<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const execute = tools[name]?.execute;
    if (!execute) throw new Error(`Agent Toolkit tool ${name} is not enabled`);
    const raw = await execute(args as never, { toolCallId: `poi-${name}`, messages: [] } as never);
    const out = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    // Toolkit errors: { ok: false, status, code, message } for PayPal HTTP errors, { error: { message } } otherwise.
    if (out && out.ok === false) {
      const status = typeof out.status === "number" ? out.status : 502;
      const message = String(out.message ?? "PayPal error");
      throw new PayPalError(
        status,
        issueOf(message, String(out.code ?? "PAYPAL_TOOL_ERROR")),
        undefined,
        message,
      );
    }
    if (out && typeof out.error === "object" && out.error !== null) {
      const message = String((out.error as { message?: unknown }).message ?? "Agent Toolkit error");
      throw new PayPalError(502, "AGENT_TOOLKIT_ERROR", undefined, message);
    }
    return out as T;
  }

  return {
    getDispute: (disputeId) => run<PayPalDispute>("get_dispute", { dispute_id: disputeId }),

    async listDisputes() {
      const res = await run<{ items?: DisputeListItem[] }>("list_disputes", { page_size: DISPUTES_PAGE_SIZE });
      return res?.items ?? [];
    },

    async listDisputesPage(page) {
      if (!Number.isInteger(page) || page < 1) throw new RangeError("a dispute page number starts at 1");
      const res = await run<{ items?: DisputeListItem[]; total_pages?: number }>("list_disputes", {
        page_size: DISPUTES_PAGE_SIZE,
        page,
      });
      const totalPages = res?.total_pages;
      return {
        items: res?.items ?? [],
        page,
        ...(Number.isInteger(totalPages) && (totalPages as number) >= 0 ? { totalPages: totalPages as number } : {}),
      };
    },

    async acceptClaim(disputeId, note) {
      await run("accept_dispute_claim", { dispute_id: disputeId, note });
    },

    async addTracking(input) {
      // trackers-batch answers 200 even when a tracker is refused; the refusal is in `errors`.
      const res = await run<{ errors?: { message?: string; details?: { issue?: string }[] }[] }>(
        "create_shipment_tracking",
        {
          transaction_id: input.captureId,
          tracking_number: input.trackingNumber,
          carrier: input.carrier,
          status: input.status ?? "SHIPPED",
        },
      );
      const refused = res?.errors?.[0];
      if (refused) {
        const issue = refused.details?.[0]?.issue ?? "TRACKER_REFUSED";
        throw new PayPalError(
          422,
          issue,
          undefined,
          `PayPal refused the tracker: ${refused.message ?? issue}`,
        );
      }
    },
  };
}

/** Failures that happen before the request reaches PayPal (seen live: EAI_AGAIN while fetching the token). */
const NOT_SENT = /Failed to fetch access token|EAI_AGAIN|ENOTFOUND/;
const RETRIES = 3;
const RETRY_DELAY_MS = 500;

/** PayPal's issue name (e.g. NOT_ELIGIBLE) when the toolkit's message carries one, else the toolkit's code. */
const issueOf = (message: string, fallback: string) =>
  /\b([A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+)\b/.exec(message)?.[1] ?? fallback;
