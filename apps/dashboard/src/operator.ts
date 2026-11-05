import { createHash, timingSafeEqual } from "node:crypto";

/** The only POST the dashboard proxies: an operator action on one dispute (docs/specs/0003). */
export function isOperatorActionPath(path: string[]): boolean {
  return path.length === 4 && path[0] === "disputes" && path[2] === "actions" && /^[a-z-]+$/.test(path[3]!);
}

/**
 * HTTP Basic check for user "operator". The browser shows its own login prompt on the 401, then retries,
 * so the dashboard needs no login page. Viewers (no password) can read everything and act on nothing.
 */
export function isOperator(authorization: string | null, password: string): boolean {
  const encoded = /^Basic (.+)$/i.exec(authorization ?? "")?.[1];
  if (!encoded) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(
    digest(Buffer.from(encoded, "base64").toString("utf8")),
    digest(`operator:${password}`),
  );
}

export const OPERATOR_REALM = 'Basic realm="Proof of Intent operator", charset="UTF-8"';
