/**
 * How the dashboard authenticates its reads of the merchant API (#163). The API refuses reads without the operator
 * token once OPERATOR_TOKEN is set. Server components call the API directly and send the token here; a browser calls
 * the dashboard's own `/api` proxy, which adds it (app/api/[...path]/route.ts). The token is read only on the server, so
 * it is never in a browser bundle or sent to a browser.
 */
export function readHeaders(): Record<string, string> {
  const token = typeof window === "undefined" ? process.env.OPERATOR_TOKEN : undefined;
  return { Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}
