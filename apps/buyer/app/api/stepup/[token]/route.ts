// The approval page reads what it is asking the shopper to approve (GET /stepup/:token, spec 0003).
import { apiBase } from "../../../../src/agent-server";
import { isStepUpToken } from "../../../../src/stepup";
import { relay } from "../../relay";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!isStepUpToken(token)) {
    return Response.json(
      { error: "stepup_not_found", message: "This approval link is not valid" },
      { status: 404 },
    );
  }
  return relay(() => fetch(`${apiBase()}/stepup/${encodeURIComponent(token)}`, { cache: "no-store" }));
}
