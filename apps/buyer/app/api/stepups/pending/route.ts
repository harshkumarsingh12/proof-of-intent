// The carts waiting for this shopper: the browser's signed proof goes to POST /stepups/pending (spec 0003).
import { apiBase } from "../../../../src/agent-server";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/stepups/pending`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
