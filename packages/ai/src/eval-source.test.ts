import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { evaluationSourceCommit } from "./eval-source";

let cwd: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "poi-eval-source-"));
  git("init", "--quiet");
  writeFileSync(join(cwd, "prompt.md"), "original prompt\n");
  writeFileSync(join(cwd, ".gitignore"), ".env\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Eval Test",
    "-c",
    "user.email=eval-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  );
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

test("a clean checkout reports its actual commit, independent of the caller's directory", () => {
  mkdirSync(join(cwd, "nested"));
  writeFileSync(join(cwd, ".env"), "LOCAL_TEST_SETTING=1\n");
  expect(evaluationSourceCommit(join(cwd, "nested"))).toBe(git("rev-parse", "HEAD"));
});

test.each(["unstaged", "staged", "untracked"])("%s source changes cannot be attributed to HEAD", (kind) => {
  writeFileSync(join(cwd, kind === "untracked" ? "new-prompt.md" : "prompt.md"), "changed prompt\n");
  if (kind === "staged") git("add", "prompt.md");
  expect(() => evaluationSourceCommit(cwd)).toThrow("Commit or remove uncommitted changes");
});
