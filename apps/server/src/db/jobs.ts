import type { ErrorCode } from "@symptomsketch/contracts";
import { type Db, fromJson, newId, now, toJson } from "./index.ts";

/** Known job kinds. Owners register handlers for these in their route module's register(). */
export const JOB_KINDS = {
  /** server-media: convert a raw recording to the final MP4 (payload { takeId }). */
  takeExport: "take_export",
  /** server-ai: Gemini visual critic on a ready take (payload { assessmentId }). */
  takeAssessment: "take_assessment",
  /** server-core: delete/expire case files (payload { caseId }). */
  caseCleanup: "case_cleanup",
} as const;
export type JobKind = (typeof JOB_KINDS)[keyof typeof JOB_KINDS] | (string & {});

export type JobStatus = "queued" | "running" | "done" | "failed" | "retryable";

export interface JobRecord<P = unknown> {
  id: string;
  kind: string;
  payload: P;
  status: JobStatus;
  attempts: number;
  idempotencyKey: string;
  caseId: string | null;
  errorCode: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Throw from a handler to record a bounded error code. `retryable` marks the job `retryable`
 * (explicit retry allowed via requeueJob) instead of `failed`.
 */
export class JobError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  constructor(code: ErrorCode, opts: { retryable?: boolean } = {}) {
    super(code);
    this.name = "JobError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
  }
}

export interface JobHandlerDef<P> {
  /** Max concurrently running jobs of this kind in this process. */
  concurrency: number;
  /** Abort + mark retryable after this many ms (signal is aborted first). */
  timeoutMs?: number;
  /** Error code recorded on timeout. Default INTERNAL_ERROR. */
  timeoutCode?: ErrorCode;
  /** Return value is stored as result_json. Must re-check case lifecycle before publishing output. */
  handler: (payload: P, job: JobRecord<P>, signal: AbortSignal) => Promise<unknown>;
}

interface JobRow {
  id: string;
  kind: string;
  payload_json: string;
  status: JobStatus;
  attempts: number;
  idempotency_key: string;
  case_id: string | null;
  error_code: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toRecord<P>(row: JobRow): JobRecord<P> {
  return {
    id: row.id,
    kind: row.kind,
    payload: fromJson<P>(row.payload_json, {} as P),
    status: row.status,
    attempts: row.attempts,
    idempotencyKey: row.idempotency_key,
    caseId: row.case_id,
    errorCode: row.error_code,
    result: fromJson<unknown>(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export interface EnqueueResult<P> {
  job: JobRecord<P>;
  /** false when an existing job with the same idempotency key was returned. */
  created: boolean;
}

/**
 * SQLite-backed job queue (spec 7: no separate queue service). One polling worker loop per
 * process; per-kind concurrency. Jobs never auto-retry: failures stay failed/retryable until an
 * explicit requeue (spec 11 retry-export / assessment retry).
 */
export class JobQueue {
  private readonly db: Db;
  private readonly pollMs: number;
  private readonly handlers = new Map<string, JobHandlerDef<unknown>>();
  private readonly running = new Map<string, Set<Promise<void>>>();
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor(db: Db, opts: { pollMs?: number } = {}) {
    this.db = db;
    this.pollMs = opts.pollMs ?? 500;
  }

  registerJobHandler<P>(kind: JobKind, def: JobHandlerDef<P>): void {
    if (this.handlers.has(kind)) throw new Error(`job handler already registered: ${kind}`);
    this.handlers.set(kind, def as JobHandlerDef<unknown>);
  }

  /** Insert a queued job, or return the existing job for the same idempotency key. */
  enqueueJob<P>(
    kind: JobKind,
    payload: P,
    idempotencyKey: string,
    opts: { caseId?: string | null } = {},
  ): EnqueueResult<P> {
    const existing = this.findByKey<P>(idempotencyKey);
    if (existing) return { job: existing, created: false };
    const ts = now();
    const id = newId("job");
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, payload_json, status, attempts, idempotency_key, case_id,
           created_at, updated_at) VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .run(id, kind, toJson(payload), idempotencyKey, opts.caseId ?? null, ts, ts);
    const job = this.findByKey<P>(idempotencyKey);
    if (!job) throw new Error("job insert failed");
    queueMicrotask(() => this.tick());
    return { job, created: job.id === id };
  }

  getJob<P = unknown>(id: string): JobRecord<P> | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? toRecord<P>(row) : null;
  }

  findByKey<P = unknown>(idempotencyKey: string): JobRecord<P> | null {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE idempotency_key = ?")
      .get(idempotencyKey) as JobRow | undefined;
    return row ? toRecord<P>(row) : null;
  }

  /** Move a failed/retryable job back to queued. Returns the job (unchanged if active/done). */
  requeueJob<P = unknown>(id: string): JobRecord<P> | null {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'queued', error_code = NULL, updated_at = ?
         WHERE id = ? AND status IN ('failed','retryable')`,
      )
      .run(now(), id);
    queueMicrotask(() => this.tick());
    return this.getJob<P>(id);
  }

  /** Tombstone queued/retryable jobs of a deleted/expired case (running ones must recheck). */
  cancelJobsForCase(caseId: string): number {
    const res = this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', error_code = 'CASE_INACTIVE', updated_at = ?
         WHERE case_id = ? AND status IN ('queued','retryable')`,
      )
      .run(now(), caseId);
    return Number(res.changes);
  }

  /** Startup recovery (spec 14): running -> retryable. Returns the number of recovered jobs. */
  recoverJobs(): number {
    const res = this.db
      .prepare(
        `UPDATE jobs SET status = 'retryable', error_code = COALESCE(error_code, 'INTERNAL_ERROR'),
           updated_at = ? WHERE status = 'running'`,
      )
      .run(now());
    return Number(res.changes);
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref();
    this.tick();
  }

  /** Stop polling and wait for in-flight jobs to settle. */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const all = [...this.running.values()].flatMap((s) => [...s]);
    await Promise.allSettled(all);
  }

