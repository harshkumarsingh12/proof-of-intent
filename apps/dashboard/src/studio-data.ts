/**
 * What the Studio widgets read and how they shape it (spec 0007). Pure: the page flattens the API's dispute details
 * into two tables, and each custom widget turns the rows Studio's data engine hands it into what it draws.
 */
import type { ConstraintCheck, DisputeDetail } from "./dispute-types";

/** What the platform widget calls disputes on orders with no signed mandate (they have no agent platform). */
export const NO_MANDATE_LABEL = "No mandate";

/** One row per dispute: the table the grid, the KPI tiles, the charts and the other widgets read. */
export interface StudioDisputeRow {
  id: string;
  disputeClass: string;
  agentPlatform: string;
  status: string;
  buyerDisputeReason: string;
  /** Whole US dollars with cents, so Studio can sum and format it. */
  amount: number;
  /** defend, concede or standard, as the copilot recommends. */
  decision: string;
  /** The copilot's recommended PayPal action, such as PROVIDE_EVIDENCE or ACCEPT_CLAIM. */
  action: string;
  /** When the seller's response is due (ISO), and how many hours that is from now (negative once past). */
  dueAt: string;
  hoursToDue: number;
  /** The cover note drafted for the evidence package, if there is one. */
  coverNote: string;
  // 0/1 and dollar columns, so a KPI tile is a plain sum and still follows Studio's filters and cross filters.
  open: number;
  overreach: number;
  /** Open and due within 24 hours. */
  dueSoon: number;
  /** Dollars on open disputes. */
  atStake: number;
  /** Dollars on disputes the copilot recommends conceding (AGENT_OVERREACH). */
  conceded: number;
}

/** One row per signed limit per dispute: the table the mandate diff reads. */
export interface StudioCheckRow {
  dispute: string;
  check: string;
  mandateRule: string;
  cartActual: string;
  status: "PASS" | "FAIL";
  reasonCode: string;
}

const DAY_HOURS = 24;

export const disputeRows = (details: DisputeDetail[], now: Date = new Date()): StudioDisputeRow[] =>
  details.map((d) => {
    const amount = d.amount.value / 100;
    const open = d.status === "RESOLVED" ? 0 : 1;
    const overreach = d.disputeClass === "AGENT_OVERREACH" ? 1 : 0;
    const due = Date.parse(d.sellerResponseDueDate);
    // Hours to one decimal; a missing or unreadable deadline is far in the future so it sorts last and is never "soon".
    const hoursToDue = Number.isFinite(due)
      ? Math.round(((due - now.getTime()) / 3_600_000) * 10) / 10
      : 99_999;
    return {
      id: d.id,
      disputeClass: d.disputeClass,
      agentPlatform: !d.agentPlatform || d.agentPlatform === "none" ? NO_MANDATE_LABEL : d.agentPlatform,
      status: d.status,
      buyerDisputeReason: d.buyerDisputeReason,
      amount,
      decision: d.decision,
      action: d.classificationInfo?.recommendedAction ?? "",
      dueAt: Number.isFinite(due) ? new Date(due).toISOString() : "",
      hoursToDue,
      coverNote: d.evidenceDraftInfo?.coverNote ?? "",
      open,
      overreach,
      dueSoon: open && hoursToDue <= DAY_HOURS ? 1 : 0,
      atStake: open ? amount : 0,
      conceded: overreach ? amount : 0,
    };
  });

export const checkRows = (details: Pick<DisputeDetail, "id" | "constraintChecks">[]): StudioCheckRow[] =>
  details.flatMap((d) =>
    (d.constraintChecks ?? []).map((c: ConstraintCheck) => ({
      dispute: d.id,
      check: c.name,
      mandateRule: c.mandateRule,
      cartActual: c.cartActual,
      status: c.status,
      reasonCode: c.reasonCode ? String(c.reasonCode) : "",
    })),
  );

/**
 * A row from `widgetApi.getData`, read by position. Studio keys result rows by the requested field's position or its
 * id depending on the query, so the widgets ask for fields in a fixed order and read them in that order.
 */
export function cells(row: Record<string, unknown>, ids: string[]): unknown[] {
  const keys = Object.keys(row);
  const byId = ids.every((id) => id in row);
  return byId ? ids.map((id) => row[id]) : keys.map((k) => row[k]);
}

// ---------- mandate diff ----------

export interface DiffLine {
  check: string;
  mandateRule: string;
  cartActual: string;
  status: "PASS" | "FAIL";
  reasonCode: string;
}

export interface DiffView {
  disputes: string[];
  selected: string | undefined;
  lines: DiffLine[];
  failed: number;
  total: number;
}

