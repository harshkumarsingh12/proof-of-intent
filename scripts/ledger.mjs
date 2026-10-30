#!/usr/bin/env node
// Burndown of unbuilt acceptance criteria, read from the vitest JSON report (not from source,
// so wrapped or multi-line test titles are still counted).
//
//   pnpm test:ci && pnpm ledger            # prints a Milestone x Owner table
//
// In GitHub Actions the table is also written to the job summary.
import { appendFileSync, readFileSync } from "node:fs";

const reportPath = process.argv[2] ?? "reports/vitest.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));

const TITLE = /^\[(M\d) @([\w-]+)\] (.+)$/;
const open = new Map(); // "M1|owner" -> [titles]
const malformed = [];

for (const file of report.testResults) {
  for (const t of file.assertionResults) {
    if (!t.title.startsWith("[")) continue;
    const m = TITLE.exec(t.title);
    if (!m) {
      malformed.push(`${file.name}: ${t.title}`);
      continue;
    }
    // A ledger entry that has started passing makes test.fails report "failed"; vitest already
    // fails the run for that, so here we only count the ones still open.
    if (t.status !== "passed") continue;
    const key = `${m[1]}|${m[2]}`;
    open.set(key, [...(open.get(key) ?? []), m[3]]);
  }
}

const rows = [...open.entries()].sort(([a], [b]) => a.localeCompare(b));
const total = rows.reduce((n, [, titles]) => n + titles.length, 0);

let md = "## Acceptance-criteria ledger\n\n| Milestone | Owner | Open | Items |\n|---|---|---:|---|\n";
for (const [key, titles] of rows) {
  const [milestone, owner] = key.split("|");
  md += `| ${milestone} | @${owner} | ${titles.length} | ${titles.join("; ")} |\n`;
}
md += `\n**Total open: ${total}**\n`;

console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);

if (malformed.length) {
  console.error("Ledger titles must look like '[M1 @owner] what is missing'. Malformed:");
  for (const line of malformed) console.error(`  ${line}`);
  process.exit(1);
}
