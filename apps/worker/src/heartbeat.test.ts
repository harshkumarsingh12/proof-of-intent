import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { beat } from "./heartbeat";

const dir = mkdtempSync(join(tmpdir(), "heartbeat-"));

describe("the worker heartbeat (#175)", () => {
  test("a beat writes the time to the file, and a failed write is reported, not thrown", () => {
    const file = join(dir, "beat");
    const before = Date.now();
    beat(file);
    expect(Number(readFileSync(file, "utf8"))).toBeGreaterThanOrEqual(before);
    const logged: string[] = [];
    expect(() => beat(join(dir, "no-such-dir", "beat"), (m) => logged.push(m))).not.toThrow();
    expect(logged.join()).toMatch(/could not write the heartbeat/);
  });

  describe("the compose healthcheck command, run for real", () => {
    // Pull the worker's healthcheck out of docker-compose.yml and run it, so the test checks what Docker would run.
    const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
    const worker = compose.slice(compose.indexOf("\n  worker:"), compose.indexOf("\n  buyer:"));
    const command = JSON.parse(/healthcheck:\s*\n(?:\s*#.*\n)*\s*test:\s*(\[.*\])/.exec(worker)![1]!) as string[];
    // The first token is Docker's own marker for "run this directly, no shell"; the rest is the real command.
    expect(command[0]).toBe("CMD");
    const [, program, ...args] = command as [string, string, ...string[]];
    const run = (file: string) =>
      spawnSync(program, args, { env: { ...process.env, WORKER_HEARTBEAT_FILE: file } }).status;

    test("healthy when the file is fresh", () => {
      const file = join(dir, "fresh");
      beat(file);
      expect(run(file)).toBe(0);
    });

    test("unhealthy when the file is older than a minute (the worker stopped polling)", () => {
      const file = join(dir, "stale");
      writeFileSync(file, "x");
      const old = new Date(Date.now() - 90_000);
      utimesSync(file, old, old);
      expect(run(file)).toBe(1);
    });

    test("unhealthy when there is no file (the worker never completed a poll)", () => {
      expect(run(join(dir, "never"))).toBe(1);
    });
  });
});
