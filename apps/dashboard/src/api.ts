import type { Money } from "@poi/contracts";
import type { DisputeDetail, DisputeFilters, DisputeItem, DisputeSorting } from "./dispute-types";
import type { AnalyticsSummary } from "./analytics-types";
import { getDisputeDetail } from "./dispute-details";
export { getDisputeDetail };
export {
  computeAnalyticsSummary,
  computeBlockedCartsMetrics,
  computeDisputesByClassPerWeek,
  computePerformanceMetrics,
  SEED_ANALYTICS,
} from "./analytics-data";
export type { AnalyticsSummary, PlatformBreakdown, WeeklyDisputesByClass } from "./analytics-types";
import { computeAnalyticsSummary } from "./analytics-data";
import { generateSeedDisputes } from "./seed-disputes";

/** Same-origin proxy (app/api/[...path]/route.ts), so the browser needs neither the API's URL nor CORS. */
export const DEFAULT_API_BASE_URL = "/api";

/**
 * Base URL for server components. "/api" only resolves in a browser, so on the server we call the API
 * container directly (compose sets API_INTERNAL_URL=http://api:3000). Unset: the fetch fails and pages fall back to seed data.
 */
export function serverApiBaseUrl(): string {
  return process.env.API_INTERNAL_URL ?? DEFAULT_API_BASE_URL;
}

export interface FetchDisputesOptions {
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface FetchDisputesResponse {
  disputes: DisputeItem[];
  isFallback: boolean;
}

/**
 * Fetch disputes from the merchant API (docs/specs/0003, 0007).
 * Reads from the API over HTTP with no direct database access.
 * Returns response metadata including whether data came from canonical seed fallback.
 */
export async function fetchDisputesDetailed(options?: FetchDisputesOptions): Promise<FetchDisputesResponse> {
  const baseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const runner = options?.fetchFn ?? fetch;

  try {
    const res = await runner(`${baseUrl}/disputes`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return { disputes: data as DisputeItem[], isFallback: false };
      }
      if (data && Array.isArray((data as { disputes: DisputeItem[] }).disputes)) {
        return { disputes: (data as { disputes: DisputeItem[] }).disputes, isFallback: false };
      }
    }
  } catch {
    // API server not reachable in dev or standalone mode; fallback to canonical seed data
  }

  // Fresh per call: seed times are relative to now, and a long-running server must not serve stale deadlines.
  return { disputes: generateSeedDisputes(), isFallback: true };
}

/**
 * Fetch disputes from the merchant API (docs/specs/0003, 0007).
 * Reads from the API over HTTP with no direct database access.
 * Falls back to canonical seed fixtures if the API server is unavailable or returns 501.
 */
export async function fetchDisputes(options?: FetchDisputesOptions): Promise<DisputeItem[]> {
  const res = await fetchDisputesDetailed(options);
  return res.disputes;
}

export interface FetchDisputeDetailResponse {
  dispute: DisputeDetail | undefined;
  isFallback: boolean;
}

/**
 * Fetch a single dispute with full mandate, cart, and copilot details.
 * Returns response metadata including whether data came from canonical seed fallback.
 */
export async function fetchDisputeDetailDetailed(
  disputeId: string,
  options?: FetchDisputesOptions
): Promise<FetchDisputeDetailResponse> {
  const baseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const runner = options?.fetchFn ?? fetch;

  try {
    const encodedId = encodeURIComponent(disputeId);
    const res = await runner(`${baseUrl}/disputes/${encodedId}/recommendation`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object") {
        return { dispute: { ...(data as DisputeDetail), isDemoData: false }, isFallback: false };
      }
    }
  } catch {
    // API server not reachable; fallback to canonical dispute detail
  }

  const dispute = getDisputeDetail(disputeId);
  return {
    dispute: dispute ? { ...dispute, isDemoData: true } : undefined,
    isFallback: true,
  };
}

/**
 * Fetch a single dispute with full mandate, cart, and copilot details.
 * Reads from the API over HTTP with no direct database access.
 * Falls back to canonical fixture data if the API server is unavailable or returns 501.
 */
export async function fetchDisputeDetail(
  disputeId: string,
  options?: FetchDisputesOptions
): Promise<DisputeDetail | undefined> {
  const res = await fetchDisputeDetailDetailed(disputeId, options);
  return res.dispute;
}

