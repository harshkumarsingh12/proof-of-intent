import type { Db } from "@poi/db";
import { JOBS } from "./pipeline";

export type DisputeEventType =
  | "CUSTOMER.DISPUTE.CREATED"
  | "CUSTOMER.DISPUTE.UPDATED"
  | "CUSTOMER.DISPUTE.RESOLVED";

export interface DisputeWebhookEvent {
  id: string;
  event_type: DisputeEventType | string;
  resource_type?: string;
  create_time?: string;
  resource: {
    id?: string;
    dispute_id?: string;
    status?: string;
    reason?: string;
    dispute_amount?: {
      value: string;
      currency_code: string;
    };
    disputed_transactions?: Array<{
      seller_transaction_id?: string;
      custom_id?: string;
      buyer_transaction_id?: string;
      [key: string]: unknown;
    }>;
    seller_response_due_date?: string;
    [key: string]: unknown;
  };
}

export type DisputeJobStatus = "queued" | "processing" | "completed" | "failed";

export interface DisputeJob {
  id: string;
  jobName: typeof JOBS.disputeReceived;
  eventId: string;
  disputeId: string;
  status: DisputeJobStatus;
  payload: DisputeWebhookEvent;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface DisputeJobStore {
  createJob(job: Omit<DisputeJob, "id" | "createdAt" | "updatedAt">): Promise<{ job: DisputeJob; created: boolean }>;
  getJob(id: string): Promise<DisputeJob | null>;
  getJobByEventId(eventId: string): Promise<DisputeJob | null>;
  getJobsByDisputeId(disputeId: string): Promise<DisputeJob[]>;
  updateJobStatus(id: string, status: DisputeJobStatus, error?: string): Promise<DisputeJob>;
  listJobs(): Promise<DisputeJob[]>;
}

export class InMemoryDisputeJobStore implements DisputeJobStore {
  private readonly jobsById = new Map<string, DisputeJob>();
  private readonly jobIdsByEventId = new Map<string, string>();
  private seq = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async createJob(
    jobData: Omit<DisputeJob, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ job: DisputeJob; created: boolean }> {
    const existingId = this.jobIdsByEventId.get(jobData.eventId);
    if (existingId) {
      const existing = this.jobsById.get(existingId);
      if (existing) {
        return { job: existing, created: false };
      }
    }

    const timestamp = this.now();
    this.seq += 1;
    const id = `job_dispute_${this.seq}`;
    const job: DisputeJob = {
      ...jobData,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.jobsById.set(id, job);
    this.jobIdsByEventId.set(job.eventId, id);
    return { job, created: true };
  }

  async getJob(id: string): Promise<DisputeJob | null> {
    return this.jobsById.get(id) ?? null;
  }

  async getJobByEventId(eventId: string): Promise<DisputeJob | null> {
    const id = this.jobIdsByEventId.get(eventId);
    if (!id) return null;
    return this.jobsById.get(id) ?? null;
  }

  async getJobsByDisputeId(disputeId: string): Promise<DisputeJob[]> {
    return Array.from(this.jobsById.values()).filter((j) => j.disputeId === disputeId);
  }

  async updateJobStatus(id: string, status: DisputeJobStatus, error?: string): Promise<DisputeJob> {
    const job = this.jobsById.get(id);
    if (!job) {
      throw new Error(`Dispute job not found: ${id}`);
    }
    const updated: DisputeJob = {
      ...job,
      status,
      updatedAt: this.now(),
      ...(error ? { error } : {}),
    };
    this.jobsById.set(id, updated);
    return updated;
  }

  async listJobs(): Promise<DisputeJob[]> {
    return Array.from(this.jobsById.values());
  }
}

export interface IntakeOptions {
  db: Pick<Db, "appendAudit">;
  jobStore: DisputeJobStore;
}

export interface IntakeResult {
  job: DisputeJob;
  isDuplicate: boolean;
}

export function extractDisputeId(event: DisputeWebhookEvent): string {
  const id = event.resource?.dispute_id ?? event.resource?.id;
  if (!id || typeof id !== "string") {
    throw new Error(`Webhook event ${event.id ?? "unknown"} has no dispute id`);
  }
  return id;
}

export async function intakeDisputeEvent(
  event: DisputeWebhookEvent,
  options: IntakeOptions,
): Promise<IntakeResult> {
  if (!event.id) {
    throw new Error("Webhook event missing required id");
  }

  const disputeId = extractDisputeId(event);
  const { job, created } = await options.jobStore.createJob({
    jobName: JOBS.disputeReceived,
    eventId: event.id,
    disputeId,
    status: "queued",
    payload: event,
  });

  if (created) {
    await options.db.appendAudit({
      actor: "worker",
      action: "dispute.received",
      subjectId: disputeId,
      requestBody: {
        eventId: event.id,
        eventType: event.event_type,
        disputeId,
        jobId: job.id,
      },
    });
  } else {
    await options.db.appendAudit({
      actor: "worker",
      action: "dispute.duplicate_ignored",
      subjectId: disputeId,
      requestBody: {
        eventId: event.id,
        eventType: event.event_type,
        disputeId,
        existingJobId: job.id,
      },
    });
  }

  return { job, isDuplicate: !created };
}

export interface DisputeWebhookEventSource {
  fetchVerifiedDisputeEvents(): Promise<DisputeWebhookEvent[]>;
}

export async function consumeVerifiedDisputeEvents(
  events: DisputeWebhookEvent[],
  options: IntakeOptions,
): Promise<IntakeResult[]> {
  const results: IntakeResult[] = [];
  for (const event of events) {
    results.push(await intakeDisputeEvent(event, options));
  }
  return results;
}
