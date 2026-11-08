/**
 * The worker's logger: pino, the same library the API's Fastify uses, writing one JSON object per line
 * (docs/CONVENTIONS.md, Code: logs go through a framework logger). The worker has no requests, so a line carries the id
 * of what it is about (`eventId`, `disputeId`) instead of a request id. Never put secrets, full addresses or mandate
 * payloads in a log line above debug.
 */
import { pino } from "pino";

export const logger = pino({ name: "worker", level: process.env.LOG_LEVEL ?? "info" });
