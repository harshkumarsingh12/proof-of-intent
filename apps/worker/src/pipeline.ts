/**
 * Dispute copilot pipeline. Owner: @hoursgotviral-dev. Spec: docs/specs/0005-dispute-copilot.md.
 *
 * webhook → fetch dispute (Agent Toolkit get_dispute) → mandate on order? → replay hard rules
 * → replay J1 → class + recommendation → operator review → dispute action. Every dispute
 * ends at an operator click, never at the model.
 */
import { NotImplementedError, type DisputeClass } from "@poi/contracts";

/** Job names agreed in the shared contracts (docs/specs/0003 §Jobs). */
export const JOBS = {
  disputeReceived: "dispute.received",
  disputeClassify: "dispute.classify",
  evidenceBuild: "dispute.evidence.build",
  ledgerUpdate: "ledger.update",
} as const;

export interface Recommendation {
  disputeId: string;
  class: DisputeClass;
  action: "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "MAKE_OFFER" | "STANDARD_EVIDENCE";
  reasons: string[];
}

const OWNER = "hoursgotviral-dev";
const SPEC = "docs/specs/0005-dispute-copilot.md";

export async function recommend(_disputeId: string): Promise<Recommendation> {
  throw new NotImplementedError("dispute recommendation", OWNER, SPEC);
}

export async function buildEvidencePackage(_disputeId: string): Promise<{ pdf: Uint8Array; bundleJson: string }> {
  throw new NotImplementedError("evidence package", OWNER, SPEC);
}
