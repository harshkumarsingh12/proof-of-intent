// Raw sandbox REST for scripts only: reads and sandbox-only test actions (require-evidence, adjudicate)
// that have no place in the production client. Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.
import { SANDBOX_BASE_URL } from "../../packages/paypal/src/index";

let token: string | undefined;

async function bearer(): Promise<string> {
  if (token) return token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required");
  const res = await fetch(`${SANDBOX_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
  token = ((await res.json()) as { access_token: string }).access_token;
  return token;
}

export async function paypalRaw<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${SANDBOX_BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/** Polls until `check` returns a value or the timeout passes. */
export async function waitFor<T>(
  what: string,
  check: () => Promise<T | undefined>,
  timeoutMs: number,
  everyMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let dots = 0;
  for (;;) {
    const value = await check();
    if (value !== undefined) {
      if (dots) process.stdout.write("\n");
      return value;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    if (dots++ === 0) process.stdout.write(`waiting for ${what} `);
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
