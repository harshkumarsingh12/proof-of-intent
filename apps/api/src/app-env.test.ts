import { afterEach, describe, expect, test, vi } from "vitest";
import { buyerBaseFromEnv, depsFromEnv } from "./app";

describe("BUYER_PUBLIC_URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("is the shop's address when set, and the local default (flagged) when not", () => {
    expect(buyerBaseFromEnv({ BUYER_PUBLIC_URL: "https://poi-buyer.iotkiit.in" })).toEqual({
      url: "https://poi-buyer.iotkiit.in",
      defaulted: false,
    });
    for (const unset of [undefined, "", "  "]) {
      expect(buyerBaseFromEnv({ BUYER_PUBLIC_URL: unset })).toEqual({
        url: "http://localhost:3001",
        defaulted: true,
      });
    }
  });

  test("sandbox mode with the default warns, because hosted shoppers would be sent to localhost", async () => {
    // createPayPalClient reads its credentials from the process environment.
    for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"]) vi.stubEnv(k, "x");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      PAYPAL_MODE: "sandbox",
      PAYPAL_CLIENT_ID: "i",
      PAYPAL_CLIENT_SECRET: "s",
      PAYPAL_WEBHOOK_ID: "w",
    };
    // No MERCHANT_SIGNING_KEY: depsFromEnv throws for that after the warning, which is all this checks.
    await expect(depsFromEnv(env)).rejects.toThrow("MERCHANT_SIGNING_KEY");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("BUYER_PUBLIC_URL is not set"));
    warn.mockClear();
    await expect(depsFromEnv({ ...env, BUYER_PUBLIC_URL: "https://shop.example" })).rejects.toThrow(
      "MERCHANT_SIGNING_KEY",
    );
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("BUYER_PUBLIC_URL"));
    warn.mockRestore();
  });
});
