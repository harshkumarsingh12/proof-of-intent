import { describe, expect, test } from "vitest";
import { ledger } from "@poi/ledger";
import { createMockClient } from "@poi/paypal";
import { buildApp } from "./app";

describe("api", () => {
  test("healthz returns ok", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  test("unbuilt routes say who owns them", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({ method: "GET", url: "/disputes" });
    expect(res.statusCode).toBe(501);
    expect(res.json().owner).toBe("hoursgotviral-dev");
  });
});

describe("checkout (unbuilt)", () => {
  ledger("M2", "srshriv", "step-up approval link captures only after the shopper approves", async () => {
    const res = await buildApp({ paypal: createMockClient() }).inject({
      method: "POST",
      url: "/stepup/test-token/approve",
    });
    expect(res.statusCode).toBe(200);
  });
});
