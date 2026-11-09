/**
 * Checks a proof package (#177) on this machine, with no server and no database: `pnpm proof:verify <file.json>`.
 *
 * The file comes from `GET /orders/:id/proof` (the dashboard's "Download proof package" link). It prints each check with what it
 * found, then what a pass does not establish. Exits 0 only when every check passed, 1 when any failed, 2 when the file could not
 * be read. Nothing is sent anywhere.
 */
import { readFileSync } from "node:fs";
import { verifyProofPackage } from "../../packages/proof/src/index";

const file = process.argv[2];
if (!file || file === "--help" || file === "-h") {
  console.error("Usage: pnpm proof:verify <proof-package.json>");
  process.exit(file ? 0 : 2);
}

let input: unknown;
try {
  input = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`Could not read ${file} as JSON: ${(err as Error).message}`);
  process.exit(2);
}

const report = await verifyProofPackage(input);
const width = Math.max(...report.checks.map((c) => c.label.length));
console.log(`\nProof package: ${file}\n`);
for (const c of report.checks) {
  console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.label.padEnd(width)}  ${c.detail}`);
}
console.log(
  `\n${report.ok ? "All checks passed." : `${report.checks.filter((c) => !c.passed).length} check(s) failed.`}`,
);
console.log("\nWhat this does not show:");
for (const note of report.notes) console.log(`  - ${note}`);
console.log("");
process.exit(report.ok ? 0 : 1);
