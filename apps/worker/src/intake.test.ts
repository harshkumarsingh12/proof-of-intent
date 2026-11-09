import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@poi/db";
import {
  consumeVerifiedDisputeEvents,
  DEFAULT_MAX_DISPUTE_PAGES,
  fetchAllDisputePages,
  InMemoryDisputeJobStore,
  intakeDisputeEvent,
  type DisputeCatchUpClient,
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
    await expect(intakeDisputeEvent(noId, { db, jobStore })).rejects.toThrow("Webhook event missing required id");

    const noDisputeId: DisputeWebhookEvent = {
      id: "WH-999",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {},
    };
    await expect(intakeDisputeEvent(noDisputeId, { db, jobStore })).rejects.toThrow("no dispute id");
  });
});

describe("dispute catch-up pagination (issue #173)", () => {
  it("follows next-page links across multiple pages until all disputes are read", async () => {
    const pages: Record<string, { items: Array<{ dispute_id: string }>; links?: Array<{ href: string; rel: string }> }> = {
      initial: {
        items: [{ dispute_id: "PP-D-1" }, { dispute_id: "PP-D-2" }],
        links: [{ href: "https://api.sandbox.paypal.com/v1/customer/disputes?page=2", rel: "next" }],
      },
      "https://api.sandbox.paypal.com/v1/customer/disputes?page=2": {
        items: [{ dispute_id: "PP-D-3" }],
        links: [{ href: "https://api.sandbox.paypal.com/v1/customer/disputes?page=3", rel: "next" }],
      },
      "https://api.sandbox.paypal.com/v1/customer/disputes?page=3": {
        items: [{ dispute_id: "PP-D-4" }, { dispute_id: "PP-D-5" }],
      },
    };

    const mockClient: DisputeCatchUpClient = {
      listDisputes: async (options) => {
        const key = options?.nextUrl ?? "initial";
        return pages[key] ?? { items: [] };
      },
    };

    const result = await fetchAllDisputePages(mockClient);
    expect(result.items.map((d) => d.dispute_id)).toEqual([
      "PP-D-1",
      "PP-D-2",
      "PP-D-3",
      "PP-D-4",
      "PP-D-5",
    ]);
    expect(result.pagesRead).toBe(3);
    expect(result.hitMaxPages).toBe(false);
  });

  it("stops at maxPages safety limit and logs when hit", async () => {
    const logs: string[] = [];
    const infiniteClient: DisputeCatchUpClient = {
      listDisputes: async (options) => ({
        items: [{ dispute_id: `PP-D-PAGE-${options?.page ?? 1}` }],
        links: [{ href: `https://api.paypal.test/disputes?page=${(options?.page ?? 1) + 1}`, rel: "next" }],
      }),
    };

    const result = await fetchAllDisputePages(infiniteClient, {
      maxPages: 3,
      log: (msg) => logs.push(msg),
    });

    expect(result.pagesRead).toBe(3);
    expect(result.hitMaxPages).toBe(true);
    expect(result.items).toHaveLength(3);
    expect(logs.some((l) => l.includes("safety limit of 3 pages"))).toBe(true);
  });

  it("handles single-page responses without next link", async () => {
    const client: DisputeCatchUpClient = {
      listDisputes: async () => ({
        items: [{ dispute_id: "PP-D-SINGLE" }],
      }),
    };

    const result = await fetchAllDisputePages(client);
    expect(result.items).toHaveLength(1);
    expect(result.pagesRead).toBe(1);
    expect(result.hitMaxPages).toBe(false);
  });

  it("handles legacy plain array responses", async () => {
    const client: DisputeCatchUpClient = {
      listDisputes: async () => [{ dispute_id: "PP-D-LEGACY" }],
    };

    const result = await fetchAllDisputePages(client);
    expect(result.items).toHaveLength(1);
    expect(result.pagesRead).toBe(1);
    expect(result.hitMaxPages).toBe(false);
    expect(DEFAULT_MAX_DISPUTE_PAGES).toBe(10);
  });
});
