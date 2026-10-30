import { test } from "vitest";

/** Milestones from docs/ROADMAP.md. */
export type Milestone = "M0" | "M1" | "M2" | "M3" | "M4";

/** GitHub handles of the team. Adding a person means adding them here and to CODEOWNERS. */
export type Owner = "harshkumarsingh12" | "srshriv" | "hoursgotviral-dev" | "sumedhag28";

/**
 * An acceptance criterion that is not built yet.
 *
 * The body must assert the finished behaviour. It runs as `test.fails`, so today it passes
 * because the assertion fails. The day the feature works, the assertion passes, the test
 * goes red, and the owner deletes the ledger() wrapper to turn it into a plain test().
 * "Done" can't be claimed without the test agreeing.
 *
 * The title format `[M1 @owner] ...` is what scripts/ledger.mjs counts for the burndown.
 */
export function ledger(milestone: Milestone, owner: Owner, title: string, fn: () => unknown): void {
  test.fails(`[${milestone} @${owner}] ${title}`, fn as () => Promise<void>);
}
