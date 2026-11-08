import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { GET } from "../app/api/[...path]/route";
import { middleware } from "../middleware";
import { fetchDisputeDetailDetailed, fetchDisputesDetailed, fetchPaypalActions } from "./api";
import { fetchOrders } from "./orders";
import { isOperator, safeEqual, viewerLoginRequired } from "./operator";
import { readHeaders } from "./read-auth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("the dashboard authenticates its reads of the merchant API (#163)", () => {
  test("a server sends the operator token; a browser never has it", () => {
    vi.stubEnv("OPERATOR_TOKEN", "server-only-token");
    expect(readHeaders()).toEqual({ Accept: "application/json", Authorization: "Bearer server-only-token" });
    vi.stubGlobal("window", {});
    expect(readHeaders()).toEqual({ Accept: "application/json" });
  });

  test("with no OPERATOR_TOKEN the reads are as they were (the zero-credential stack)", () => {
    vi.stubEnv("OPERATOR_TOKEN", "");
    expect(readHeaders()).toEqual({ Accept: "application/json" });
  });

  test("every server-side read of the API carries it: disputes, detail, PayPal actions, orders and verdicts", async () => {
    vi.stubEnv("OPERATOR_TOKEN", "server-only-token");
    const seen: string[] = [];
    const fetchFn = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(`${url} ${init?.headers?.Authorization}`);
      return Response.json({ disputes: [], orders: [], verifications: [], allowed: [] });
    }) as unknown as typeof fetch;
    await fetchDisputesDetailed({ apiBaseUrl: "http://api.test", fetchFn });
    await fetchDisputeDetailDetailed("PP-D-1", { apiBaseUrl: "http://api.test", fetchFn });
    await fetchPaypalActions("PP-D-1", { apiBaseUrl: "http://api.test", fetchFn });
    await fetchOrders({ apiBaseUrl: "http://api.test", fetchFn });
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const line of seen) expect(line, line).toMatch(/ Bearer server-only-token$/);
  });

  test("the /api proxy adds the token to a read, and never returns it", async () => {
    vi.stubEnv("OPERATOR_TOKEN", "server-only-token");
    vi.stubEnv("API_INTERNAL_URL", "http://merchant.test");
    const fetch = vi.fn().mockResolvedValue(Response.json({ disputes: [] }));
    vi.stubGlobal("fetch", fetch);
    const res = await GET(new Request("http://dashboard.test/api/disputes/PP-D-1/evidence.pdf"), {
      params: Promise.resolve({ path: ["disputes", "PP-D-1", "evidence.pdf"] }),
    });
    expect(fetch.mock.calls[0]?.[0]).toBe("http://merchant.test/disputes/PP-D-1/evidence.pdf");
    expect(fetch.mock.calls[0]?.[1].headers.authorization).toBe("Bearer server-only-token");
    expect(await res.text()).not.toContain("server-only-token");
  });
});

describe("the optional viewer login (#163)", () => {
  const req = (authorization?: string, path = "/disputes") =>
    new NextRequest(
      `http://dashboard.test${path}`,
      authorization ? { headers: { authorization } } : undefined,
    );

  test("off by default: the judge demo stays open to anyone with the link", () => {
    vi.stubEnv("OPERATOR_PASSWORD", "s3cret");
    expect(viewerLoginRequired({})).toBe(false);
    expect(middleware(req()).status).toBe(200);
  });

  test("on, pages and /api calls ask for the operator login first", async () => {
    vi.stubEnv("VIEWER_LOGIN_REQUIRED", "1");
    vi.stubEnv("OPERATOR_PASSWORD", "s3cret");
    for (const path of ["/disputes", "/orders", "/analytics/studio", "/api/disputes/PP-D-1/evidence.pdf"]) {
      const res = middleware(req(undefined, path));
      expect(res.status, path).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Basic");
    }
    expect(middleware(req(basic("operator", "wrong"))).status).toBe(401);
    expect(middleware(req(basic("viewer", "s3cret"))).status).toBe(401);
    expect(middleware(req(basic("operator", "s3cret"))).status).toBe(200);
  });

  test("on without a password to check, it refuses everything instead of showing the data", async () => {
    vi.stubEnv("VIEWER_LOGIN_REQUIRED", "1");
    vi.stubEnv("OPERATOR_PASSWORD", "");
    const res = middleware(req(basic("operator", "anything")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("viewer_login_unavailable");
  });

  test("the health check and static assets are not behind it", () => {
    // The matcher is what exempts them: it is the pattern Next applies, so test it as one.
    const matcher = new RegExp(`^${"/((?!_next/static|_next/image|icon.svg|healthz).*)"}$`);
    expect(matcher.test("/healthz")).toBe(false);
    expect(matcher.test("/icon.svg")).toBe(false);
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/disputes")).toBe(true);
    expect(matcher.test("/api/disputes")).toBe(true);
  });

  test("the shared comparison is exact, including length and non-ASCII", () => {
    expect(safeEqual("operator:pässword", "operator:pässword")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(isOperator(basic("operator", "pässword"), "pässword")).toBe(true);
    expect(isOperator("Basic !!!not-base64!!!", "x")).toBe(false);
  });
});
