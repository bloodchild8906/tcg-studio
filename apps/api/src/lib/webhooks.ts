/**
 * Webhook dispatcher (sec 36).
 *
 * `dispatchWebhook(prisma, log, input)` enqueues a delivery —
 * actually it runs synchronously (fire-and-forget) for v0; the
 * upgrade path is to push to a Redis queue and a worker. Errors are
 * caught and logged; the caller never blocks on webhook results.
 *
 * Event-name matching:
 *   • Exact match: `cms.page.publish` matches subscriptions to
 *     `cms.page.publish`.
 *   • Wildcard: a trailing `.*` matches one segment ("cms.page.*"
 *     matches `cms.page.publish` and `cms.page.unpublish`, but NOT
 *     `cms.page.version.restore`).
 *   • `*` alone matches every event (kitchen-sink subscription).
 *
 * Signing: every request carries
 *     X-Tcgs-Signature: t=<unix>,v1=<hex>
 * where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Receivers
 * recompute and constant-time compare.
 */

import type { PrismaClient, Prisma } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import crypto from "node:crypto";

export interface WebhookEventInput {
  tenantId: string;
  event: string;
  /** Domain payload — JSON-serialized into the request body. */
  data: Record<string, unknown>;
}

export async function dispatchWebhook(
  prisma: PrismaClient,
  log: FastifyBaseLogger | null,
  input: WebhookEventInput,
): Promise<void> {
  try {
    const subs = await prisma.webhook.findMany({
      where: {
        tenantId: input.tenantId,
        enabled: true,
      },
    });
    const matching = subs.filter((s) =>
      eventsMatch(s.events as unknown as string[], input.event),
    );
    if (matching.length === 0) return;

    // Fire each delivery in parallel. We don't await the outer call
    // because the caller is doing user-facing work and shouldn't block
    // on webhooks. We DO await inside this function so logs land in
    // order.
    await Promise.all(
      matching.map((s) => deliverOne(prisma, log, s, input)),
    );
  } catch (err) {
    log?.error({ err, event: input.event }, "webhook dispatch failed");
  }
}

async function deliverOne(
  prisma: PrismaClient,
  log: FastifyBaseLogger | null,
  webhook: {
    id: string;
    targetUrl: string;
    secret: string;
    failureBackoff: number;
    consecutiveFailures: number;
  },
  input: WebhookEventInput,
): Promise<void> {
  const payload = {
    id: crypto.randomUUID(),
    event: input.event,
    tenantId: input.tenantId,
    createdAt: new Date().toISOString(),
    data: input.data,
  };
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto
    .createHmac("sha256", webhook.secret)
    .update(`${ts}.${rawBody}`)
    .digest("hex");

  const t0 = Date.now();
  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorCode: string | null = null;
  let ok = false;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8_000);
    const r = await fetch(webhook.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "TCGStudio-Webhook/1.0",
        "X-Tcgs-Event": input.event,
        "X-Tcgs-Signature": `t=${ts},v1=${sig}`,
      },
      body: rawBody,
      signal: ac.signal,
    });
    clearTimeout(t);
    responseStatus = r.status;
    // Truncate the response body so a misbehaving target can't fill
    // our database with a 50MB error page.
    const txt = await r.text().catch(() => "");
    responseBody = txt.slice(0, 2048);
    ok = r.status >= 200 && r.status < 300;
    if (!ok) errorCode = `http_${r.status}`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "fetch_failed";
    errorCode = code;
    ok = false;
  }
  const durationMs = Date.now() - t0;

  // Persist the delivery.
  try {
    await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event: input.event,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        responseStatus,
        responseBody,
        ok,
        errorCode,
        durationMs,
      },
    });
  } catch (err) {
    log?.error({ err, webhookId: webhook.id }, "webhook delivery write failed");
  }

  // Update aggregate counters on the webhook row. Auto-disable when
  // we cross the failureBackoff threshold so a permanently-broken URL
  // doesn't keep firing forever.
  const nextFailures = ok ? 0 : webhook.consecutiveFailures + 1;
  const shouldDisable =
    !ok &&
    webhook.failureBackoff > 0 &&
    nextFailures >= webhook.failureBackoff;
  try {
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        consecutiveFailures: nextFailures,
        ...(ok ? { lastSuccessAt: new Date() } : { lastFailureAt: new Date() }),
        ...(shouldDisable ? { enabled: false } : {}),
      },
    });
  } catch (err) {
    log?.error({ err, webhookId: webhook.id }, "webhook counter update failed");
  }
}

/**
 * Match a fired event name against an array of subscription patterns.
 *   "*"           — matches every event
 *   "cms.*"       — matches "cms.<anything single segment>"
 *   "cms.page.*"  — matches "cms.page.<anything single segment>"
 *   "cms.page.publish" — exact match only
 */
export function eventsMatch(patterns: string[] | null, event: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  for (const p of patterns) {
    if (p === "*") return true;
    if (p === event) return true;
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -2);
      const rest = event.slice(prefix.length);
      // event must start with prefix + "." and have exactly one more segment.
      if (
        event.startsWith(prefix + ".") &&
        rest.startsWith(".") &&
        !rest.slice(1).includes(".")
      ) {
        return true;
      }
    }
  }
  return false;
}
