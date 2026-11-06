/** Passes the merchant API's answer through, or a 502 when it can't be reached. */
export async function relay(call: () => Promise<Response>): Promise<Response> {
  try {
    const res = await call();
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
