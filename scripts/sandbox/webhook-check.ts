// Proves a real PayPal sandbox delivery is verified and stored once, even when delivered twice (#19, spec 0004).
//
//   POI_API_URL=https://poi-api.iotkiit.in pnpm sandbox:webhook-check     (PayPal credentials and PAYPAL_WEBHOOK_ID from .env)
//
// Reads GET /readyz `webhooks` (the count of verified deliveries the API holds), asks PayPal to resend one old
// capture/order event to the registered webhook, and watches the count. An event the server has never seen
// must raise it by one (PayPal's signature verified, row stored); resending the same event again must not.
// Only PAYMENT.* and CHECKOUT.* events are used: the dispute worker ignores them, so nothing else happens.
import { paypalRaw, waitFor } from "./paypal-raw";

const api = (process.env.POI_API_URL ?? "https://poi-api.iotkiit.in").replace(/\/$/, "");
const hookId = process.env.PAYPAL_WEBHOOK_ID;
if (!hookId) throw new Error("PAYPAL_WEBHOOK_ID is required");

interface Stats {
  received: number;
  lastReceivedAt: string | null;
  lastEventType: string | null;
}

async function stats(): Promise<Stats> {
  const res = await fetch(`${api}/readyz`);
  const body = (await res.json()) as { webhooks?: Stats | null };
  if (!body.webhooks)
    throw new Error(
      `${api}/readyz has no "webhooks" field: deploy the build that adds it, or the database is not configured`,
    );
  return body.webhooks;
}

type Ev = { id: string; event_type: string; create_time: string };

interface EventPage {
  events: Ev[];
  links?: { rel: string; href: string }[];
}

async function candidates(): Promise<Ev[]> {
  const out: Ev[] = [];
  let path: string | undefined = "/v1/notifications/webhooks-events?page_size=100";
  for (let page = 0; path && page < 5; page++) {
    const res: { body: EventPage } = await paypalRaw<EventPage>("GET", path);
    out.push(...res.body.events);
    const href: string | undefined = res.body.links?.find((l) => l.rel === "next")?.href;
    path = href ? new URL(href).pathname + new URL(href).search : undefined;
  }
  return out
    .filter((e) => /^(PAYMENT|CHECKOUT)\./.test(e.event_type))
    .sort((a, b) => a.create_time.localeCompare(b.create_time));
}

const resend = (id: string) =>
  paypalRaw("POST", `/v1/notifications/webhooks-events/${id}/resend`, { webhook_ids: [hookId] });

const before = await stats();
console.log(
  `before: ${before.received} deliveries held, last ${before.lastEventType ?? "none"} at ${before.lastReceivedAt ?? "-"}`,
);

let proven: { id: string; type: string; after: Stats } | undefined;
let tried = 0;
for (const ev of await candidates()) {
  if (tried++ >= 6) break;
  const base = await stats();
  const res = await resend(ev.id);
  console.log(`resent ${ev.event_type} ${ev.id} (${ev.create_time}): PayPal ${res.status}`);
  const raised = await waitFor(
    "the delivery count to rise",
    async () => {
      const s = await stats();
      return s.received > base.received ? s : undefined;
    },
    45_000,
    3_000,
  ).catch(() => undefined);
  if (raised) {
    proven = { id: ev.id, type: ev.event_type, after: raised };
    break;
  }
  console.log(
    "  count did not rise: the server already held this event (or the delivery did not arrive); trying an older one",
  );
}

if (!proven) {
  console.log(
    "\nNo resent event raised the count. Either every candidate was already stored, or deliveries are not reaching the server.",
  );
  process.exit(1);
}
console.log(
  `new delivery verified and stored: ${before.received} -> ${proven.after.received} (${proven.type})`,
);

const held = proven.after.received;
await resend(proven.id);
console.log("resent the same event a second time, waiting 30s…");
await new Promise((r) => setTimeout(r, 30_000));
const final = await stats();
if (final.received !== held) {
  console.log(`FAIL: the duplicate raised the count ${held} -> ${final.received}`);
  process.exit(1);
}
console.log(`ok: delivered twice, stored once (${final.received} held)`);
