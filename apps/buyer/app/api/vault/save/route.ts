// Finishes saving a PayPal wallet: the setup token PayPal returned plus a signed proof (POST /vault/save).
import { apiBase } from "../../../../src/agent-server";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/vault/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
