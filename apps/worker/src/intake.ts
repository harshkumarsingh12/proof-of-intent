import type { Db } from "@poi/db";
import { DISPUTES_PAGE_SIZE, type DisputeListItem, type PayPalClient } from "@poi/paypal";
import { logger } from "./logger";
import { JOBS } from "./pipeline";

export type DisputeEventType =
  "CUSTOMER.DISPUTE.CREATED" | "CUSTOMER.DISPUTE.UPDATED" | "CUSTOMER.DISPUTE.RESOLVED";

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
  createJob(
    job: Omit<DisputeJob, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ job: DisputeJob; created: boolean }>;
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

/** 10 pages of 50 is 500 disputes per catch-up, far past what one merchant has open; a cycle later picks up the rest. */
export const DEFAULT_MAX_DISPUTE_PAGES = 10;

export interface DisputePagesResult {
  pagesRead: number;
  /** The last page we were allowed to read was full, so PayPal may hold more. The next cycle starts again at page 1. */
  hitMaxPages: boolean;
  /** A page after the first could not be read; the pages before it were handled and the rest waits for the next cycle. */
  stoppedEarly: boolean;
}

/**
 * Reads the merchant's disputes from PayPal one numbered page at a time (the Agent Toolkit pages by `page`, 50 to a page,
 * #234) and hands each page's new items to `onItems` as soon as it arrives, so a failure on page 3 does not lose pages
 * 1 and 2. Stops at a page that comes back short, at PayPal's own page count, or at `maxPages`. An id seen on an earlier
 * page is not handed over again: PayPal's list can shift while we page when a dispute is opened or updated. A failure
 * reading the first page is thrown (nothing was read); a failure on a later page is logged and ends the pass.
 */
export async function forEachDisputePage(
  client: Pick<PayPalClient, "listDisputesPage">,
  onItems: (items: DisputeListItem[]) => Promise<void>,
  options?: { maxPages?: number; log?: (msg: string) => void },
): Promise<DisputePagesResult> {
  const maxPages = options?.maxPages ?? DEFAULT_MAX_DISPUTE_PAGES;
  const log = options?.log ?? ((msg: string) => logger.warn(msg));
  const seen = new Set<string>();
  let pagesRead = 0;

  for (let page = 1; page <= maxPages; page++) {
    let res;
    try {
      res = await client.listDisputesPage(page);
    } catch (err) {
      if (page === 1) throw err;
      log(`dispute catch-up stopped at page ${page}: ${(err as Error).message}; the rest is read next cycle`);
      return { pagesRead, hitMaxPages: false, stoppedEarly: true };
    }
    pagesRead++;
    const fresh = res.items.filter((item) => !seen.has(item.dispute_id));
    for (const item of fresh) seen.add(item.dispute_id);
    if (fresh.length > 0) await onItems(fresh);

    const last =
      res.items.length < DISPUTES_PAGE_SIZE || (res.totalPages !== undefined && page >= res.totalPages);
    if (last) return { pagesRead, hitMaxPages: false, stoppedEarly: false };
  }
  return { pagesRead, hitMaxPages: true, stoppedEarly: false };
}
