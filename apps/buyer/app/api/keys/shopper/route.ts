// The browser registers its public key with the merchant API (POST /keys/shopper, public). Proxied so the
// browser stays same-origin and never needs the API's address.
import { apiBase } from "../../../../src/agent-server";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/keys/shopper`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
