/**
 * Built-in job handlers. Each registers itself with the `JOB_HANDLERS`
 * map at import time so the worker can dispatch by `type` string.
 *
 * Adding a handler:
 *   1. Define an async function `(ctx) => result | void`.
 *   2. Call `registerJobHandler("namespaced.type", handler)` at module
 *      top-level (so it runs on import).
 *   3. Enqueue via `enqueueJob(prisma, { tenantId, type: "...", payload })`.
 *
 * Handlers should be SHORT — they run inside the API container's
 * worker pool. Long-running CPU-bound work (PDF rendering with
 * complex layouts, big-spritesheet packing, ML inference) belongs in
 * a dedicated worker process; this file is the dispatch surface for
 * the lightweight ops that just happen to be slow because they touch
 * the database a lot.
 */

import { registerJobHandler, type JobContext } from "@/lib/jobs";

/**
 * `tenant.snapshot` — produce a top-level summary of the tenant's
 * state (counts of cards, assets, projects, etc). Useful as a smoke
 * test for the worker pipeline AND a real diagnostic the support
 * team can fire on demand. Stored as the job's resultJson so the user
 * can fetch it back from /api/v1/jobs/:id.
 */
async function snapshotHandler(ctx: JobContext) {
  await ctx.progress({ pct: 5, message: "counting projects" });
  const projects = await ctx.prisma.project.count({
    where: { tenantId: ctx.job.tenantId },
  });
  await ctx.progress({ pct: 30, message: "counting cards" });
  const cards = await ctx.prisma.card.count({
    where: { tenantId: ctx.job.tenantId },
  });
  await ctx.progress({ pct: 60, message: "counting assets" });
  const assets = await ctx.prisma.asset.count({
    where: { tenantId: ctx.job.tenantId },
  });
  await ctx.progress({ pct: 90, message: "counting CMS pages" });
  const pages = await ctx.prisma.cmsPage.count({
    where: { tenantId: ctx.job.tenantId },
  });
  await ctx.progress({ pct: 100, message: "done" });
  return {
    counts: { projects, cards, assets, pages },
    capturedAt: new Date().toISOString(),
  };
}
registerJobHandler("tenant.snapshot", snapshotHandler);

/**
 * `cms.publish.scheduled` — publishes a scheduled CMS page when its
 * `scheduledAt` time has passed. The CMS publish route writes a job
 * with `runAt` set to the scheduled time; the worker picks it up at
 * that moment and flips the page from `scheduled` to `published`.
 *
 * This unblocks the spec's "Schedule publish" feature without
 * needing a separate cron service.
 */
async function publishScheduledHandler(ctx: JobContext) {
  const payload = ctx.job.payloadJson as { pageId?: string } | null;
  const pageId = payload?.pageId;
  if (!pageId) throw new Error("missing pageId");

  const page = await ctx.prisma.cmsPage.findFirst({
    where: { id: pageId, tenantId: ctx.job.tenantId },
  });
  if (!page) throw new Error("page no longer exists");
  if (page.status !== "scheduled") {
    // Either already published or unscheduled — no-op gracefully.
    return { skipped: true, reason: `page status is ${page.status}` };
  }

  await ctx.prisma.cmsPage.update({
    where: { id: page.id },
    data: {
      status: "published",
      publishedJson: page.contentJson as never,
      publishedAt: new Date(),
      scheduledAt: null,
    },
  });
  return { published: true, pageId: page.id };
}
registerJobHandler("cms.publish.scheduled", publishScheduledHandler);

/**
 * `webhook.replay` — re-fire a past webhook delivery. Surfaces in the
 * webhook delivery history UI as a "retry" button for failed rows.
 * Pulls the original payload off the WebhookDelivery row and runs
 * `dispatchWebhook` against the still-active subscription.
 */
async function webhookReplayHandler(ctx: JobContext) {
  const payload = ctx.job.payloadJson as { deliveryId?: string } | null;
  const deliveryId = payload?.deliveryId;
  if (!deliveryId) throw new Error("missing deliveryId");

  const delivery = await ctx.prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });
  if (!delivery) throw new Error("delivery no longer exists");
  if (delivery.webhook.tenantId !== ctx.job.tenantId)
    throw new Error("tenant mismatch");
  if (!delivery.webhook.enabled) {
    return { skipped: true, reason: "webhook disabled" };
  }

  // Lazy-import the dispatcher to avoid a circular import; jobs.ts
  // shouldn't pull in the HTTP-fetching webhook code on boot.
  const { dispatchWebhook } = await import("@/lib/webhooks");
  await dispatchWebhook(ctx.prisma, ctx.log, {
    tenantId: delivery.webhook.tenantId,
    event: delivery.event,
    data:
      ((delivery.payloadJson as Record<string, unknown>)?.data as
        | Record<string, unknown>
        | undefined) ?? {},
  });
  return { replayed: true, deliveryId };
}
registerJobHandler("webhook.replay", webhookReplayHandler);