/** Lines for one dispute (the first, unless `selected` names another), violations first, optionally only those. */
export function diffView(
  rows: StudioCheckRow[],
  selected: string | undefined,
  onlyViolations: boolean,
): DiffView {
  const disputes = [...new Set(rows.map((r) => r.dispute))];
  const current = selected && disputes.includes(selected) ? selected : disputes[0];
  const mine = rows.filter((r) => r.dispute === current);
  const failed = mine.filter((r) => r.status === "FAIL").length;
  const lines = mine
    .filter((r) => !onlyViolations || r.status === "FAIL")
    .map(({ check, mandateRule, cartActual, status, reasonCode }) => ({
      check,
      mandateRule,
      cartActual,
      status,
      reasonCode,
    }))
    .sort((a, b) => Number(b.status === "FAIL") - Number(a.status === "FAIL"));
  return { disputes, selected: current, lines, failed, total: mine.length };
}

// ---------- agent platform breakdown ----------

/** One grouped row: platform, class, how many disputes and their total dollars. */
export interface PlatformGroup {
  platform: string;
  disputeClass: string;
  disputes: number;
  amount: number;
}

export interface PlatformCard {
  platform: string;
  disputes: number;
  overreach: number;
  /** 0 to 1. */
  overreachRate: number;
  /** Dollars on disputes classified AGENT_OVERREACH, which the copilot recommends conceding. */
  concededAmount: number;
}

export function platformCards(groups: PlatformGroup[]): PlatformCard[] {
  const byPlatform = new Map<string, PlatformCard>();
  for (const g of groups) {
    const card = byPlatform.get(g.platform) ?? {
      platform: g.platform,
      disputes: 0,
      overreach: 0,
      overreachRate: 0,
      concededAmount: 0,
    };
    card.disputes += g.disputes;
    if (g.disputeClass === "AGENT_OVERREACH") {
      card.overreach += g.disputes;
      card.concededAmount += g.amount;
    }
    byPlatform.set(g.platform, card);
  }
  return [...byPlatform.values()]
    .map((c) => ({
      ...c,
      overreachRate: c.disputes ? c.overreach / c.disputes : 0,
      concededAmount: Math.round(c.concededAmount * 100) / 100,
    }))
    .sort(
      (a, b) =>
        b.overreachRate - a.overreachRate || b.disputes - a.disputes || a.platform.localeCompare(b.platform),
    );
}

// ---------- evidence preview ----------

/** The attestation PDF exists only for orders the copilot found compliant; other classes have nothing to preview. */
export const evidencePdfPath = (disputeId: string): string =>
  `/api/disputes/${encodeURIComponent(disputeId)}/evidence.pdf`;

export const hasEvidence = (disputeClass: string | undefined): boolean =>
  disputeClass === "MANDATE_COMPLIANT";

// ---------- disputes grid ----------

/** One row of the Studio disputes grid. */
export interface GridDispute {
  id: string;
  disputeClass: string;
  platform: string;
  status: string;
  amount: number;
  action: string;
  dueAt: string;
  hoursToDue: number;
}

export const isOpen = (status: string): boolean => status !== "RESOLVED";

/** Sort key for "Respond by": open disputes by deadline, resolved ones after every open one. */
export const urgency = (d: Pick<GridDispute, "status" | "hoursToDue">): number =>
  isOpen(d.status) ? d.hoursToDue : 1_000_000 + d.hoursToDue;

/** "Overdue", "5h", "3d" (resolved disputes have nothing left to respond to). */
export function dueLabel(d: Pick<GridDispute, "status" | "hoursToDue">): string {
  if (!isOpen(d.status)) return "Closed";
  if (d.hoursToDue >= 90_000) return "No deadline";
  if (d.hoursToDue < 0) return "Overdue";
  if (d.hoursToDue < 48) return `${Math.max(1, Math.round(d.hoursToDue))}h`;
  return `${Math.round(d.hoursToDue / 24)}d`;
}

/** Due within 24 hours (or already late) and still open: the row the operator should look at first. */
export const isUrgent = (d: Pick<GridDispute, "status" | "hoursToDue">): boolean =>
  isOpen(d.status) && d.hoursToDue < 90_000 && d.hoursToDue <= 24;

const ACTION_LABELS: Record<string, string> = {
  PROVIDE_EVIDENCE: "Defend with evidence",
  ACCEPT_CLAIM: "Accept the claim",
  MAKE_OFFER: "Make an offer",
  STANDARD_EVIDENCE: "Standard evidence",
};
export const actionLabel = (action: string): string =>
  ACTION_LABELS[action] ?? (action || "Not analysed yet");

/** "WAITING_FOR_SELLER_RESPONSE" as "Waiting for seller response". */
export const statusLabel = (status: string): string => {
  const text = status.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/** The full dispute page for a dispute (the Studio widgets link to it). */
export const disputePath = (id: string): string => `/disputes/${encodeURIComponent(id)}`;
