/**
 * Step-up approval (docs/specs/0003, #35): the shopper opened the emailed link. The page shows the cart and, on
 * approval, signs a CartApproval with the key kept in this browser. The link alone approves nothing.
 */
import type { CartApproval, StepUpListProof, StepUpView } from "@poi/contracts";

/** Link tokens are 43 base64url characters (32 random bytes). */
export const isStepUpToken = (token: string): boolean => /^[A-Za-z0-9_-]{20,128}$/.test(token);

/** What the shopper signs: this step-up and this exact cart, now. */
export const stepUpApproval = (view: StepUpView, now: Date): CartApproval => ({
  order_id: view.stepup_id,
  cart_mandate_hash: view.cart_mandate_hash,
  approved_at: now.toISOString(),
});

/** Whether this browser holds the key the intent was signed with, which is the only key that can approve. */
export const canApprove = (view: StepUpView, kid: string | undefined): boolean =>
  view.status === "PENDING" && kid === view.shopper_kid;

/** Step-up ids are `stp_` plus a UUID. Checked before one goes into a URL. */
export const isStepUpId = (id: string): boolean => /^stp_[0-9a-f-]{36}$/.test(id);

/** What the shop signs to ask the merchant for the carts waiting for this shopper (no link involved). */
export const stepUpListProof = (now: Date): StepUpListProof => ({
  purpose: "stepup.list",
  issued_at: now.toISOString(),
});
