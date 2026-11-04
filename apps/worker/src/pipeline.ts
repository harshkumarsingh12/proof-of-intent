/**
 * Dispute copilot pipeline. Owner: @hoursgotviral-dev. Spec: docs/specs/0005-dispute-copilot.md.
 *
 * webhook → fetch dispute (Agent Toolkit get_dispute) → mandate on order? → replay hard rules
 * → replay J1 → class + recommendation → operator review → dispute action. Every dispute
 * ends at an operator click, never at the model.
 */
import { NotImplementedError } from "@poi/contracts";
import type { Db } from "@poi/db";
import type { MandateLedger } from "@poi/policy-engine";
import { runDisputeClassifier, type DisputeDataLoader, type Recommendation } from "./classifier";

/** Job names agreed in the shared contracts (docs/specs/0003 §Jobs). */
export const JOBS = {
  disputeReceived: "dispute.received",
  disputeClassify: "dispute.classify",
  evidenceBuild: "dispute.evidence.build",
  ledgerUpdate: "ledger.update",
} as const;

export type { Recommendation };

const OWNER = "hoursgotviral-dev";
const SPEC = "docs/specs/0005-dispute-copilot.md";

export interface RecommendOptions {
  loader: DisputeDataLoader;
  now?: string;
  ledger?: MandateLedger;
  db?: Pick<Db, "appendAudit">;
}

export async function recommend(disputeId: string, options: RecommendOptions): Promise<Recommendation> {
  const dispute = await options.loader.loadDispute(disputeId);
  if (!dispute) {
    throw new Error(`Dispute not found: ${disputeId}`);
  }

  const order = dispute.orderId ? await options.loader.loadOrder(dispute.orderId) : null;
  const rec = await runDisputeClassifier(dispute, order, options);

  if (options.db) {
    await options.db.appendAudit({
      actor: "worker:copilot",
      action: "dispute.classified",
      subjectId: disputeId,
      requestBody: rec,
    });
  }

  return rec;
}

export async function buildEvidencePackage(
  _disputeId: string,
): Promise<{ pdf: Uint8Array; bundleJson: string }> {
  throw new NotImplementedError("evidence package", OWNER, SPEC);
}

export * from "./intake";
export * from "./decision";
export * from "./classifier";
