import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@poi/db";
import {
  createMockClient,
  DISPUTES_PAGE_SIZE,
  type DisputeListItem,
  type DisputeListPage,
} from "@poi/paypal";
import {
  consumeVerifiedDisputeEvents,
  DEFAULT_MAX_DISPUTE_PAGES,
  forEachDisputePage,
  InMemoryDisputeJobStore,
  intakeDisputeEvent,
  type DisputeWebhookEvent,
} from "./intake";
import { JOBS } from "./pipeline";

describe("dispute intake", () => {
  const sampleEvent: DisputeWebhookEvent = {
    id: "WH-20261102-001",
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource: {
      id: "PP-D-1001",
      status: "WAITING_FOR_SELLER_RESPONSE",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      dispute_amount: {
        value: "74.00",
        currency_code: "USD",
      },
      disputed_transactions: [
        {
          seller_transaction_id: "txn_001",
          custom_id: "poi:0192f3a0-0000-7000-8000-000000000001:0000000000000000",
        },
      ],
    },
  };

  it("creates a dispute.received job with queued status and appends to audit log", async () => {
    const jobStore = new InMemoryDisputeJobStore(() => "2026-11-02T10:00:00.000Z");
    const auditEntries: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditEntries.push(entry);
      },
    };

    const result = await intakeDisputeEvent(sampleEvent, { db, jobStore });

    expect(result.isDuplicate).toBe(false);
    expect(result.job.jobName).toBe(JOBS.disputeReceived);
    expect(result.job.status).toBe("queued");
    expect(result.job.eventId).toBe("WH-20261102-001");
    expect(result.job.disputeId).toBe("PP-D-1001");
    expect(result.job.createdAt).toBe("2026-11-02T10:00:00.000Z");

    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toEqual({
      actor: "worker",
      action: "dispute.received",
      subjectId: "PP-D-1001",
      requestBody: {
        eventId: "WH-20261102-001",
        eventType: "CUSTOMER.DISPUTE.CREATED",
        disputeId: "PP-D-1001",
        jobId: result.job.id,
      },
    });
  });

  it("is idempotent on the event id and does not duplicate jobs", async () => {
    const jobStore = new InMemoryDisputeJobStore();
    const auditEntries: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditEntries.push(entry);
      },
    };

    const first = await intakeDisputeEvent(sampleEvent, { db, jobStore });
    const second = await intakeDisputeEvent(sampleEvent, { db, jobStore });

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const jobs = await jobStore.listJobs();
    expect(jobs).toHaveLength(1);

    expect(auditEntries).toHaveLength(2);
    expect(auditEntries[1]?.action).toBe("dispute.duplicate_ignored");
  });

  it("consumes batches of verified dispute events", async () => {
    const jobStore = new InMemoryDisputeJobStore();
    const auditEntries: AuditEntry[] = [];
    const db = {
      appendAudit: async (entry: AuditEntry) => {
        auditEntries.push(entry);
      },
    };

    const secondEvent: DisputeWebhookEvent = {
      id: "WH-20261102-002",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {
        dispute_id: "PP-D-1002",
        status: "UNDER_REVIEW",
      },
    };

    const results = await consumeVerifiedDisputeEvents([sampleEvent, secondEvent, sampleEvent], {
      db,
      jobStore,
    });

    expect(results).toHaveLength(3);
    expect(results[0]?.isDuplicate).toBe(false);
    expect(results[1]?.isDuplicate).toBe(false);
    expect(results[2]?.isDuplicate).toBe(true);

    const jobs = await jobStore.listJobs();
    expect(jobs).toHaveLength(2);
  });

  it("tracks job state transitions and failure errors", async () => {
    const jobStore = new InMemoryDisputeJobStore();
    const db = { appendAudit: async () => {} };

    const { job } = await intakeDisputeEvent(sampleEvent, { db, jobStore });
    expect(job.status).toBe("queued");

    const processing = await jobStore.updateJobStatus(job.id, "processing");
    expect(processing.status).toBe("processing");

    const failed = await jobStore.updateJobStatus(job.id, "failed", "simulated worker failure");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("simulated worker failure");

    const completed = await jobStore.updateJobStatus(job.id, "completed");
    expect(completed.status).toBe("completed");
  });

  it("throws when event has no id or dispute id", async () => {
    const jobStore = new InMemoryDisputeJobStore();
    const db = { appendAudit: async () => {} };

    const noId = { ...sampleEvent, id: "" };
    await expect(intakeDisputeEvent(noId, { db, jobStore })).rejects.toThrow(
      "Webhook event missing required id",
    );

    const noDisputeId: DisputeWebhookEvent = {
      id: "WH-999",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {},
    };
    await expect(intakeDisputeEvent(noDisputeId, { db, jobStore })).rejects.toThrow("no dispute id");
  });
});

