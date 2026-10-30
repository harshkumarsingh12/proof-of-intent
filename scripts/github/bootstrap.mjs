#!/usr/bin/env node
// Creates labels, milestones and the issue backlog on GitHub. Safe to rerun: existing items are skipped.
//
//   node scripts/github/bootstrap.mjs            # labels, milestones, issues
//   node scripts/github/bootstrap.mjs --assign   # assign each issue to its owner (after invites are accepted)
//
// Needs the GitHub CLI, authenticated with access to the repo.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.REPO ?? "harshkumarsingh12/proof-of-intent";
const backlog = JSON.parse(readFileSync(new URL("./backlog.json", import.meta.url), "utf8"));

const gh = (args, input) =>
  execFileSync("gh", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "inherit"] }).trim();
const api = (path, ...args) => JSON.parse(gh(["api", path, ...args]) || "null");
const apiPages = (path) => JSON.parse(gh(["api", "--paginate", "--slurp", path])).flat();

const MILESTONES = {
  M0: ["M0 Foundations", "2026-10-31", "Specs accepted, fixtures committed, server answers /healthz over public HTTPS."],
  M1: ["M1 Slice on sandbox", "2026-11-03", "Signed mandate verified; sandbox order authorized and captured with the pointer in custom_id; dashboard shows it."],
  M2: ["M2 Dispute cycle", "2026-11-06", "Real CUSTOMER.DISPUTE.CREATED classified; evidence submitted and a claim accepted in sandbox via the UI."],
  M3: ["M3 Feature freeze", "2026-11-08", "Journeys A to D pass on sandbox twice in a row."],
  M4: ["M4 Submission", "2026-11-11", "Video public, repo public, README verified on a clean machine, hosted demo live."],
};

const LABELS = [
  ["area:payments", "1f6feb", "PayPal client, API, DB"],
  ["area:mandates", "8250df", "Contracts, crypto, policy engine, buyer app"],
  ["area:copilot", "bf3989", "Dispute copilot worker"],
  ["area:dashboard", "0e8a16", "AG Studio dashboard"],
  ["area:ai", "d4a72c", "LLM jobs, replay, evals, Studio agent"],
  ["area:infra", "57606a", "Server, CI/CD, repo"],
  ["area:demo", "fb8f44", "Video, Devpost, docs for judges"],
  ["type:feat", "a2eeef", "New capability"],
  ["type:bug", "d73a4a", "Behaves differently from the spec"],
  ["type:spec", "c5def5", "Spec to write or accept"],
  ["type:chore", "ededed", "Setup, ops, process"],
  ["type:docs", "0075ca", "Documentation"],
  ["P0", "b60205", "Blocks a gate"],
  ["P1", "fbca04", "Needed for the demo"],
  ["P2", "c2e0c6", "Nice to have"],
  ["blocked", "000000", "Waiting on something outside the owner's control"],
  ["stretch", "f9d0c4", "Only after the MVP gate"],
];

function ensureLabels() {
  const have = new Set(apiPages(`repos/${REPO}/labels?per_page=100`).map((l) => l.name));
  for (const [name, color, description] of LABELS) {
    if (have.has(name)) continue;
    api(`repos/${REPO}/labels`, "-f", `name=${name}`, "-f", `color=${color}`, "-f", `description=${description}`);
    console.log(`label   + ${name}`);
  }
}

function ensureMilestones() {
  const byTitle = new Map(apiPages(`repos/${REPO}/milestones?state=all&per_page=100`).map((m) => [m.title, m.number]));
  const numbers = {};
  for (const [key, [title, due, description]] of Object.entries(MILESTONES)) {
    if (!byTitle.has(title)) {
      const m = api(`repos/${REPO}/milestones`, "-f", `title=${title}`, "-f", `due_on=${due}T23:59:59Z`, "-f", `description=${description}`);
      byTitle.set(title, m.number);
      console.log(`mstone  + ${title}`);
    }
    numbers[key] = byTitle.get(title);
  }
  return numbers;
}

function body(item) {
  const spec = item.spec.startsWith("docs/") || item.spec.endsWith(".md") ? `[\`${item.spec}\`](https://github.com/${REPO}/blob/main/${item.spec})` : item.spec;
  return [
    `**Owner:** @${item.owner} · **Milestone:** ${MILESTONES[item.milestone][0]} (due ${MILESTONES[item.milestone][1]}) · **Spec:** ${spec}`,
    "",
    "## What",
    item.what,
    "",
    "## Done when",
    item.done,
  ].join("\n");
}

function ensureIssues(milestones) {
  const existing = new Map(
    apiPages(`repos/${REPO}/issues?state=all&per_page=100`)
      .filter((i) => !i.pull_request)
      .map((i) => [i.title, i]),
  );
  for (const item of backlog) {
    if (existing.has(item.title)) continue;
    const payload = JSON.stringify({
      title: item.title,
      body: body(item),
      milestone: milestones[item.milestone],
      labels: [`area:${item.area}`, `type:${item.type}`, item.priority],
    });
    const issue = JSON.parse(gh(["api", `repos/${REPO}/issues`, "--input", "-"], payload));
    console.log(`issue   + #${issue.number} ${item.title}`);
  }
}

function assignOwners() {
  const collaborators = new Set(apiPages(`repos/${REPO}/collaborators?per_page=100`).map((c) => c.login.toLowerCase()));
  const issues = new Map(
    apiPages(`repos/${REPO}/issues?state=open&per_page=100`)
      .filter((i) => !i.pull_request)
      .map((i) => [i.title, i]),
  );
  for (const item of backlog) {
    const issue = issues.get(item.title);
    if (!issue || issue.assignees.length) continue;
    if (!collaborators.has(item.owner.toLowerCase())) {
      console.log(`assign  ~ #${issue.number} waiting for @${item.owner} to accept the invite`);
      continue;
    }
    api(`repos/${REPO}/issues/${issue.number}/assignees`, "-f", `assignees[]=${item.owner}`);
    console.log(`assign  + #${issue.number} @${item.owner}`);
  }
}

if (process.argv.includes("--assign")) {
  assignOwners();
} else {
  ensureLabels();
  ensureIssues(ensureMilestones());
  assignOwners();
}
