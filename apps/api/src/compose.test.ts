import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

/**
 * #121. Dokploy rewrites docker-compose.yml on deploy and does not resolve `<<: *anchor` merge keys, so a service
 * whose `networks` comes from the anchor looks to it like a service with none, and gets Dokploy's network instead of
 * ours. It then can't resolve `postgres` (`getaddrinfo ENOTFOUND postgres`, Nov 6 and Nov 7). This reads the file as
 * plain text, the way that rewrite effectively sees it, and keeps `networks` out of the anchor and on every service.
 */
const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");

/** The lines of one top-level block (`x-app:` or `services:`), up to the next top-level key. */
function topLevelBlock(name: string): string[] {
  const lines = compose.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`${name}:`));
  if (start < 0) throw new Error(`docker-compose.yml has no top-level ${name}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\S/.test(l) && !l.startsWith("#"));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Each service's own lines, by name. */
function services(): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const line of topLevelBlock("services")) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1]!;
      out.set(current, "");
    } else if (current) {
      out.set(current, `${out.get(current)}${line}\n`);
    }
  }
  return out;
}

describe("docker-compose.yml networks (#121)", () => {
  test("the shared x-app anchor does not carry networks", () => {
    const anchor = topLevelBlock("x-app").filter((l) => !l.trimStart().startsWith("#"));
    expect(anchor.some((l) => /^\s*networks:/.test(l))).toBe(false);
  });

  test("every service lists the poi network itself", () => {
    const all = services();
    expect([...all.keys()].sort()).toEqual(
      ["api", "backup", "buyer", "caddy", "dashboard", "migrate", "postgres", "worker"].sort(),
    );
    for (const [name, body] of all) {
      expect(body, `${name} must declare networks: [poi] directly, not through <<: *app`).toMatch(
        /^ {4}networks:\s*\[poi\]\s*$/m,
      );
    }
  });
});
