// The shop assistant (docs/specs/0010): answers questions about the store, the shopper's limits and why a cart was refused
// or held. Read-only: it cannot sign, buy or propose a checkout. Body: { messages, context? }. Off unless BUYER_CHAT=1.
import { handleChat } from "../../../../src/chat-server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = await handleChat({ headers: req.headers, body: await req.text() });
  return Response.json(res.body, { status: res.status, ...(res.headers ? { headers: res.headers } : {}) });
}
