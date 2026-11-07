// Approve a waiting cart from the shop's own list: the shopper's CartApproval signature for this step-up id and
// cart goes to POST /stepups/:id/approve (spec 0003). The signature is what authorizes it.
import { apiBase } from "../../../../../src/agent-server";
import { isStepUpId } from "../../../../../src/stepup";
import { relay } from "../../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isStepUpId(id)) {
    return Response.json({ error: "invalid_request", message: "Unknown approval" }, { status: 400 });
  }
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/stepups/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
