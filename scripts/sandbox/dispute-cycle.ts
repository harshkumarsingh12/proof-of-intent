// Sandbox dispute recipe (docs/specs/0004 §Sandbox dispute recipe, issue #28). Owner: @harshkumarsingh12.
//
//   DATABASE_URL=postgres://… pnpm sandbox:dispute-cycle start
//   pnpm sandbox:dispute-cycle evidence   <dispute id>              provide-evidence with an attestation PDF
//   pnpm sandbox:dispute-cycle message    <dispute id> "<text>"     send-message to the buyer
//   pnpm sandbox:dispute-cycle adjudicate <dispute id> seller|buyer settle it (sandbox only)
//   pnpm sandbox:dispute-cycle status     <dispute id>
//
// `start` runs a compliant order through our real API (checkout → you approve as the sandbox shopper →
// stage 2 capture), then waits while you open a dispute in the Resolution Center as that shopper (the one
// manual click), and finally moves it to the seller's court with require-evidence when PayPal allows.
import { compliantCart } from "../../packages/contracts/src/fixtures";
import { createPayPalClient } from "../../packages/paypal/src/index";
import { generateEvidencePdf } from "../../apps/worker/src/pdf";
import { paypalRaw, waitFor } from "./paypal-raw";
import { sandboxStack } from "./stack";

interface Dispute {
  dispute_id: string;
  status: string;
  reason: string;
  dispute_amount?: { value: string; currency_code: string };
  seller_response_due_date?: string;
  evidences?: { evidence_type: string; documents?: { name: string }[] }[];
  messages?: unknown[];
  dispute_outcome?: { outcome_code: string };
}

const [command, disputeId, arg] = process.argv.slice(2);

const getDispute = async (id: string) =>
  (await paypalRaw<Dispute>("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`)).body;

const show = (d: Dispute) =>
  console.log(
    `${d.dispute_id}: ${d.status} | ${d.reason} | ${d.dispute_amount?.value ?? "?"} ${d.dispute_amount?.currency_code ?? ""}` +
      ` | evidence: ${d.evidences?.length ?? 0} | messages: ${d.messages?.length ?? 0}` +
      (d.dispute_outcome ? ` | outcome: ${d.dispute_outcome.outcome_code}` : "") +
      (d.seller_response_due_date ? ` | respond by ${d.seller_response_due_date}` : ""),
  );

async function start() {
  const stack = await sandboxStack();
  const order = await stack.checkout(stack.fresh(compliantCart));
  if (!order.approval_url) throw new Error(`checkout did not create an order: ${JSON.stringify(order)}`);
  console.log(`order ${order.order_id} (PayPal ${order.paypal_order_id}), verdict ${order.verdict.outcome}`);
  console.log(`\n1/2  Approve as the sandbox PERSONAL account:\n     ${order.approval_url}\n`);

  await waitFor(
    "the shopper's approval on PayPal",
    async () => {
      const { body } = await paypalRaw<{ status: string }>(
        "GET",
        `/v2/checkout/orders/${order.paypal_order_id}`,
      );
      return body.status === "APPROVED" ? true : undefined;
    },
    15 * 60_000,
  );
  const captured = await stack.approve(order.order_id, order.cartMandateHash);
  if (captured.status !== "CAPTURED") throw new Error(`stage 2 did not capture: ${JSON.stringify(captured)}`);
  console.log(`captured ${captured.capture_id} through POST /checkout/:id/approve`);

  console.log(
    `\n2/2  As the same shopper, open https://www.sandbox.paypal.com/resolutioncenter , find the $74.00 payment,` +
      `\n     report a problem → "item not as described".\n`,
  );
  const dispute = await waitFor(
    "the dispute",
    async () => {
      const { body } = await paypalRaw<{ items?: Dispute[] }>(
        "GET",
        `/v1/customer/disputes?disputed_transaction_id=${captured.capture_id}`,
      );
      return body.items?.[0];
    },
    20 * 60_000,
    10_000,
  );
  let current = await getDispute(dispute.dispute_id);
  if (current.status === "UNDER_REVIEW") {
    const res = await paypalRaw("POST", `/v1/customer/disputes/${dispute.dispute_id}/require-evidence`, {
      action: "SELLER_EVIDENCE",
    });
    console.log(`require-evidence → HTTP ${res.status}`);
    current = await getDispute(dispute.dispute_id);
  }
  show(current);
  console.log(
    `\nnext: pnpm sandbox:dispute-cycle evidence ${dispute.dispute_id}   (or let the copilot do it)`,
  );
  await stack.close();
}

async function evidence(id: string) {
  const d = await getDispute(id);
  const pdf = generateEvidencePdf({
    summary: {
      disputeId: d.dispute_id,
      orderId: "see custom_id",
      customId: "see the PayPal transaction",
      status: d.status,
      reason: d.reason,
      amount: `${d.dispute_amount?.currency_code ?? ""} ${d.dispute_amount?.value ?? ""}`.trim(),
      responseDueDate: d.seller_response_due_date,
    },
    coverNote:
      "Sandbox recipe evidence: the order was verified against the shopper's signed Intent Mandate before capture.",
  });
  await createPayPalClient("sandbox").provideEvidence(id, {
    notes: "Signed Intent Mandate attestation (Proof of Intent sandbox recipe).",
    files: [{ name: "attestation.pdf", data: pdf }],
  });
  console.log("provide-evidence accepted");
  show(await getDispute(id));
}

async function adjudicate(id: string, side: string) {
  if (side !== "seller" && side !== "buyer") throw new Error('adjudicate needs "seller" or "buyer"');
  const res = await paypalRaw("POST", `/v1/customer/disputes/${id}/adjudicate`, {
    adjudication_outcome: side === "seller" ? "SELLER_FAVOR" : "BUYER_FAVOR",
  });
  console.log(`adjudicate → HTTP ${res.status}${res.status >= 400 ? ` ${JSON.stringify(res.body)}` : ""}`);
  show(await getDispute(id));
}

const need = (v: string | undefined, what: string) => {
  if (!v) throw new Error(`missing ${what}; see the usage at the top of scripts/sandbox/dispute-cycle.ts`);
  return v;
};

if (command === "start") await start();
else if (command === "evidence") await evidence(need(disputeId, "dispute id"));
else if (command === "message") {
  await createPayPalClient("sandbox").sendMessage(need(disputeId, "dispute id"), need(arg, "message text"));
  show(await getDispute(disputeId!));
} else if (command === "adjudicate")
  await adjudicate(need(disputeId, "dispute id"), need(arg, "seller|buyer"));
else if (command === "status") show(await getDispute(need(disputeId, "dispute id")));
else
  throw new Error(
    "usage: start | evidence <id> | message <id> <text> | adjudicate <id> seller|buyer | status <id>",
  );
