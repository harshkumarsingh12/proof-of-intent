// Sandbox dispute recipe (docs/specs/0004 §Sandbox dispute recipe). Owner: @harshkumarsingh12.
//
// 1. Capture an order for the shopper-dispute sandbox account.
// 2. Log in as that shopper, open Resolution Center, report a problem → CUSTOMER.DISPUTE.CREATED.
// 3. require-evidence → WAITING_FOR_SELLER_RESPONSE.
// 4. Run the copilot; submit evidence or accept the claim.
// 5. adjudicate → CUSTOMER.DISPUTE.RESOLVED.
//
// Steps 1, 3 and 5 are scripted here so the team can regenerate demo disputes; step 2 needs
// one manual click in the sandbox UI per dispute.
import { NotImplementedError } from "../../packages/contracts/src/index";

throw new NotImplementedError("sandbox dispute cycle", "harshkumarsingh12", "docs/specs/0004-paypal-integration.md");
