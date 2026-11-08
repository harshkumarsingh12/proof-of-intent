import { describe, expect, it } from "vitest";
import {
  actionLabel,
  actorLabel,
  fetchDisputeAudit,
  operatorRowsPrecedePayPal,
  type DisputeAuditEntry,
} from "./audit";

const row = (id: number, actor: string, action: string, more: Partial<DisputeAuditEntry> = {}) => ({
  id,
  at: "2026-11-08T10:00:00.000Z",
  actor,
  action,
  ...more,
});

describe("dispute audit panel (#74)", () => {
  it("names who acted, from the login rather than a free-text handle", () => {
    expect(actorLabel("operator:dashboard")).toBe("operator");
    expect(actorLabel("operator:sikruti")).toBe("sikruti");
    expect(actorLabel("paypal")).toBe("PayPal");
    expect(actorLabel("api")).toBe("merchant API");
  });

  it("words each action, and says when accepting the claim overrode a defend recommendation", () => {
    expect(actionLabel({ action: "operator.provide-evidence" })).toBe(
      "Operator submitted the evidence package",
    );
    expect(actionLabel({ action: "operator.accept-claim", override: true })).toContain("overriding");
    expect(actionLabel({ action: "operator.accept-claim" })).not.toContain("overriding");
    expect(actionLabel({ action: "paypal.escalate.failed" })).toBe("PayPal did not complete: escalate");
    expect(actionLabel({ action: "something.new" })).toBe("something.new");
  });

  it("checks that every PayPal call has an operator click before it", () => {
    const good = [
      row(1, "paypal", "webhook.received"),
      row(2, "operator:dashboard", "operator.accept-claim"),
      row(3, "api", "paypal.accept-claim"),
    ];
    expect(operatorRowsPrecedePayPal(good)).toBe(true);
    expect(operatorRowsPrecedePayPal([good[2]!, good[1]!])).toBe(false); // PayPal first
    expect(operatorRowsPrecedePayPal([row(1, "api", "paypal.escalate")])).toBe(false); // no click at all
    expect(operatorRowsPrecedePayPal([row(1, "api", "paypal.escalate.failed")])).toBe(true); // failures aren't calls made
  });

  it("reads the rows through the API, and reports unavailable rather than an empty trail", async () => {
    const entries = [row(1, "operator:dashboard", "operator.escalate")];
    const ok = (async (url: string) => {
      expect(url).toBe("/api/disputes/PP-D-1/audit");
      return new Response(JSON.stringify({ entries }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchDisputeAudit("PP-D-1", { fetchFn: ok })).toEqual({ entries });
    const missing = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await fetchDisputeAudit("PP-D-1", { fetchFn: missing })).toEqual({ unavailable: true });
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchDisputeAudit("PP-D-1", { fetchFn: down })).toEqual({ unavailable: true });
  });
});
