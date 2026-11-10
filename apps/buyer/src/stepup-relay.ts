/**
 * The body the shop's step-up proxy routes accept and pass on (#257): `{ token }` to view, `{ token, approval_jws }` to
 * approve. Only those fields go on to the merchant API, and a token that can't be one is answered here without a call.
 */
import { isStepUpToken } from "./stepup";

const MAX_BODY_BYTES = 16 * 1024;

const notFound = () =>
  Response.json({ error: "stepup_not_found", message: "This approval link is not valid" }, { status: 404 });
const invalid = (message: string) => Response.json({ error: "invalid_request", message }, { status: 400 });

export async function stepUpBody(
  req: Request,
  withApproval: boolean,
): Promise<{ token: string; approval_jws?: string } | Response> {
  const expected = withApproval ? "Expected { token, approval_jws }" : "Expected { token }";
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return invalid(expected);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid(expected);
  }
  const { token, approval_jws } = (parsed ?? {}) as { token?: unknown; approval_jws?: unknown };
  if (typeof token !== "string") return invalid(expected);
  if (!isStepUpToken(token)) return notFound();
  if (!withApproval) return { token };
  if (typeof approval_jws !== "string" || approval_jws === "") return invalid(expected);
  return { token, approval_jws };
}
