import type { DisputeDetail } from "./dispute-types";

/** Availability of displayed purchase records is separate from their truth, model confidence or case outcome. */
export function evidenceAvailability(dispute: DisputeDetail) {
  const checks = [
    { label: "Intent record", available: !!dispute.mandateId && !!dispute.shopperIntentText },
    { label: "Cart record", available: dispute.cartLines.length > 0 },
    {
      label: "Checkout finding",
      available:
        ["APPROVE", "REJECT", "STEP_UP"].includes(dispute.checkoutVerdict ?? "") &&
        dispute.constraintChecks.length > 0,
    },
    // The worker builds the attestation PDF only for a compliant dispute (a defend package). For a concede or a no-mandate
    // dispute none is ever expected, so counting it would show "missing" for something that was never going to exist.
    ...(dispute.disputeClass === "MANDATE_COMPLIANT"
      ? [{ label: "Evidence preview", available: !!dispute.evidenceDrafted && !!dispute.evidenceDraftInfo }]
      : []),
  ];
  return { checks, available: checks.filter((c) => c.available).length, total: checks.length };
}

export function confidenceDescription(confidence: number | null | undefined): string {
  return typeof confidence === "number" && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? `Uncalibrated model score: ${confidence.toFixed(2)}. This is not a probability of winning.`
    : "Model confidence unavailable. The classification follows the policy rules.";
}