  private tick(): void {
    if (this.stopping || !this.timer) return;
    for (const [kind, def] of this.handlers) {
      const active = this.running.get(kind) ?? new Set<Promise<void>>();
      this.running.set(kind, active);
      while (active.size < def.concurrency) {
        const row = this.claim(kind);
        if (!row) break;
        const p: Promise<void> = this.execute(def, toRecord(row)).finally(() => {
          active.delete(p);
          setImmediate(() => this.tick());
        });
        active.add(p);
      }
    }
  }

  private claim(kind: string): JobRow | undefined {
    const ts = now();
    return this.db
      .prepare(
        `UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ?
         WHERE id = (SELECT id FROM jobs WHERE kind = ? AND status = 'queued'
                     ORDER BY created_at LIMIT 1)
         RETURNING *`,
      )
      .get(ts, ts, kind) as JobRow | undefined;
  }

  private async execute(def: JobHandlerDef<unknown>, job: JobRecord<unknown>): Promise<void> {
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      def.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, def.timeoutMs)
        : null;
    try {
      const result = await def.handler(job.payload, job, controller.signal);
      if (timedOut) throw new JobError(def.timeoutCode ?? "INTERNAL_ERROR", { retryable: true });
      this.finish(job.id, "done", null, result ?? null);
    } catch (err) {
      if (timedOut) {
        this.finish(job.id, "retryable", def.timeoutCode ?? "INTERNAL_ERROR", null);
      } else if (err instanceof JobError) {
        this.finish(job.id, err.retryable ? "retryable" : "failed", err.code, null);
      } else {
        // Log the error class only; messages may carry provider bodies or paths.
        console.error(`[jobs] ${job.kind} ${job.id} failed: ${(err as Error)?.name ?? "Error"}`);
        this.finish(job.id, "failed", "INTERNAL_ERROR", null);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private finish(id: string, status: JobStatus, errorCode: string | null, result: unknown): void {
    const ts = now();
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, error_code = ?, result_json = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, errorCode, result === null ? null : toJson(result), ts, ts, id);
  }
}
