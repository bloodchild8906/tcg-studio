/**
 * Health endpoints.
 *
 * GET /healthz → cheap liveness check. Returns 200 if the process is up,
 *               regardless of dependencies.
 * GET /readyz  → readiness. Pings Postgres and returns 200 only when the DB
 *               is reachable. Use this for k8s readiness probes / load
 *               balancer membership.
 *
 * Both endpoints are TENANT-FREE — they're registered outside the tenant
 * scope so they don't blow up when the tenant table is empty (i.e. before
 * the first migration / seed).
 */

import type { FastifyInstance } from "fastify";
import { sendEmail, makePrismaSettingsLoader } from "@/lib/email";

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/healthz", async () => ({ ok: true }));

  fastify.get("/readyz", async (_request, reply) => {
    try {
      // Cheap round-trip — confirms pool, auth, and TCP all work.
      await fastify.prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: "reachable" };
    } catch (err) {
      fastify.log.warn({ err }, "readiness probe failed");
      return reply.code(503).send({ ok: false, db: "unreachable" });
    }
  });

  /**
   * POST /smoke/email — protected smoke test for the per-tenant SMTP.
   * Resolves the tenant by slug, then sends a "deploy verified" message to
   * the operator. Gated by the SMOKE_TEST_TOKEN env var so randos can't
   * spam the SMTP provider — set it in the API env and pass it as a header.
   *
   * Usage:
   *   curl -X POST https://tcgstudio.online/smoke/email \
   *     -H "X-Smoke-Token: $SMOKE_TEST_TOKEN" \
   *     -H "Content-Type: application/json" \
   *     -d '{"tenantSlug":"studio","to":"you@example.com"}'
   */
  fastify.post<{
    Body: { tenantSlug: string; to: string; subject?: string };
  }>("/smoke/email", async (request, reply) => {
    const expected = process.env.SMOKE_TEST_TOKEN;
    const given = request.headers["x-smoke-token"];
    if (!expected || given !== expected) {
      return reply.code(401).send({ error: "smoke token required" });
    }
    const { tenantSlug, to, subject } = request.body ?? ({} as never);
    if (!tenantSlug || !to) {
      return reply.code(400).send({ error: "tenantSlug + to required" });
    }
    const tenant = await fastify.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, name: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant not found" });
    const ok = await sendEmail({
      tenantId: tenant.id,
      loadSettings: makePrismaSettingsLoader(fastify.prisma),
      to,
      subject: subject ?? `Test email from ${tenant.name}`,
      text: `If you're reading this, ${tenant.name}'s SMTP relay is working.\n\nThis is an automated test message sent by /smoke/email.`,
      html: `<p>If you're reading this, <strong>${tenant.name}</strong>'s SMTP relay is working.</p><p style="color:#888;font-size:12px;">Automated test message sent by <code>/smoke/email</code>.</p>`,
      log: fastify.log,
    });
    return reply.send({ ok, tenant: tenant.slug, to });
  });
}
