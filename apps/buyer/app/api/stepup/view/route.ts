// The approval page reads what it is asking the shopper to approve (POST /stepup/view, spec 0003). The token comes in
// the body, never the path, so no proxy in front of the shop or the API records it (#257).
import { apiBase } from "../../../../src/agent-server";
import { stepUpBody } from "../../../../src/stepup-relay";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await stepUpBody(req, false);
  if (body instanceof Response) return body;
  return relay(() =>
    fetch(`${apiBase()}/stepup/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }),
  );
}
