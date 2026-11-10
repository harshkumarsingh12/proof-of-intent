// The shopper's signed CartApproval for a step-up; the merchant re-checks and only then charges the saved wallet.
// The token comes in the body, never the path (#257).
import { apiBase } from "../../../../src/agent-server";
import { stepUpBody } from "../../../../src/stepup-relay";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await stepUpBody(req, true);
  if (body instanceof Response) return body;
  return relay(() =>
    fetch(`${apiBase()}/stepup/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    }),
  );
}
