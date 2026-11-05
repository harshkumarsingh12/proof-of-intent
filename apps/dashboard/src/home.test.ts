import { describe, expect, it } from "vitest";
import type { DisputeItem } from "./dispute-types";
import {
  byDeadline,
  classLabel,
  dueSubtitle,
  dueWithin,
  forTab,
  HOME_TABS,
  inRange,
  searchDisputes,
} from "./home";
import { merchantInitials, parsePayPalMode } from "./merchant";
import { generateSeedDisputes } from "./seed-disputes";

const NOW = new Date("2026-11-05T12:00:00Z");
const SEED = generateSeedDisputes(NOW);
const HOUR = 60 * 60 * 1000;

describe("home page helpers", () => {
  it("tabs filter the seed disputes by status and decision", () => {
    expect(forTab(SEED, "action")).toEqual(SEED.filter((d) => d.status === "ACTION_REQUIRED"));
    expect(forTab(SEED, "resolved")).toEqual(SEED.filter((d) => d.status === "RESOLVED"));
    for (const tab of ["defend", "concede"] as const) {
      const rows = forTab(SEED, tab);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((d) => d.decision === tab && d.status !== "RESOLVED")).toBe(true);
    }
    expect(HOME_TABS.map((t) => t.id)).toEqual(["action", "defend", "concede", "resolved"]);
  });

  it("range keeps only disputes opened within the window ending now", () => {
    const all = inRange(SEED, "30d", NOW);
    const day = inRange(SEED, "24h", NOW);
    expect(day.length).toBeLessThanOrEqual(all.length);
    for (const d of day) {
      const age = NOW.getTime() - new Date(d.createdAt).getTime();
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThanOrEqual(24 * HOUR);
    }
    const future = { ...SEED[0]!, id: "X", createdAt: new Date(NOW.getTime() + HOUR).toISOString() };
    expect(inRange([future], "30d", NOW)).toHaveLength(0);
  });

  it("counts open disputes due in the next 24 hours, skipping expired and resolved ones", () => {
    const base = SEED[0]!;
    const at = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();
    const rows: DisputeItem[] = [
      { ...base, id: "A", status: "ACTION_REQUIRED", sellerResponseDueDate: at(5) },
      { ...base, id: "B", status: "UNDER_REVIEW", sellerResponseDueDate: at(23) },
      { ...base, id: "C", status: "ACTION_REQUIRED", sellerResponseDueDate: at(30) },
      { ...base, id: "D", status: "ACTION_REQUIRED", sellerResponseDueDate: at(-2) },
      { ...base, id: "E", status: "RESOLVED", sellerResponseDueDate: at(3) },
    ];
    expect(dueWithin(rows, 24, NOW).map((d) => d.id)).toEqual(["A", "B"]);
    expect(dueSubtitle(2)).toBe("2 disputes need a response in the next 24 hours.");
    expect(dueSubtitle(1)).toBe("1 dispute needs a response in the next 24 hours.");
    expect(dueSubtitle(0)).toBe("No disputes need a response in the next 24 hours.");
  });

  it("sorts tiles by the soonest seller deadline", () => {
    const sorted = byDeadline(SEED);
    for (let i = 1; i < sorted.length; i++) {
      expect(new Date(sorted[i]!.sellerResponseDueDate).getTime()).toBeGreaterThanOrEqual(
        new Date(sorted[i - 1]!.sellerResponseDueDate).getTime(),
      );
    }
    expect(sorted).toHaveLength(SEED.length);
  });

  it("labels dispute classes in sentence case", () => {
    expect(classLabel("AGENT_OVERREACH")).toBe("Agent overreach");
    expect(classLabel("NO_MANDATE")).toBe("No mandate");
  });
});

describe("dispute search", () => {
  it("matches dispute id, order id and PayPal order id, case-insensitively", () => {
    expect(searchDisputes(SEED, "pp-d-1001")[0]?.id).toBe("PP-D-1001");
    expect(searchDisputes(SEED, "ord_0192f3a0_1002")[0]?.id).toBe("PP-D-1002");
    const pp = SEED[2]!.paypalOrderId;
    expect(searchDisputes(SEED, pp.toLowerCase()).map((d) => d.id)).toContain(SEED[2]!.id);
  });

  it("returns at most six results and nothing for a blank query", () => {
    expect(searchDisputes(SEED, "PP-D").length).toBe(6);
    expect(searchDisputes(SEED, "   ")).toEqual([]);
    expect(searchDisputes(SEED, "no-such-id")).toEqual([]);
  });

  it("ranks an exact id match first", () => {
    const hits = searchDisputes(SEED, "PP-D-1010");
    expect(hits[0]?.id).toBe("PP-D-1010");
  });
});

describe("merchant and mode", () => {
  it("derives initials and parses PAYPAL_MODE like packages/paypal", () => {
    expect(merchantInitials("Trailhead Outfitters")).toBe("TO");
    expect(parsePayPalMode("sandbox")).toBe("sandbox");
    expect(parsePayPalMode(undefined)).toBe("mock");
    expect(parsePayPalMode("live")).toBe("mock");
  });
});
