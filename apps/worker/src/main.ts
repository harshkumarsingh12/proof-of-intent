import { parseAiMode } from "@poi/ai";
import { createDb } from "@poi/db";
import { createPayPalClient, parseMode } from "@poi/paypal";
import { beat } from "./heartbeat";
import { processDisputeEvents, syncDisputes } from "./inbox";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("the worker needs DATABASE_URL (its inbox is the webhook_events table)");
const db = createDb(url);
const aiMode = parseAiMode(process.env.AI_MODE);
const paypal = createPayPalClient(parseMode(process.env.PAYPAL_MODE));
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
/** list_disputes catch-up, for webhooks PayPal never delivered. */
const SYNC_MS = Number(process.env.DISPUTE_SYNC_MS ?? 300_000);
let lastSync = 0;

// ponytail: one worker polling the inbox table; move to LISTEN/NOTIFY or pg-boss if several workers ever run.
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    const n = await processDisputeEvents({ db, aiMode, paypal });
    if (n) console.log(`worker: handled ${n} dispute event(s)`);
    if (Date.now() - lastSync >= SYNC_MS) {
      lastSync = Date.now();
      const synced = await syncDisputes({ db, aiMode, paypal });
      if (synced) console.log(`worker: synced ${synced} dispute(s) from list_disputes`);
    }
    beat(); // only reached when the poll worked: this is what the compose healthcheck reads
  } catch (err) {
    console.error(`worker: inbox poll failed (${(err as Error).message}); retrying`);
  } finally {
    busy = false;
  }
}, POLL_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    void db.close().finally(() => process.exit(0));
  });
}
console.log(`worker up: polling dispute events every ${POLL_MS} ms (AI_MODE=${aiMode})`);
