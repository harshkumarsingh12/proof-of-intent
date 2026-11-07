import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("docker-compose.yml: the backup service (#38)", () => {
  const backup = services().get("backup") ?? "";

  test("it has its own `backup` profile besides `server`, and caddy stays server-only", () => {
    // `server` also starts caddy, which Dokploy's proxy makes pointless; COMPOSE_PROFILES=backup starts just the dumps.
    expect(backup).toMatch(/^ {4}profiles:\s*\[server, backup\]\s*$/m);
    expect(services().get("caddy")).toMatch(/^ {4}profiles:\s*\[server\]\s*$/m);
    // And nothing else is behind a profile, or a plain `docker compose up` would stop starting it.
    for (const [name, body] of services()) {
      if (name !== "backup" && name !== "caddy") expect(body, name).not.toMatch(/^ {4}profiles:/m);
    }
  });

  test("the dump location is configurable, defaulting to ./backups, with a named volume declared for Dokploy", () => {
    expect(backup).toContain('volumes: ["${BACKUP_DIR:-./backups}:/backups"]');
    expect(topLevelBlock("volumes").some((l) => /^ {2}backups:\s*$/.test(l))).toBe(true);
  });

  describe("its healthcheck, run for real: healthy only while a dump under 26 hours old exists", () => {
    const test_ = JSON.parse(/healthcheck:\s*\n(?:\s*#.*\n)*\s*test:\s*(\[.*\])/.exec(backup)![1]!) as string[];
    expect(test_[0]).toBe("CMD-SHELL");
    const dir = mkdtempSync(join(tmpdir(), "backups-"));
    const run = () => spawnSync("sh", ["-c", test_[1]!.replaceAll("/backups", dir)]).status;
    const dump = (name: string, ageHours: number) => {
      const file = join(dir, name);
      writeFileSync(file, "x");
      const t = new Date(Date.now() - ageHours * 3_600_000);
      utimesSync(file, t, t);
    };

    test("unhealthy with no dump at all", () => {
      expect(run()).toBe(1);
    });
    test("unhealthy when the newest dump is older than 26 hours (the service has stopped dumping)", () => {
      dump("poi-20260101T000000Z.sql.gz", 30);
      expect(run()).toBe(1);
    });
    test("healthy once a dump from the last day exists", () => {
      dump("poi-20260102T000000Z.sql.gz", 2);
      expect(run()).toBe(0);
    });
    test("a half-written .tmp file does not count as a backup", () => {
      const only = mkdtempSync(join(tmpdir(), "backups-tmp-"));
      writeFileSync(join(only, "poi-20260103T000000Z.sql.gz.tmp"), "x");
      expect(spawnSync("sh", ["-c", test_[1]!.replaceAll("/backups", only)]).status).toBe(1);
    });
  });
});

