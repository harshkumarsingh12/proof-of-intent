/**
 * The optional viewer login (#163). With `VIEWER_LOGIN_REQUIRED=1`, every page and every `/api` call on the dashboard
 * asks for the operator login (HTTP Basic, user "operator") first, so a deployment with real merchant data shows nothing
 * to someone without it. Off by default: the judge demo runs on synthetic sandbox data and stays open to anyone with
 * the link. The API's own reads are protected either way (they need OPERATOR_TOKEN, which only this server holds).
 */
import { NextResponse, type NextRequest } from "next/server";
import { isOperator, OPERATOR_REALM, viewerLoginRequired } from "./src/operator";

export function middleware(req: NextRequest) {
  if (!viewerLoginRequired()) return NextResponse.next();
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) {
    // Asked for a login that cannot exist: refuse everything rather than quietly show the data.
    return NextResponse.json(
      {
        error: "viewer_login_unavailable",
        message: "VIEWER_LOGIN_REQUIRED is set but OPERATOR_PASSWORD is not",
      },
      { status: 503 },
    );
  }
  if (isOperator(req.headers.get("authorization"), password)) return NextResponse.next();
  return new NextResponse("Sign in as the operator to view this dashboard", {
    status: 401,
    headers: { "www-authenticate": OPERATOR_REALM },
  });
}

export const config = {
  // Static assets, the icon and the health check stay open: they carry no merchant data and probes need /healthz.
  matcher: ["/((?!_next/static|_next/image|icon.svg|healthz).*)"],
};