export type DisputeOperatorAction =
  | "provide-evidence"
  | "accept-claim"
  | "make-offer"
  | "send-message"
  | "escalate";

export interface PaypalActions {
  stage: string | null;
  status: string | null;
  allowed: Array<"provide-evidence" | "accept-claim" | "send-message" | "escalate">;
}

/** What PayPal allows on a dispute right now (GET /disputes/:id/paypal-actions). Null when unknown. */
export async function fetchPaypalActions(
  disputeId: string,
  options?: FetchDisputesOptions
): Promise<PaypalActions | null> {
  const baseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const runner = options?.fetchFn ?? fetch;
  try {
    const res = await runner(`${baseUrl}/disputes/${encodeURIComponent(disputeId)}/paypal-actions`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PaypalActions;
    return Array.isArray(data?.allowed) ? data : null;
  } catch {
    return null;
  }
}

export interface DisputeActionResult {
  success: boolean;
  status: number;
  error?: string;
  data?: unknown;
}

/**
 * Execute an operator action against the merchant API (docs/specs/0003, 0007).
 * Calls POST /disputes/:id/actions/:action over HTTP with no direct database access.
 */
export async function executeDisputeAction(
  disputeId: string,
  action: DisputeOperatorAction,
  payload?: Record<string, unknown>,
  options?: FetchDisputesOptions
): Promise<DisputeActionResult> {
  const baseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const runner = options?.fetchFn ?? fetch;

  try {
    const encodedId = encodeURIComponent(disputeId);
    const res = await runner(`${baseUrl}/disputes/${encodedId}/actions/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { success: true, status: res.status, data };
    }

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // The API's human message first ("PayPal accept-claim failed; try again"), then its code, then the status.
    const errorMessage =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : `Action rejected by API (${res.status}${res.statusText ? ` ${res.statusText}` : ""})`;

    return {
      success: false,
      status: res.status,
      error: errorMessage,
    };
  } catch (err) {
    return {
      success: false,
      status: 0,
      error: err instanceof Error ? err.message : "Network error calling API",
    };
  }
}

/**
 * Fetch analytics summary from the merchant API (GET /analytics/:report).
 * Reads from the API over HTTP with no direct database access.
 * Falls back to canonical seed analytics if the API returns 501 or is offline.
 */
export async function fetchAnalytics(
  options?: FetchDisputesOptions
): Promise<AnalyticsSummary> {
  const baseUrl = options?.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const runner = options?.fetchFn ?? fetch;

  try {
    const res = await runner(`${baseUrl}/analytics/overview`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object") {
        return data as AnalyticsSummary;
      }
    }
  } catch {
    // API server not reachable; fallback to canonical seed analytics
  }

  return { ...computeAnalyticsSummary(generateSeedDisputes()), isSample: true };
}

/** Formats integer minor units to standard currency string (e.g. 7400 -> "$74.00"). */
export function formatMoney(money: Money): string {
  const amount = (money.value / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (money.currency === "USD") {
    return `$${amount}`;
  }
  return `${amount} ${money.currency}`;
}

/** Aggregates dispute amounts per currency without summing distinct currencies together. */
export function aggregateCurrencyTotals(disputes: Array<{ amount: Money }>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const d of disputes) {
    const cur = d.amount.currency;
    totals[cur] = (totals[cur] ?? 0) + d.amount.value;
  }
  return totals;
}

/** Formats aggregated currency amounts into a combined string (e.g. "$1,850.00 + 45.00 EUR"). */
export function formatCurrencyTotals(totals: Record<string, number> | Array<{ amount: Money }>): string {
  const map: Record<string, number> = Array.isArray(totals) ? aggregateCurrencyTotals(totals) : totals;

  const entries = Object.entries(map);
  if (entries.length === 0) {
    return "$0.00";
  }

  // Sort currencies: USD first, then alphabetically
  entries.sort(([curA], [curB]) => {
    if (curA === "USD") return -1;
    if (curB === "USD") return 1;
    return curA.localeCompare(curB);
  });

  return entries.map(([currency, value]) => formatMoney({ value, currency })).join(" + ");
}

/** Calculates human-readable age from creation timestamp. */
export function calculateAge(
  isoDate: string,
  nowInput?: string | Date,
): { hours: number; days: number; text: string } {
  const now = nowInput ? new Date(nowInput).getTime() : Date.now();
  const created = new Date(isoDate).getTime();
  const diffMs = Math.max(0, now - created);
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);

  if (hours < 1) {
    const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    return { hours: 0, days: 0, text: `${mins}m ago` };
  }
  if (hours < 24) {
    return { hours, days: 0, text: `${hours}h ago` };
  }
  return { hours, days, text: `${days}d ago` };
}

/**
 * Calculates response SLA countdown and urgency.
 * Under 48 hours to seller_response_due_date is considered urgent per docs/specs/0005.
 */
export function calculateSla(
  dueDateIso: string,
  nowInput?: string | Date,
): { hoursRemaining: number; isUrgent: boolean; isExpired: boolean; text: string } {
  const now = nowInput ? new Date(nowInput).getTime() : Date.now();
  const due = new Date(dueDateIso).getTime();
  const diffMs = due - now;

  if (diffMs <= 0) {
    return {
      hoursRemaining: 0,
      isUrgent: true,
      isExpired: true,
      text: "Expired",
    };
  }

  const hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(hoursRemaining / 24);
  const isUrgent = hoursRemaining <= 48;

  let text: string;
  if (hoursRemaining < 1) {
    const mins = Math.max(1, Math.floor(diffMs / (1000 * 60)));
    text = `${mins}m left`;
  } else if (hoursRemaining < 24) {
    text = `${hoursRemaining}h left`;
  } else if (days === 1) {
    text = `1d ${hoursRemaining % 24}h left`;
  } else {
    text = `${days}d left`;
  }

  return { hoursRemaining, isUrgent, isExpired: false, text };
}

/** Filters disputes by decision, status, and search query. */
export function filterDisputes(disputes: DisputeItem[], filters: DisputeFilters): DisputeItem[] {
  return disputes.filter((item) => {
    // Decision filter
    if (filters.decision !== "all" && item.decision !== filters.decision) {
      return false;
    }

    // Status filter
    if (filters.status !== "all" && item.status !== filters.status) {
      return false;
    }

    // Search query
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      const matchId = item.id.toLowerCase().includes(q);
      const matchOrder = item.orderId.toLowerCase().includes(q);
      const matchPlatform = item.agentPlatform.toLowerCase().includes(q);
      const matchReason = item.buyerDisputeReason.toLowerCase().includes(q);
      const matchClass = item.disputeClass.toLowerCase().includes(q);
      if (!matchId && !matchOrder && !matchPlatform && !matchReason && !matchClass) {
        return false;
      }
    }

    return true;
  });
}

export const PINNED_DISPUTE_IDS = ["PP-D-1001", "PP-D-1002"] as const;

/** Sorts disputes by response deadline (SLA), creation age, or amount, keeping pinned demo disputes on top. */
export function sortDisputes(
  disputes: DisputeItem[],
  sorting: DisputeSorting,
  _nowInput?: string | Date,
): DisputeItem[] {
  const pinnedRanks = new Map<string, number>([
    ["PP-D-1001", 0],
    ["PP-D-1002", 1],
  ]);

  const result = [...disputes];

  result.sort((a, b) => {
    const rankA = pinnedRanks.get(a.id);
    const rankB = pinnedRanks.get(b.id);

    // If both are pinned demo disputes, keep their relative pinned order
    if (rankA !== undefined && rankB !== undefined) {
      return rankA - rankB;
    }
    // Pinned dispute A always sorts before non-pinned dispute B
    if (rankA !== undefined) {
      return -1;
    }
    // Pinned dispute B always sorts before non-pinned dispute A
    if (rankB !== undefined) {
      return 1;
    }

    let cmp = 0;
    if (sorting.field === "dueDate") {
      const timeA = new Date(a.sellerResponseDueDate).getTime();
      const timeB = new Date(b.sellerResponseDueDate).getTime();
      cmp = timeA - timeB;
    } else if (sorting.field === "age") {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      // For age: "asc" means newest first (largest timestamp)
      cmp = timeB - timeA;
    } else if (sorting.field === "amount") {
      cmp = a.amount.value - b.amount.value;
    }

    return sorting.direction === "asc" ? cmp : -cmp;
  });

  return result;
}
