import { describe, expect } from "vitest";
import { ledger } from "@poi/ledger";
import { createDb } from "./index";

describe("db (unbuilt)", () => {
  const db = createDb(process.env.DATABASE_URL ?? "postgres://poi:poi@localhost:5432/poi");

  ledger("M1", "harshkumarsingh12", "a nonce can be claimed once; the second claim returns false", async () => {
    expect(await db.claimNonce("n-test-1")).toBe(true);
    expect(await db.claimNonce("n-test-1")).toBe(false);
  });

  ledger("M1", "harshkumarsingh12", "audit log accepts appends", async () => {
    await expect(db.appendAudit({ actor: "system", action: "verdict", subjectId: "ord_1" })).resolves.toBeUndefined();
  });
});
