/**
 * The worker has no port to ask, so it leaves a heartbeat: after every successful poll of the dispute inbox it touches
 * a file, and the compose healthcheck (docker-compose.yml, #175) fails when that file is older than a minute. A worker
 * that is polling and can reach the database is healthy; one that is stuck, crashed, or cut off from Postgres is not.
 * A failed poll does not beat, which is the point.
 */
import { writeFileSync } from "node:fs";

export const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/worker-heartbeat";

/** Records that a poll just succeeded. A write failure is reported but never stops the worker. */
export function beat(file = HEARTBEAT_FILE, log: (msg: string) => void = console.error): void {
  try {
    writeFileSync(file, String(Date.now()));
  } catch (err) {
    log(`worker: could not write the heartbeat file ${file} (${(err as Error).message}); the healthcheck will fail`);
  }
}
