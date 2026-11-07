// The buyer agent proposes a cart under the shopper's signed intent and asks the merchant for a verdict.
// Body: { intent_jws, sku, human_present? }. The agent signs the Payment Mandate server-side; the browser never
// sees its key. human_present: false is the agent paying alone from the shopper's saved PayPal wallet.
import { agentCheckout } from "../../../../src/agent-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { intent_jws?: unknown; sku?: unknown; human_present?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  if (
    typeof body.intent_jws !== "string" ||
    typeof body.sku !== "string" ||
    (body.human_present !== undefined && typeof body.human_present !== "boolean")
  ) {
    return Response.json(
      { error: "invalid_request", message: "Expected { intent_jws, sku, human_present? }" },
      { status: 400 },
    );
  }
  try {
    const res = await agentCheckout(body.intent_jws, body.sku, body.human_present ?? true);
    return Response.json(res.body, { status: res.status });
  } catch (err) {
    const message = (err as Error).message;
    const unreachable = err instanceof TypeError && /fetch/i.test(message);
    return Response.json(
      unreachable
        ? { error: "api_unreachable", message: "The merchant API did not respond" }
        : { error: "agent_failed", message },
      { status: unreachable ? 502 : 400 },
    );
  }
}
