/**
 * Host context endpoint.
 *
 * Frontend calls this on boot to learn what level it's at. Three
 * supported subdomain shapes:
 *   • `tcgstudio.local`                       → platform admin
 *   • `acme.tcgstudio.local`                  → tenant scope
 *   • `core.acme.tcgstudio.local`             → project scope (dot form)
 *   • `core-acme.tcgstudio.local`             → project scope (hyphen form)
 *
 * The hyphen form is ambiguous statically (project and tenant slugs
 * may both contain hyphens), so we try every plausible split against
 * the DB and pick the first match.
 *
 * Lives outside the tenant-scoped routes — it has to work when the
 * tenant doesn't yet exist (signup), and it's the source of truth the
 * frontend uses to drive its UI shell choice.
 *
 * The endpoint is unauthenticated by design: the host is already
 * public information (it's literally in the browser address bar), and
 * gating this would just force every page to show a login wall before
 * the user could see "this is the admin level, please sign in" vs
 * "this is the Acme tenant".
 */

import type { FastifyInstance } from "fastify";
import { parseHost } from "@/plugins/tenant";
import { loadEnv } from "@/env";

export default async function contextRoutes(fastify: FastifyInstance) {
  const env = loadEnv();

  fastify.get("/api/v1/context", async (request) => {
    // The browser may sit behind a different hostname than the API
    // (e.g. designer at `demo.tcgstudio.local:5173`, API at
    // `localhost:4000`). When that's the case the request's own
    // `Host` header tells us about the API, not the user's actual
    // location, and `parseHost` ends up classifying everything as
    // platform. Honour an explicit `?host=` hint from the client so
    // the resolver runs against the user's hostname instead.
    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const hostHint =
      typeof query.host === "string" && query.host.trim()
        ? query.host.trim()
        : null;
    const host = parseHost(hostHint ?? request.headers.host, env.ROOT_DOMAIN);

    // Resolve the tenant + project (when the host carries them) so the
    // frontend gets identity in one round-trip — no need to chase a
    // second `/api/v1/tenants/:slug` call before rendering.
    let tenant: { id: string; slug: string; name: string; status: string } | null = null;
    let project: { id: string; slug: string; name: string; status: string } | null = null;
    let resolvedLevel: "platform" | "tenant" | "project" = host.level;
    let resolvedProjectSlug: string | undefined = host.projectSlug;
    let resolvedTenantSlug: string | undefined = host.tenantSlug;

    if (host.tenantSlug) {
      const found = await fastify.prisma.tenant.findUnique({
        where: { slug: host.tenantSlug },
        select: { id: true, slug: true, name: true, status: true },
      });
      if (found) tenant = found;
    }

    // Compound fallback: literal slug missed but the host has hyphens —
    // walk each `<project>-<tenant>` candidate and pick the first that
    // matches a real (project, tenant) pair.
    if (!tenant && host.compoundCandidates?.length) {
      for (const cand of host.compoundCandidates) {
        const t = await fastify.prisma.tenant.findUnique({
          where: { slug: cand.tenantSlug },
          select: { id: true, slug: true, name: true, status: true },
        });
        if (!t) continue;
        const p = await fastify.prisma.project.findFirst({
          where: { tenantId: t.id, slug: cand.projectSlug },
          select: { id: true, slug: true, name: true, status: true },
        });
        if (p) {
          tenant = t;
          project = p;
          resolvedLevel = "project";
          resolvedTenantSlug = t.slug;
          resolvedProjectSlug = p.slug;
          break;
        }
      }
    }

    // Direct dot-form project lookup (no compound match required).
    if (tenant && !project && host.projectSlug) {
      const found = await fastify.prisma.project.findFirst({
        where: { tenantId: tenant.id, slug: host.projectSlug },
        select: { id: true, slug: true, name: true, status: true },
      });
      if (found) project = found;
    }

    return {
      level: resolvedLevel,
      rootDomain: host.rootDomain,
      tenantSlug: resolvedTenantSlug ?? null,
      projectSlug: resolvedProjectSlug ?? null,
      tenant,
      project,
      /**
       * For client convenience — what hostname should they use to
       * reach the platform / tenant root? The frontend uses this to
       * build "switch context" links.
       *
       * We emit BOTH the dot-separated and hyphen-separated forms of
       * the project URL so client code can present whichever matches
       * the user's preferred convention.
       */
      hosts: {
        platform: host.rootDomain,
        tenant: tenant ? `${tenant.slug}.${host.rootDomain}` : null,
        project:
          tenant && project ? `${project.slug}.${tenant.slug}.${host.rootDomain}` : null,
        projectCompound:
          tenant && project ? `${project.slug}-${tenant.slug}.${host.rootDomain}` : null,
      },
    };
  });
}
