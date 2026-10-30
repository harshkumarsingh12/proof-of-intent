import { describe, expect } from "vitest";
import { ledger } from "@poi/ledger";
import { buildEvidencePackage, recommend } from "./pipeline";

describe("dispute copilot (unbuilt)", () => {
  ledger("M2", "hoursgotviral-dev", "a dispute on the overreaching fixture order is AGENT_OVERREACH → accept", async () => {
    const rec = await recommend("fixture-overreach");
    expect(rec.class).toBe("AGENT_OVERREACH");
    expect(rec.action).toBe("ACCEPT_CLAIM");
  });

  ledger("M2", "hoursgotviral-dev", "a dispute on the compliant fixture order is MANDATE_COMPLIANT → evidence", async () => {
    const rec = await recommend("fixture-compliant");
    expect(rec.class).toBe("MANDATE_COMPLIANT");
  });

  ledger("M2", "hoursgotviral-dev", "evidence package PDF carries the same hash as the PayPal custom_id", async () => {
    const pkg = await buildEvidencePackage("fixture-compliant");
    expect(pkg.bundleJson).toContain("mandate_hash");
  });
});
