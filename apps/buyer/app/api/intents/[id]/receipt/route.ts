// The shopper's signed request to the merchant's POST /intents/:id/receipt (docs/specs/0013, #176). The signature, made in the
// browser with the key that signed the intent, is what authorizes it; this only forwards it.
import { apiBase } from "../../../../../src/agent-server";
import { relay } from "../../../relay";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return Response.json(
      { error: "intent_not_found", message: "The merchant has no record of this intent" },
      { status: 404 },
    );
  }
  const body = await req.text();
  if (body.length > 4 * 1024)
    return Response.json({ error: "invalid_request", message: "Body too large" }, { status: 400 });
  return relay(() =>
    fetch(`${apiBase()}/intents/${id}/receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
