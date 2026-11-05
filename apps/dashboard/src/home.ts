/**
 * Pure helpers behind the Home page and the top-bar dispute search, kept here so they can be tested.
 * Every count traces to the disputes passed in (seed data until GET /disputes is built).
 */
import type { DisputeItem } from "./dispute-types";

export type HomeTab = "action" | "defend" | "concede" | "resolved";

export const HOME_TABS: { id: HomeTab; label: string }[] = [
  { id: "action", label: "Action required" },
  { id: "defend", label: "Defend" },
  { id: "concede", label: "Concede" },
  { id: "resolved", label: "Resolved" },
];

export type HomeRange = "24h" | "7d" | "30d";

export const HOME_RANGES: { id: HomeRange; label: string; hours: number }[] = [
  { id: "24h", label: "Last 24 hours", hours: 24 },
  { id: "7d", label: "Last 7 days", hours: 24 * 7 },
  { id: "30d", label: "Last 30 days", hours: 24 * 30 },
];

const HOUR_MS = 60 * 60 * 1000;
const time = (iso: string) => new Date(iso).getTime();

/** Disputes opened within the range, ending at `now`. */
export function inRange(disputes: DisputeItem[], range: HomeRange, now: Date): DisputeItem[] {
  const hours = HOME_RANGES.find((r) => r.id === range)!.hours;
  const from = now.getTime() - hours * HOUR_MS;
  return disputes.filter((d) => time(d.createdAt) >= from && time(d.createdAt) <= now.getTime());
}

/** Open disputes are everything not resolved. Defend and concede tabs show open ones only. */
export function forTab(disputes: DisputeItem[], tab: HomeTab): DisputeItem[] {
  switch (tab) {
    case "action":
      return disputes.filter((d) => d.status === "ACTION_REQUIRED");
    case "defend":
      return disputes.filter((d) => d.status !== "RESOLVED" && d.decision === "defend");
    case "concede":
      return disputes.filter((d) => d.status !== "RESOLVED" && d.decision === "concede");
    case "resolved":
      return disputes.filter((d) => d.status === "RESOLVED");
  }
}

/** Soonest deadline first, so the tiles show what needs a response next. */
export function byDeadline(disputes: DisputeItem[]): DisputeItem[] {
  return [...disputes].sort((a, b) => time(a.sellerResponseDueDate) - time(b.sellerResponseDueDate));
}

/** Open disputes whose seller deadline falls within the next `hours` (not already past). */
export function dueWithin(disputes: DisputeItem[], hours: number, now: Date): DisputeItem[] {
  const limit = now.getTime() + hours * HOUR_MS;
  return disputes.filter((d) => {
    const due = time(d.sellerResponseDueDate);
    return d.status !== "RESOLVED" && due > now.getTime() && due <= limit;
  });
}

/** "3 disputes need a response in the next 24 hours", or a calm line when nothing is due. */
export function dueSubtitle(count: number): string {
  if (count === 0) return "No disputes need a response in the next 24 hours.";
  return `${count} ${count === 1 ? "dispute needs" : "disputes need"} a response in the next 24 hours.`;
}

/** Case-insensitive match on dispute id, our order id or the PayPal order id. Exact id matches rank first. */
export function searchDisputes(disputes: DisputeItem[], query: string, limit = 6): DisputeItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = disputes.filter((d) =>
    [d.id, d.orderId, d.paypalOrderId].some((field) => field.toLowerCase().includes(q)),
  );
  const exact = (d: DisputeItem) => (d.id.toLowerCase() === q || d.orderId.toLowerCase() === q ? 0 : 1);
  return hits.sort((a, b) => exact(a) - exact(b) || a.id.localeCompare(b.id)).slice(0, limit);
}

/** "AGENT_OVERREACH" -> "Agent overreach". */
export function classLabel(disputeClass: string): string {
  const words = disputeClass.toLowerCase().split("_");
  return [words[0]![0]!.toUpperCase() + words[0]!.slice(1), ...words.slice(1)].join(" ");
}
