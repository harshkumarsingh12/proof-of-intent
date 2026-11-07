// Forgets the saved PayPal wallet: the browser's signed proof goes to POST /vault/remove (spec 0004 §Vault).
import { apiBase } from "../../../../src/agent-server";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/vault/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
