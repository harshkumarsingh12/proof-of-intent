import { describe, expect, test } from "vitest";
import { createMockClient } from "@poi/paypal";
import { buildApp } from "./app";
import { RATE_LIMITS } from "./rate-limits";

const hit = (app: ReturnType<typeof buildApp>, method: "GET" | "POST", url: string, ip = "203.0.113.7") =>
  app.inject({ method, url, payload: method === "POST" ? {} : undefined, remoteAddress: ip });

describe("rate limits", () => {
  test("checkout allows its quota per IP, then answers 429 in the API's error shape", async () => {
    const app = buildApp({ paypal: createMockClient() });
    for (let i = 0; i < RATE_LIMITS.checkout.max; i++) {
      expect((await hit(app, "POST", "/checkout")).statusCode).not.toBe(429);
    }
    const limited = await hit(app, "POST", "/checkout");
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: "rate_limited",
      message: expect.stringContaining("retry in"),
    });
    expect(limited.headers["retry-after"]).toBeTruthy();
    // Another client is unaffected.
    expect((await hit(app, "POST", "/checkout", "198.51.100.9")).statusCode).not.toBe(429);
  });

  test("each endpoint has its own budget, and health checks are never limited", async () => {
    const app = buildApp({ paypal: createMockClient() });
    for (let i = 0; i <= RATE_LIMITS.checkout.max; i++) await hit(app, "POST", "/checkout");
    expect((await hit(app, "POST", "/webhooks/paypal")).statusCode).not.toBe(429);
    for (let i = 0; i < 100; i++) expect((await hit(app, "GET", "/healthz")).statusCode).toBe(200);
  });

  test("the Studio endpoint is limited even for malformed authenticated requests", async () => {
    const app = buildApp({ paypal: createMockClient(), operatorToken: "test-only" });
    const studio = () =>
      app.inject({
        method: "POST",
        url: "/ai/studio",
        payload: {},
        headers: { authorization: "Bearer test-only" },
      });
    for (let i = 0; i < RATE_LIMITS.studio.max; i++) expect((await studio()).statusCode).toBe(400);
    expect((await studio()).statusCode).toBe(429);
  });
});
