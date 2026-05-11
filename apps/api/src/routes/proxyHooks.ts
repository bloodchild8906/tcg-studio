/**
 * Proxy hooks — endpoints called by the HTTP proxy in front of the API
 * (Caddy / Traefik / NGINX), not by end users.
 *
 * These endpoints sit OUTSIDE the tenant-scoped Fastify scope because
 * they're called pre-tenant: the proxy hasn't decided whether to even
 * accept the connection yet. The tenant context isn't useful here.
 *
 * Auth: shared-secret token in `?token=` or `Authorization: Bearer`.
 * Configure via `PROXY_HOOK_TOKEN` env. When the env is empty (dev) we
 * skip auth; in production an empty token means the endpoint is closed.
 *
 * Routes:
 *   GET /api/internal/domain-allowed?domain=foo.example.com
 *     Caddy's `on_demand_tls.ask` directive POSTs this before issuing
 *     a Let's Encrypt cert. We return:
 *       200 — yes, this hostname is one of our active TenantDomains
 *             (or a subdomain of ROOT_DOMAIN, our own platform host).
 *       403 — not configured. Caddy refuses to issue a cert.
 *     This is critical: without it, an attacker could point arbitrary
 *     DNS at our IP and burn our Let's Encrypt rate limit.
 *
 *   GET /api/internal/active-domains
 *     Lists every active custom hostname, useful for proxies that
 *     prefer a static config rather than per-request lookups (Traefik
 *     dynamic providers, NGINX maps, etc).
 */

import type { FastifyInstance } from "fastify";
import { loadEnv } from "@/env";

export default async function proxyHookRoutes(fastify: FastifyInstance) {
  const env = loadEnv();

  function authOk(request: import("fastify").FastifyRequest): boolean {
    const required = env.PROXY_HOOK_TOKEN;
    if (!required) return true; // dev mode — open
    const q = (request.query as Record<string, string | undefined>)?.token;
    if (q && q === required) return true;
    const auth = request.headers.authorization;
    if (auth && auth === `Bearer ${required}`) return true;
    return false;
  }

  fastify.get("/api/internal/domain-allowed", async (request, reply) => {
    if (!authOk(request)) return reply.code(401).send({ error: "unauthorized" });

    const q = request.query as Record<string, string | undefined>;
    const raw = (q.domain ?? q.host ?? "").trim().toLowerCase();
    if (!raw) {
      return reply.code(400).send({ error: "domain_required" });
    }

    // Strip a port suffix if present — proxies sometimes pass host:port.
    const host = stripPort(raw);

    // Always allow our root domain and any of its subdomains: those are
    // tenant-routed via the canonical pattern, not via TenantDomain rows.
    const root = env.ROOT_DOMAIN.toLowerCase();
    if (host === root || host.endsWith(`.${root}`)) {
      return reply.send({ allowed: true, source: "root_domain" });
    }

    // Look up an active TenantDomain.
    const row = await fastify.prisma.tenantDomain.findFirst({
      where: { hostname: host, status: "active" },
      select: { tenantId: true, hostname: true },
    });
    if (row) {
      return reply.send({ allowed: true, source: "tenant_domain" });
    }
    return reply.code(403).send({ allowed: false });
  });

  /**
   * Snapshot of every active custom domain. Lightweight — proxies
   * typically poll this every 30-60 s.
   */
  fastify.get("/api/internal/active-domains", async (request, reply) => {
    if (!authOk(request)) return reply.code(401).send({ error: "unauthorized" });
    const rows = await fastify.prisma.tenantDomain.findMany({
      where: { status: "active" },
      select: { hostname: true, tenantId: true, isPrimary: true },
      orderBy: { hostname: "asc" },
    });
    return reply.send({ domains: rows });
  });
}

function stripPort(host: string): string {
  // Bracketed IPv6 first, then trailing :port.
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    if (close > 0) return host.slice(1, close).toLowerCase();
  }
  const colon = host.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    return host.slice(0, colon);
  }
  return host;
}
