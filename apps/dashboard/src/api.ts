import type { Money } from "@poi/contracts";
import type { DisputeFilters, DisputeItem, DisputeSorting } from "./dispute-types";
import { SEED_DISPUTES } from "./seed-disputes";

export const DEFAULT_API_BASE_URL =
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3000";

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
export async function fetchDisputesDetailed(
  options?: FetchDisputesOptions
): Promise<FetchDisputesResponse> {
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

  return { disputes: SEED_DISPUTES, isFallback: true };
}

/**
 * Fetch disputes from the merchant API (docs/specs/0003, 0007).
 * Reads from the API over HTTP with no direct database access.
 * Falls back to canonical seed fixtures if the API server is unavailable or returns 501.
 */
export async function fetchDisputes(
  options?: FetchDisputesOptions
): Promise<DisputeItem[]> {
  const res = await fetchDisputesDetailed(options);
  return res.disputes;
}

/** Formats integer minor units to standard currency string (e.g. 7400 -> "$74.00"). */
export function formatMoney(money: Money): string {
  const dollars = (money.value / 100).toFixed(2);
  if (money.currency === "USD") {
    return `$${dollars}`;
  }
  return `${dollars} ${money.currency}`;
}

/** Calculates human-readable age from creation timestamp. */
export function calculateAge(
  isoDate: string,
  nowInput?: string | Date
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
  nowInput?: string | Date
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
export function filterDisputes(
  disputes: DisputeItem[],
  filters: DisputeFilters
): DisputeItem[] {
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
  _nowInput?: string | Date
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
