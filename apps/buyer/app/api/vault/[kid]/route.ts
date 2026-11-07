// Whether this shopper key has a saved wallet (GET /vault/:kid answers only yes or no).
import { apiBase } from "../../../../src/agent-server";
import { isShopperKid } from "../../../../src/wallet";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ kid: string }> }) {
  const { kid } = await params;
  if (!isShopperKid(kid)) {
    return Response.json({ error: "invalid_request", message: "Unknown shopper key" }, { status: 400 });
  }
  return relay(() => fetch(`${apiBase()}/vault/${encodeURIComponent(kid)}`, { cache: "no-store" }));
}
