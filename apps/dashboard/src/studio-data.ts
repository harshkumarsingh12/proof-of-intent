/**
 * What the Studio widgets read and how they shape it (spec 0007). Pure: the page flattens the API's dispute details
 * into two tables, and each custom widget turns the rows Studio's data engine hands it into what it draws.
 */
import type { ConstraintCheck, DisputeDetail } from "./dispute-types";

/** One row per dispute: the table the platform widget and the evidence preview read. */
export interface StudioDisputeRow {
  id: string;
  disputeClass: string;
  agentPlatform: string;
  status: string;
  buyerDisputeReason: string;
  /** Whole US dollars with cents, so Studio can sum and format it. */
  amount: number;
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

export const disputeRows = (details: DisputeDetail[]): StudioDisputeRow[] =>
  details.map((d) => ({
    id: d.id,
    disputeClass: d.disputeClass,
    agentPlatform: d.agentPlatform,
    status: d.status,
    buyerDisputeReason: d.buyerDisputeReason,
    amount: d.amount.value / 100,
  }));

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
