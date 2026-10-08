/** Client request id for idempotent paid / duplicate-prone calls (spec 11). */
export function newClientRequestId(): string {
  return crypto.randomUUID();
}

/** Idempotency key for uploads, reviews, tickets, replies. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** Application run id for one Record next take attempt (spec 12). */
export function newRunId(): string {
  return `run_${crypto.randomUUID()}`;
}
