// The shopper's signed CartApproval for a step-up; the merchant re-checks and only then charges the saved wallet.
import { apiBase } from "../../../../../src/agent-server";
import { isStepUpToken } from "../../../../../src/stepup";
import { relay } from "../../../relay";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isStepUpToken(token)) {
    return Response.json(
      { error: "stepup_not_found", message: "This approval link is not valid" },
      { status: 404 },
    );
  }
  const body = await req.text();
  return relay(() =>
    fetch(`${apiBase()}/stepup/${encodeURIComponent(token)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
    }),
  );
}
