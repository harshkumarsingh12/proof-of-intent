/** The only POST the dashboard proxies besides Studio: an operator action on one dispute (docs/specs/0003). */
export function isOperatorActionPath(path: string[]): boolean {
  return path.length === 4 && path[0] === "disputes" && path[2] === "actions" && /^[a-z-]+$/.test(path[3]!);
}

/**
 * Equal strings, without stopping at the first difference. Plain JS rather than node:crypto, because the viewer
 * login runs in Next's middleware, which has no Node APIs; the proxy and the middleware share this check.
 */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * HTTP Basic check for user "operator". The browser shows its own login prompt on the 401, then retries,
 * so the dashboard needs no login page. Viewers (no password) can read everything and act on nothing, unless
 * the deployment asks for the login on reads too (`VIEWER_LOGIN_REQUIRED`, see `viewerLoginRequired`).
 */
export function isOperator(authorization: string | null, password: string): boolean {
  const encoded = /^Basic (.+)$/i.exec(authorization ?? "")?.[1];
  if (!encoded) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  return safeEqual(decoded, `operator:${password}`);
}

export const OPERATOR_REALM = 'Basic realm="Proof of Intent operator", charset="UTF-8"';

/**
 * Whether the dashboard asks for the operator login before it shows anything. Off by default so the judge demo, which
 * runs on synthetic sandbox data, stays open to anyone with the link; a deployment with real merchant data sets
 * `VIEWER_LOGIN_REQUIRED=1` (#163).
 */
export const viewerLoginRequired = (env: Record<string, string | undefined> = process.env): boolean =>
  env.VIEWER_LOGIN_REQUIRED === "1";
