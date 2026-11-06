import { describe, expect, test } from "vitest";
import { createMockClient } from "@poi/paypal";
import { buildApp } from "./app";

describe("api", () => {
  test("healthz returns ok", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  test("unbuilt routes say who owns them", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({
      method: "GET",
      url: "/analytics/overview",
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().owner).toBe("hoursgotviral-dev");
  });
});
