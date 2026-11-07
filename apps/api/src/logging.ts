/**
 * What the API writes to its logs (SECURITY.md: "logs contain no secrets"). Fastify logs every request's URL, and a
 * step-up link carries its secret token in the path (`/stepup/<token>`, `/stepup/<token>/approve`), so without this the
 * token landed in the access log on every view and approval.
 */
import type { FastifyRequest, FastifyServerOptions } from "fastify";

/** The URL with any secret path segment replaced. Only the step-up token travels in a path; everything else is an id. */
export const redactUrl = (url: string): string => url.replace(/^(\/stepup\/)[^/?#]+/, "$1[redacted]");

/**
 * Fastify's logger options: its own request fields (method, url, version, host, address, port), with the URL redacted.
 * `stream` is for tests, so they can read what was logged.
 */
export function loggerOptions(stream?: NodeJS.WritableStream): Exclude<FastifyServerOptions["logger"], boolean | undefined> {
  return {
    ...(stream ? { stream } : {}),
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: redactUrl(req.url),
        version: [req.headers?.["accept-version"]].flat()[0],
        host: req.host,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort,
      }),
    },
  };
}
