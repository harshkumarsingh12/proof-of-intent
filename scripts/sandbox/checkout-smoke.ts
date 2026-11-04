// Checkout smoke test against the PayPal sandbox (docs/specs/0003, issue #20). Owner: @harshkumarsingh12.
//
//   DATABASE_URL=postgres://… pnpm sandbox:checkout-smoke     (sandbox credentials from .env)
//
// Journey B through the real API stack: the red $95 jacket must be rejected with no PayPal order, the
// grey $74 jacket must get a sandbox order whose custom_id (read back from PayPal) is the mandate pointer.
import { compliantCart, overreachingCart } from "../../packages/contracts/src/fixtures";
import { customId, mandateHash } from "../../packages/mandates/src/index";
import { paypalRaw } from "./paypal-raw";
import { sandboxStack } from "./stack";

const stack = await sandboxStack();

const red = await stack.checkout(stack.fresh(overreachingCart));
console.log(
  "red $95 jacket:",
  red.verdict.outcome,
  red.verdict.reasons.join(", "),
  "| paypal order:",
  red.paypal_order_id ?? "none",
);

const grey = await stack.checkout(stack.fresh(compliantCart));
console.log(
  "grey $74 jacket:",
  grey.verdict.outcome,
  grey.verdict.reasons.join(", ") || "-",
  "| paypal order:",
  grey.paypal_order_id,
);

const { body: order } = await paypalRaw<{
  status: string;
  intent: string;
  purchase_units: { custom_id: string; invoice_id: string }[];
}>("GET", `/v2/checkout/orders/${grey.paypal_order_id}`);
const unit = order.purchase_units[0]!;
const expected = customId(stack.intent.mandate_id, mandateHash(stack.intent));
console.log(
  "on PayPal:",
  order.intent,
  order.status,
  "| custom_id",
  unit.custom_id,
  unit.custom_id === expected ? "(matches the mandate pointer)" : `(EXPECTED ${expected})`,
  "| invoice_id",
  unit.invoice_id,
);
await stack.close();
