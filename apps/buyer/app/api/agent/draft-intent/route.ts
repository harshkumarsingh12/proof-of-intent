// The buyer agent turns the shopper's words into a DRAFT intent form. Body: { text }. It never signs: the
// shopper reviews the draft and signs it with the key that stays in their browser.
import { AgentUnavailableError } from "../../../../src/agent";
import { agentDraftIntent } from "../../../../src/agent-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 500) {
    return Response.json(
      { error: "invalid_request", message: "Expected { text }, up to 500 characters" },
      { status: 400 },
    );
  }
  try {
    return Response.json(await agentDraftIntent(body.text));
  } catch (err) {
    const message = (err as Error).message;
    return Response.json(
      { error: err instanceof AgentUnavailableError ? "agent_unavailable" : "draft_failed", message },
      { status: err instanceof AgentUnavailableError ? 503 : 400 },
    );
  }
}
