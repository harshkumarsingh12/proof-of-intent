// Vault v3 against the PayPal sandbox (#17, spec 0004 §Vault). Owner: @harshkumarsingh12.
//
//   pnpm sandbox:vault-wallet --setup-only     creates a MERCHANT setup token and prints PayPal's approval link
//   pnpm sandbox:vault-wallet                  the whole loop: setup token → you approve as a sandbox shopper →
//                                              payment token (the vault_id) → a $1.00 CAPTURE order against it
//
// PayPal credentials come from .env. The full run needs a human for one step, the approval on PayPal, and then
// proves what agent-alone checkout relies on: a vaulted wallet charges with no shopper present.
import { createInterface } from "node:readline/promises";
import { createPayPalClient } from "../../packages/paypal/src/index";

const returnUrl = process.env.VAULT_RETURN_URL ?? "https://poi-buyer.iotkiit.in/shop/wallet";
const paypal = createPayPalClient("sandbox");

const setup = await paypal.createVaultSetupToken({
  returnUrl,
  cancelUrl: returnUrl.replace(/\/wallet$/, ""),
});
console.log("setup token:", setup.setupTokenId);
console.log("approval link:", setup.approvalUrl);

if (process.argv.includes("--setup-only")) {
  console.log("PayPal accepted the setup token request (--setup-only: stopping before approval).");
  process.exit(0);
}

console.log(
  "\nOpen the link, log in as a sandbox shopper and approve. PayPal sends the browser to the return URL.",
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
await rl.question("Press Enter once you have approved… ");
rl.close();

const { vaultId } = await paypal.createVaultPaymentToken(setup.setupTokenId);
console.log("vault id (payment token):", vaultId);

const orderId = `ord_vault_smoke_${Date.now()}`;
const order = await paypal.createOrder({
  intent: "CAPTURE",
  ourOrderId: orderId,
  customId: "poi:vault-smoke:0000000000000000",
  total: { value: 100, currency: "USD" },
  items: [
    {
      sku: "VAULT-SMOKE",
      name: "Vault smoke test",
      unitAmount: { value: 100, currency: "USD" },
      quantity: 1,
    },
  ],
  vaultId,
});
console.log(
  "vaulted CAPTURE order:",
  order.id,
  order.status,
  order.captureId ? `capture ${order.captureId}` : "(no capture id)",
);
if (order.status !== "COMPLETED" || !order.captureId) {
  console.error("Expected the vaulted order to complete at creation with a capture.");
  process.exit(1);
}
