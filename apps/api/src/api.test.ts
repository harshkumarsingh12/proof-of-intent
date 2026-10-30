import { describe, expect, test } from "vitest";
import { greyJacketIntent, overreachingCart } from "@poi/contracts/fixtures";
import { ledger } from "@poi/ledger";
import { buildApp } from "./app";

describe("api", () => {
  test("healthz returns ok", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  test("unbuilt routes say who owns them", async () => {
    const res = await buildApp().inject({ method: "GET", url: "/disputes" });
    expect(res.statusCode).toBe(501);
    expect(res.json().owner).toBe("hoursgotviral-dev");
  });
});

describe("checkout (unbuilt)", () => {
  ledger("M1", "harshkumarsingh12", "POST /checkout rejects the red $95 jacket before any PayPal order exists", async () => {
    const res = await buildApp().inject({
      method: "POST",
      url: "/checkout",
      payload: { intent: greyJacketIntent, cart: overreachingCart },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verdict.outcome).toBe("REJECT");
    expect(res.json().paypalOrderId).toBeUndefined();
  });

  ledger("M1", "harshkumarsingh12", "webhook receiver answers 400 to an unverified delivery", async () => {
    const res = await buildApp().inject({ method: "POST", url: "/webhooks/paypal", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  ledger("M2", "srshriv", "step-up approval link captures only after the shopper approves", async () => {
    const res = await buildApp().inject({ method: "POST", url: "/stepup/test-token/approve" });
    expect(res.statusCode).toBe(200);
  });
});
