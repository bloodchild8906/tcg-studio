/**
 * Background job system (sec 38).
 *
 * Two pieces:
 *
 *   1. `enqueueJob(...)` — fire-and-forget — call from any route to
 *      queue work. Returns the persisted Job row so the caller can
 *      hand the id to the user / show progress.
 *
 *   2. `JobWorker` — the loop that polls queued rows and dispatches
 *      to registered handlers. v0 runs in-process inside the API
 *      container; the loop is kicked off from `server.ts` after the
 *      Fastify instance boots.
 *
 * Handlers register against the `JOB_HANDLERS` map by job type
 * string. Each handler gets a context with the Prisma client + the
 * job row + a `progress` callback for streaming updates back to the
 * row's `payloadJson.progress` field (so a UI can show a progress
 * bar without round-tripping the worker).
 *
 * Concurrency: a single worker uses `SELECT ... FOR UPDATE SKIP
 * LOCKED` to claim one queued row at a time; running multiple
 * workers in parallel is safe because each row can only be claimed
 * by one. The skip-locked clause means contention doesn't block —
 * each worker just grabs the next available row.
 *
 * Retry policy: a failed handler increments `attempts` and reschedules
 * via exponential backoff (`nextRunAt = now + 2^attempt seconds`).
 * After `maxAttempts` exhausted, the job lands in `status=failed` and
 * stops retrying.
 */

import type { PrismaClient, Prisma, Job } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { channels, emit } from "@/plugins/realtime";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobContext {
  prisma: PrismaClient;
  log: FastifyBaseLogger;
  job: Job;
  /**
   * Persist a progress update so a UI can render a progress bar
   * without polling stdout. Pushed into `payloadJson.progress`.
   */
  progress(value: { pct?: number; message?: string }): Promise<void>;
}

export type JobHandler = (
  ctx: JobContext,
) => Promise<Record<string, unknown> | void>;

const JOB_HANDLERS = new Map<string, JobHandler>();

/**
 * Register a handler for a job type. Call this from server bootstrap
 * before starting the worker. Re-registration replaces the previous
 * handler — useful for tests.
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  JOB_HANDLERS.set(type, handler);
}

export async function enqueueJob(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    type: string;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
    createdBy?: string | null;
    /** Defer execution until at least this time. */
    runAt?: Date;
  },
): Promise<Job> {
  return prisma.job.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      payloadJson:
        (input.payload ?? {}) as unknown as Prisma.InputJsonValue,
      maxAttempts: input.maxAttempts ?? 3,
      nextRunAt: input.runAt ?? new Date(),
      createdBy: input.createdBy ?? null,
    },
  });
}

/**
 * Polling worker. Construct once at server boot, call `start()`. Stops
 * cleanly on `stop()`; the active job (if any) is allowed to finish.
 */
export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private active = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
    private readonly options: {
      pollMs?: number;
      maxConcurrent?: number;
    } = {},
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.tickOnce();
      } catch (err) {
        this.log.error({ err }, "job worker tick failed");
      }
      this.timer = setTimeout(tick, this.options.pollMs ?? 1500);
    };
    void tick();
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    // Give active jobs a chance to finish — bound how long we wait.
    const deadline = Date.now() + 5_000;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private async tickOnce() {
    const max = this.options.maxConcurrent ?? 2;
    if (this.active >= max) return;
    const slots = max - this.active;
    for (let i = 0; i < slots; i++) {
      const claimed = await this.claimNext();
      if (!claimed) return; // queue empty
      this.active++;
      // Don't await — let the loop pick up another slot in parallel.
      void this.runOne(claimed).finally(() => {
        this.active--;
      });
    }
  }

  /**
   * Claim a single queued job atomically. Postgres-specific: we use a
   * raw `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction so
   * concurrent workers never claim the same row.
   */
  private async claimNext(): Promise<Job | null> {
    return this.prisma.$transaction(async (tx) => {
      // Find one queued + due row, skipping locked. Limit 1.
      const candidates = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
          FROM "Job"
         WHERE "status" = 'queued'
           AND "nextRunAt" <= NOW()
         ORDER BY "createdAt" ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      `;
      const id = candidates[0]?.id;
      if (!id) return null;
      const job = await tx.job.update({
        where: { id },
        data: {
          status: "running",
          startedAt: new Date(),
          attempts: { increment: 1 },
        },
      });
      return job;
    });
  }

  private async runOne(job: Job) {
    const handler = JOB_HANDLERS.get(job.type);
    if (!handler) {
      this.log.warn({ jobId: job.id, type: job.type }, "no handler for job type");
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lastError: `no handler registered for "${job.type}"`,
          completedAt: new Date(),
        },
      });
      return;
    }

    let workingJob = job;
    try {
      const result = await handler({
        prisma: this.prisma,
        log: this.log,
        job: workingJob,
        progress: async (value) => {
          const payload =
            (workingJob.payloadJson as Record<string, unknown>) ?? {};
          const next = { ...payload, progress: value };
          workingJob = await this.prisma.job.update({
            where: { id: workingJob.id },
            data: { payloadJson: next as Prisma.InputJsonValue },
          });
        },
      });
      const finished = await this.prisma.job.update({
        where: { id: workingJob.id },
        data: {
          status: "completed",
          resultJson: (result ?? {}) as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          lastError: null,
        },
      });
      emit({
        channel: channels.exports(finished.tenantId),
        kind: "job.completed",
        payload: { jobId: finished.id, type: finished.type },
      });
    } catch (err) {
      const message =
        err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      const exhausted = workingJob.attempts >= workingJob.maxAttempts;
      const backoffSec = Math.pow(2, workingJob.attempts);
      this.log.error(
        { err, jobId: workingJob.id, type: workingJob.type, exhausted },
        "job handler failed",
      );
      const failed = await this.prisma.job.update({
        where: { id: workingJob.id },
        data: {
          status: exhausted ? "failed" : "queued",
          lastError: message.slice(0, 4000),
          startedAt: null,
          nextRunAt: exhausted
            ? new Date()
            : new Date(Date.now() + backoffSec * 1000),
          completedAt: exhausted ? new Date() : null,
        },
      });
      if (exhausted) {
        emit({
          channel: channels.exports(failed.tenantId),
          kind: "job.failed",
          payload: { jobId: failed.id, type: failed.type, error: message },
        });
      }
    }
  }
}