// #234: the catch-up reads the merchant's disputes page by page. The Agent Toolkit pages by number (`page` from 1, 50 to a page),
// so these tests drive the loop through that same call, `listDisputesPage(page)`, not a next link.
describe("dispute catch-up pagination (#234)", () => {
  const ids = (from: number, count: number): DisputeListItem[] =>
    Array.from({ length: count }, (_, i) => ({ dispute_id: `PP-D-${from + i}` }));

  /** A fake PayPal list: `pages[n - 1]` is page n; asking past the end gives an empty page. Records every request. */
  function fakeList(pages: DisputeListItem[][], opts: { totalPages?: number; failOn?: number } = {}) {
    const asked: number[] = [];
    return {
      asked,
      client: {
        listDisputesPage: async (page: number): Promise<DisputeListPage> => {
          asked.push(page);
          if (page === opts.failOn) throw new Error("PayPal timed out");
          return {
            items: pages[page - 1] ?? [],
            page,
            ...(opts.totalPages ? { totalPages: opts.totalPages } : {}),
          };
        },
      },
    };
  }

  it("reads every page until one comes back short, handing each page over as it arrives", async () => {
    const { client, asked } = fakeList([ids(1, 50), ids(51, 50), ids(101, 20)]);
    const events: string[] = [];
    const seen: string[] = [];
    const wrapped = {
      listDisputesPage: async (page: number) => {
        events.push(`read ${page}`);
        return client.listDisputesPage(page);
      },
    };
    const result = await forEachDisputePage(wrapped, async (items) => {
      events.push(`handle ${items.length}`);
      seen.push(...items.map((d) => d.dispute_id));
    });
    expect(result).toEqual({ pagesRead: 3, hitMaxPages: false, stoppedEarly: false });
    expect(asked).toEqual([1, 2, 3]); // never asks for a page 4
    expect(seen).toHaveLength(120);
    expect(new Set(seen).size).toBe(120);
    // Page 1 is handled before page 2 is even requested, which is what keeps earlier pages if a later one fails.
    expect(events).toEqual(["read 1", "handle 50", "read 2", "handle 50", "read 3", "handle 20"]);
  });

  it("stops at PayPal's own page count, even when the last page is exactly full", async () => {
    const { client, asked } = fakeList([ids(1, 50), ids(51, 50)], { totalPages: 2 });
    const result = await forEachDisputePage(client, async () => {});
    expect(result).toEqual({ pagesRead: 2, hitMaxPages: false, stoppedEarly: false });
    expect(asked).toEqual([1, 2]); // 100 disputes fit two full pages; a third request would be wasted
  });

  it("without a page count, a full page means 'ask for the next', and an empty page ends it", async () => {
    const { client, asked } = fakeList([ids(1, 50), ids(51, 50)]);
    const result = await forEachDisputePage(client, async () => {});
    expect(result).toEqual({ pagesRead: 3, hitMaxPages: false, stoppedEarly: false });
    expect(asked).toEqual([1, 2, 3]);
  });

  it("stops at the safety cap and says so, without asking for another page", async () => {
    const asked: number[] = [];
    const endless = {
      listDisputesPage: async (page: number): Promise<DisputeListPage> => {
        asked.push(page);
        return { items: ids(page * 1000, DISPUTES_PAGE_SIZE), page };
      },
    };
    let handled = 0;
    const result = await forEachDisputePage(
      endless,
      async (items) => {
        handled += items.length;
      },
      { maxPages: 3 },
    );
    expect(result).toEqual({ pagesRead: 3, hitMaxPages: true, stoppedEarly: false });
    expect(asked).toEqual([1, 2, 3]);
    expect(handled).toBe(150);
    expect(DEFAULT_MAX_DISPUTE_PAGES).toBe(10);
  });

  it("hands over an id once even if PayPal's list shifts and shows it on two pages", async () => {
    const page2 = [...ids(50, 1), ...ids(51, 30)]; // PP-D-50 slid onto page 2 while we were reading
    const { client } = fakeList([ids(1, 50), page2]);
    const seen: string[] = [];
    await forEachDisputePage(client, async (items) => void seen.push(...items.map((d) => d.dispute_id)));
    expect(seen).toHaveLength(80);
    expect(new Set(seen).size).toBe(80);
  });

  it("a page of only repeats is not handed over at all", async () => {
    const { client } = fakeList([ids(1, 50), ids(1, 50), ids(51, 10)]);
    const calls: number[] = [];
    await forEachDisputePage(client, async (items) => void calls.push(items.length));
    expect(calls).toEqual([50, 10]);
  });

  it("a failure on the first page is thrown, and nothing was handled", async () => {
    const { client } = fakeList([ids(1, 50)], { failOn: 1 });
    let handled = 0;
    await expect(forEachDisputePage(client, async (items) => void (handled += items.length))).rejects.toThrow(
      "PayPal timed out",
    );
    expect(handled).toBe(0);
  });

  it("a failure on a later page keeps the pages already read, logs once, and ends the pass without throwing", async () => {
    const { client, asked } = fakeList([ids(1, 50), ids(51, 50), ids(101, 50)], { failOn: 3 });
    const logs: string[] = [];
    let handled = 0;
    const result = await forEachDisputePage(client, async (items) => void (handled += items.length), {
      log: (m) => logs.push(m),
    });
    expect(result).toEqual({ pagesRead: 2, hitMaxPages: false, stoppedEarly: true });
    expect(handled).toBe(100); // pages 1 and 2 were handled before page 3 failed
    expect(asked).toEqual([1, 2, 3]); // and it did not go on to page 4
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("stopped at page 3");
    expect(logs[0]).toContain("PayPal timed out");
  });

  it("reads past the first 50 through the real mock client: 120 disputes, every one exactly once", async () => {
    const mock = createMockClient();
    for (let i = 1; i <= 120; i++)
      mock.seedDispute({ dispute_id: `PP-D-${i}`, status: "OPEN", update_time: "2026-11-06T00:00:00Z" });
    const seen: string[] = [];
    const result = await forEachDisputePage(
      mock,
      async (items) => void seen.push(...items.map((d) => d.dispute_id)),
    );
    expect(result).toEqual({ pagesRead: 3, hitMaxPages: false, stoppedEarly: false });
    expect(new Set(seen).size).toBe(120);
  });
});
