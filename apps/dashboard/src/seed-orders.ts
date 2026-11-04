import type { Money } from "@poi/contracts";

export interface SeedOrder {
  orderId: string;
  agentPlatform: string;
  amount: Money;
  status: "APPROVED" | "BLOCKED" | "STEP_UP";
  reasonCodes: string[];
  createdAt: string;
}

/**
 * Generates canonical 300 seeded checkout orders per docs/specs/0007-dashboard.md.
 * Distributed across 5 platforms (AutoGPT, LangChain, CrewAI, OpenAI Swarm, Direct Web).
 * Includes 38 blocked overreach carts totaling $3,420.00.
 */
function createSeedOrders(): SeedOrder[] {
  const orders: SeedOrder[] = [];
  const platforms = [
    { name: "AutoGPT", total: 70, blocked: 9 },
    { name: "LangChain", total: 75, blocked: 10 },
    { name: "CrewAI", total: 65, blocked: 11 },
    { name: "OpenAI Swarm", total: 60, blocked: 8 },
    { name: "Direct Web", total: 30, blocked: 0 },
  ];

  // Specific 38 blocked reasons: 22 AMOUNT_EXCEEDS_MAX, 10 ATTRIBUTE_MISMATCH, 6 MERCHANT_NOT_ALLOWED
  const blockedReasonsPool: string[] = [
    ...Array(22).fill("AMOUNT_EXCEEDS_MAX"),
    ...Array(10).fill("ATTRIBUTE_MISMATCH"),
    ...Array(6).fill("MERCHANT_NOT_ALLOWED"),
  ];

  let orderIndex = 1;
  let blockedPoolIdx = 0;

  for (const p of platforms) {
    let pBlockedCount = 0;
    for (let i = 0; i < p.total; i++) {
      const isBlocked = pBlockedCount < p.blocked;
      let status: "APPROVED" | "BLOCKED" | "STEP_UP" = "APPROVED";
      let reasonCodes: string[] = [];
      let amountCents = 7500; // default $75.00

      if (isBlocked) {
        status = "BLOCKED";
        pBlockedCount++;
        const reason = blockedReasonsPool[blockedPoolIdx++] ?? "AMOUNT_EXCEEDS_MAX";
        reasonCodes = [reason];
        amountCents = 9000; // $90.00 each on average -> 38 * $90 = $3,420.00
      } else if (i % 12 === 0) {
        status = "STEP_UP";
        amountCents = 12000;
      }

      orders.push({
        orderId: `ord_0192f3a0_${String(orderIndex).padStart(4, "0")}`,
        agentPlatform: p.name,
        amount: { value: amountCents, currency: "USD" },
        status,
        reasonCodes,
        createdAt: new Date(Date.UTC(2026, 9, 25, (orderIndex * 3) % 24, 0, 0)).toISOString(),
      });

      orderIndex++;
    }
  }

  return orders;
}

export const SEED_ORDERS: SeedOrder[] = createSeedOrders();
