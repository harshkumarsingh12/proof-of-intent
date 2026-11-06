// Proxies dashboard calls to the merchant API at request time. Server-side, so the container reaches the
// API on the compose network and the browser stays same-origin (no CORS). Reads are open; the only write is
// an operator dispute action, which needs the operator login and carries OPERATOR_TOKEN (never sent to browsers).
import { isOperator, isOperatorActionPath, OPERATOR_REALM } from "../../../src/operator";

export const dynamic = "force-dynamic";

const base = () => process.env.API_INTERNAL_URL ?? "http://localhost:3000";
const unreachable = () =>
  Response.json({ error: "api_unreachable", message: "The merchant API did not respond" }, { status: 502 });

function relay(res: Response): Response {
  const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json" });
  const disposition = res.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(res.body, { status: res.status, headers });
}

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = `${base()}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  try {
    return relay(await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" }));
  } catch {
    return unreachable();
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const studio = path.length === 2 && path[0] === "ai" && path[1] === "studio";
  if (!studio && !isOperatorActionPath(path)) {
    return Response.json(
      { error: "not_found", message: "Unknown dashboard operation" },
      { status: 404 },
    );
  }
  if (studio && req.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return Response.json({ error: "invalid_request", message: "Studio expects JSON" }, { status: 415 });
  }
  const token = process.env.OPERATOR_TOKEN;
  const password = process.env.OPERATOR_PASSWORD;
  if (!token || !password) {
    return Response.json(
      {
        error: "operator_actions_disabled",
        message: "Operator actions are not configured on this deployment",
      },
      { status: 503 },
    );
  }
  if (!isOperator(req.headers.get("authorization"), password)) {
    return Response.json(
      { error: "operator_login_required", message: "Sign in as the operator to act on disputes" },
      { status: 401, headers: { "www-authenticate": OPERATOR_REALM } },
    );
  }
  try {
    const res = await fetch(`${base()}/${path.map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "x-operator": "operator",
      },
      body: (await req.text()) || "{}",
      cache: "no-store",
    });
    return relay(res);
  } catch {
    return unreachable();
  }
}
