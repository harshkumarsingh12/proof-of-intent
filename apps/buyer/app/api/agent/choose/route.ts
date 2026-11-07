// The buyer agent chooses what to propose under the shopper's signed intent, then asks the merchant for a
// verdict on each cart (at most three). Body: { intent_jws, human_present? }. The merchant still decides; with
// human_present: false an approved cart is charged to the shopper's saved wallet, and only if it fits their limits.
import { AgentUnavailableError } from "../../../../src/agent";
import { agentChoose } from "../../../../src/agent-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { intent_jws?: unknown; human_present?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  if (
    typeof body.intent_jws !== "string" ||
    (body.human_present !== undefined && typeof body.human_present !== "boolean")
  ) {
    return Response.json(
      { error: "invalid_request", message: "Expected { intent_jws, human_present? }" },
      { status: 400 },
    );
  }
  try {
    return Response.json(await agentChoose(body.intent_jws, body.human_present ?? true));
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof AgentUnavailableError) {
      return Response.json({ error: "agent_unavailable", message }, { status: 503 });
    }
    const unreachable = err instanceof TypeError && /fetch/i.test(message);
    return Response.json(
      unreachable
        ? { error: "api_unreachable", message: "The merchant API did not respond" }
        : { error: "agent_failed", message },
      { status: unreachable ? 502 : 400 },
    );
  }
}
