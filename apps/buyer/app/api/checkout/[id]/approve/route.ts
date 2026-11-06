// PayPal's onApprove: the browser sends the shopper's countersignature (CartApproval, spec 0001) and the
// merchant authorizes, re-checks and captures or voids (POST /checkout/:id/approve, spec 0003 stage 2).
import { apiBase } from "../../../../../src/agent-server";
import { relay } from "../../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^ord_[\w-]{1,64}$/.test(id)) {
    return Response.json({ error: "invalid_request", message: "Unknown order id" }, { status: 400 });
  }
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/checkout/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
