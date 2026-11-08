/**
 * Agent orders and checkout verdicts for the Orders page (docs/specs/0007). Reads `/orders` and
 * `/verifications` from the merchant API; with the API unreachable, falls back to the seed set.
 */
import type { Money } from "@poi/contracts";
import { DEFAULT_API_BASE_URL } from "./api";
import { readHeaders } from "./read-auth";
import { SEED_ORDERS } from "./seed-orders";

export type Outcome = "APPROVE" | "STEP_UP" | "REJECT";

/** One checkout decision. REJECT (and agent-alone STEP_UP) creates no order, so `orderId` is absent. */
export interface VerdictRow {
  id: number;
  cartId: string;
  intentMandateId: string;
  orderId?: string;
  outcome: Outcome;
  reasons: string[];
  createdAt: string;
}

export interface OrderRow {
  orderId: string;
  paypalOrderId?: string;
  agentPlatform: string;
  humanPresent?: boolean;
  status: string;
  amount: Money;
  /** The checkout verdict that let this order exist. */
  verdict?: Outcome;
  reasons: string[];
  createdAt?: string;
  capturedAt?: string;
}

export interface OrdersData {
  orders: OrderRow[];
  verdicts: VerdictRow[];
  isSample: boolean;
}

/** The API's StoredOrder (packages/db), as JSON. */
interface ApiOrder {
  id: string;
  paypalOrderId?: string;
  agentPlatform: string;
  humanPresent: boolean;
  status: string;
  totalValue: number;
  currency: string;
  createdAt?: string;
  capturedAt?: string;
}

/** Attaches each order's latest verdict (highest id) to it. */
export function joinOrders(orders: ApiOrder[], verdicts: VerdictRow[]): OrderRow[] {
  const latest = new Map<string, VerdictRow>();
  for (const v of verdicts) {
    if (v.orderId && (latest.get(v.orderId)?.id ?? -1) < v.id) latest.set(v.orderId, v);
  }
  return orders.map((o) => {
    const v = latest.get(o.id);
    return {
      orderId: o.id,
      ...(o.paypalOrderId ? { paypalOrderId: o.paypalOrderId } : {}),
      agentPlatform: o.agentPlatform,
      humanPresent: o.humanPresent,
      status: o.status,
      amount: { value: o.totalValue, currency: o.currency },
      ...(v ? { verdict: v.outcome } : {}),
      reasons: v?.reasons ?? [],
      ...(o.createdAt ? { createdAt: o.createdAt } : {}),
      ...(o.capturedAt ? { capturedAt: o.capturedAt } : {}),
    };
  });
}

/** The seed set as the API would serve it: blocked carts are verdicts with no order. */
export function sampleOrders(): OrdersData {
  const outcome = { APPROVED: "APPROVE", STEP_UP: "STEP_UP", BLOCKED: "REJECT" } as const;
  const verdicts: VerdictRow[] = SEED_ORDERS.map((s, i) => ({
    id: SEED_ORDERS.length - i,
    cartId: s.orderId.replace(/^ord_/, "cart_"),
    intentMandateId: `sample-intent-${i + 1}`,
    ...(s.status === "BLOCKED" ? {} : { orderId: s.orderId }),
    outcome: outcome[s.status],
    reasons: s.reasonCodes,
    createdAt: s.createdAt,
  }));
  const orders = SEED_ORDERS.filter((s) => s.status !== "BLOCKED").map((s) => ({
    id: s.orderId,
    agentPlatform: s.agentPlatform,
    humanPresent: s.status === "STEP_UP",
    status: s.status === "STEP_UP" ? "CREATED" : "CAPTURED",
    totalValue: s.amount.value,
    currency: s.amount.currency,
    createdAt: s.createdAt,
    ...(s.status === "STEP_UP" ? {} : { capturedAt: s.createdAt }),
  }));
  return { orders: joinOrders(orders, verdicts), verdicts, isSample: true };
}

/** The API's page cap (apps/api `page()`). */
export const PAGE_SIZE = 200;
/** A stop for a misbehaving API: 50 pages is 10,000 rows, far beyond any demo merchant. */
const MAX_PAGES = 50;

export async function fetchOrders(
  options: { apiBaseUrl?: string; fetchFn?: typeof fetch } = {},
): Promise<OrdersData> {
  const base = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const get = options.fetchFn ?? fetch;
  // The API serves at most PAGE_SIZE rows per call, newest first; read every page so the grid and its totals
  // cover the whole set and a verdict on another page still finds its order.
  const read = async <T>(
    path: string,
    key: string,
    idOf: (row: T) => string | number,
  ): Promise<T[] | undefined> => {
    const rows = new Map<string | number, T>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${base}${path}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const res = await get(url, { headers: readHeaders(), cache: "no-store" });
      if (!res.ok) return undefined;
      const body = (await res.json()) as Record<string, unknown>;
      const batch = body[key];
      if (!Array.isArray(batch)) return undefined;
      // A row inserted mid-read shifts the offsets by one; keying by id drops the repeat.
      for (const row of batch as T[]) if (!rows.has(idOf(row))) rows.set(idOf(row), row);
      if (batch.length < PAGE_SIZE) break;
    }
    return [...rows.values()];
  };
  try {
    const [orders, verdicts] = await Promise.all([
      read<ApiOrder>("/orders", "orders", (o) => o.id),
      read<VerdictRow>("/verifications", "verifications", (v) => v.id),
    ]);
    if (orders && verdicts) return { orders: joinOrders(orders, verdicts), verdicts, isSample: false };
  } catch {
    // API unreachable: sample data below
  }
  return sampleOrders();
}

export interface OrderKpis {
  captured: number;
  capturedValue: Money[];
  blocked: number;
  stepUp: number;
}

/** Headline numbers. Money is summed per currency, never across currencies. */
export function orderKpis({ orders, verdicts }: Pick<OrdersData, "orders" | "verdicts">): OrderKpis {
  const byCurrency = new Map<string, number>();
  let captured = 0;
  for (const o of orders) {
    if (o.status !== "CAPTURED" && o.status !== "COMPLETED") continue;
    captured++;
    byCurrency.set(o.amount.currency, (byCurrency.get(o.amount.currency) ?? 0) + o.amount.value);
  }
  return {
    captured,
    capturedValue: [...byCurrency].map(([currency, value]) => ({ value, currency })),
    blocked: verdicts.filter((v) => v.outcome === "REJECT").length,
    stepUp: verdicts.filter((v) => v.outcome === "STEP_UP").length,
  };
}
