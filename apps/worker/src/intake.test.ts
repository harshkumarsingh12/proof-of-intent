import { describe, expect, it } from "vitest";
import type { AuditEntry } from "@poi/db";
import {
  consumeVerifiedDisputeEvents,
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
    await expect(intakeDisputeEvent(noId, { db, jobStore })).rejects.toThrow("Webhook event missing required id");

    const noDisputeId: DisputeWebhookEvent = {
      id: "WH-999",
      event_type: "CUSTOMER.DISPUTE.CREATED",
      resource: {},
    };
    await expect(intakeDisputeEvent(noDisputeId, { db, jobStore })).rejects.toThrow("no dispute id");
  });
});
