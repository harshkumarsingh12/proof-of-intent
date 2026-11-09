import { describe, expect, test } from "vitest";
import type { IntentMandate } from "@poi/contracts";
import { MERCHANT_ID, NOW } from "@poi/contracts/fixtures";
import { authorizationRows } from "./authorization";
import { buildIntent, type IntentForm } from "./intent";

const form: IntentForm = {
  description: "a grey running jacket",
  maxPrice: "80",
  category: "running-jacket",
  color: "grey",
  validDays: 7,
  confirmEachCart: false,
};

const intentFor = (over: Partial<IntentForm> = {}, agentPlatform?: string) =>
  buildIntent(
    { ...form, ...over },
    {
      kid: "shp_x",
      merchantId: MERCHANT_ID,
      now: new Date(NOW),
      mandateId: "0192f3a0-0000-7000-8000-000000000001",
      nonce: "n-0123456789abcdef",
      ...(agentPlatform ? { agentPlatform } : {}),
    },
  );

const card = (intent: IntentMandate) =>
  Object.fromEntries(authorizationRows(intent, (iso) => `at ${iso}`).map((r) => [r.label, r.value]));

describe("authorization card (#176): what the signed intent allows", () => {
  test("the shop's default intent: the item, one purchase up to the cap, and the shopper approving at PayPal", () => {
    const intent = intentFor();
    expect(card(intent)).toEqual({
      Item: "a grey running jacket (running jacket, grey)",
      Spending: "At most $80 per purchase",
      Purchases: "One",
      Agent: "Any registered agent may propose a cart; none can pay without you",
      Payment: "You approve each payment at PayPal",
      Expires: `at ${intent.intent_expiry}`,
    });
  });

  test("the rows come in a fixed order, so the card reads the same every time", () => {
    expect(authorizationRows(intentFor()).map((r) => r.label)).toEqual([
      "Item",
      "Spending",
      "Purchases",
      "Agent",
      "Payment",
      "Expires",
    ]);
  });

  test("an item left open shows only the shopper's words", () => {
    expect(card(intentFor({ category: "", color: "" })).Item).toBe("a grey running jacket");
    expect(card(intentFor({ color: "" })).Item).toBe("a grey running jacket (running jacket)");
  });

  test("a signed budget or order count is shown as what the shopper signed", () => {
    const base = intentFor();
    const budget = { ...base, constraints: { ...base.constraints, budget_cap: { value: 15050, currency: "USD" } } };
    expect(card(budget).Spending).toBe("Up to $150.50 in total, at most $80 per purchase");
    expect(card(budget).Purchases).toBe("As many as fit the budget");
    const orders = { ...base, constraints: { ...base.constraints, recurrence: { max_orders: 3, window_days: 30 } } };
    expect(card(orders).Purchases).toBe("Up to 3 every 30 days");
    expect(card(orders).Spending).toBe("At most $80 per purchase");
  });

  test("paying alone names the one agent platform it was signed for", () => {
    const alone = card(intentFor({ payAlone: true }, "ShopBot"));
    expect(alone.Agent).toBe("Only ShopBot may pay without you");
    expect(alone.Payment).toBe("Your agent may pay from your saved PayPal wallet without you");
  });

  test("paying alone with no platform named allows any registered agent", () => {
    expect(card(intentFor({ payAlone: true })).Agent).toBe("Any registered agent may pay without you");
  });

  test("confirm every cart is stated with the payment mode", () => {
    expect(card(intentFor({ confirmEachCart: true })).Payment).toBe(
      "You approve each payment at PayPal. You also confirm every cart first",
    );
  });

  test("the expiry is the signed intent_expiry, through the formatter the shop passes", () => {
    const intent = intentFor({ validDays: 3 });
    expect(authorizationRows(intent, (iso) => iso).find((r) => r.label === "Expires")?.value).toBe(intent.intent_expiry);
  });
});
