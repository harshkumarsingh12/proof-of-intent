// Proxies read-only dashboard calls to the merchant API at request time. Server-side, so the
// container reaches the API on the compose network and the browser stays same-origin (no CORS).
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:3000";
  const target = `${base}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  try {
    const res = await fetch(target, { headers: { accept: "application/json" }, cache: "no-store" });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { error: "api_unreachable", message: "The merchant API did not respond" },
      { status: 502 },
    );
  }
}
