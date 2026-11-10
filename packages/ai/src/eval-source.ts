import { execFileSync } from "node:child_process";

/** Refuse to publish HEAD as the evaluated source when the checkout contains uncommitted changes. */
export function evaluationSourceCommit(cwd: string | URL): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD");
  if (git("status", "--porcelain", "--untracked-files=all"))
    throw new Error(
      "Commit or remove uncommitted changes before evaluating so the report identifies the exact source. " +
        "Commit generated reports and recordings before starting another run.",
    );
  return commit;
}
