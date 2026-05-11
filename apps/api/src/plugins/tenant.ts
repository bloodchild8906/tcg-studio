/**
 * Tenant context plugin.
 *
 * Resolves the active tenant + (optional) project for every request
 * and attaches a `TenantContext` to `request.tenantContext` (matching
 * spec sec 10.6 / 10.7).
 *
 * Resolution order (sec 10.4) — first match wins:
 *   1. Host header subdomain. Two patterns supported:
 *      • Dot-separated:     `<project>.<tenant>.tcgstudio.local`
 *      • Hyphen-separated:  `<project>-<tenant>.tcgstudio.local`
 *      • Tenant only:       `<tenant>.tcgstudio.local`
 *      • Root:              `tcgstudio.local` (platform-level)
 *   2. `X-Tenant-Slug` header
 *   3. `?tenant=` query param
 *   4. `:tenantSlug` URL param if the route uses one
 *   5. The configured DEFAULT_TENANT_SLUG (dev convenience)
 *
 * The hyphen pattern is convenient because it lives at one DNS label,
 * so a single wildcard cert / Acrylic glob (`>tcgstudio.local`) covers
 * everything. Disambiguation between "tenant slug containing a hyphen"
 * vs "project-tenant compound" is handled at the database level — we
 * try the literal form first, then split on each hyphen and look up
 * `(project, tenant)` pairs until we find one that exists.
 *
 * If no tenant matches, the route returns 404 — we don't leak whether
 * a slug exists across tenants.
 *
 * Routes that legitimately don't need a tenant (health, auth, public,
 * the platform-admin endpoints) skip the lookup by being registered
 * OUTSIDE the tenant-scoped scope (see server.ts).
 */

import fp from "fastify-plugin";
import type { FastifyRequest } from "fastify";
import { loadEnv } from "@/env";

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  /** Project resolved from `<project>.<tenant>.<root>` host. Optional. */
  projectId?: string;
  projectSlug?: string;
  /** "platform" / "tenant" / "project" — useful for permission scoping. */
  level: "tenant" | "project";
  /// Free-form feature flags — populated from tenant settings later (sec 42.4).
  featureFlags: ReadonlySet<string>;
}

/**
 * Decoded host context. Returned from `parseHost()` and consumed both
 * inside the tenant plugin and by the public `/api/v1/context`
 * endpoint that the frontend hits on boot.
 */
export interface HostContext {
  /** "platform" = root host, no subdomain. */
  level: "platform" | "tenant" | "project";
  rootDomain: string;
  tenantSlug?: string;
  projectSlug?: string;
  /**
   * When the host has a single subdomain label that contains hyphens
   * (e.g. `saga-acme.tcgstudio.local`), we surface every plausible
   * `<project>-<tenant>` split here. The tenant resolver tries each
   * one in DB order — the first split that maps to a real
   * (project, tenant) pair wins. We can't pick the right split without
   * DB access because both project and tenant slugs may contain hyphens.
   */
  compoundCandidates?: Array<{ projectSlug: string; tenantSlug: string }>;
}

declare module "fastify" {
  interface FastifyRequest {
    tenantContext?: TenantContext;
    hostContext?: HostContext;
  }
}

/**
 * Parse the request host into a structured context.
 *
 * The "root domain" is anything past the last 2 labels — so for
 * `acme.tcgstudio.local` the root is `tcgstudio.local` and the
 * subdomain is `acme`. For `core.acme.tcgstudio.local` the root is
 * still `tcgstudio.local`; the subdomain stack is `[core, acme]` and
 * we read it as project=core / tenant=acme.
 *
 * IPv4 / IPv6 / `localhost` short-circuit to "platform" because they
 * can't carry subdomains in the conventional sense — useful for tests
 * that hit `127.0.0.1:4000`.
 */
export function parseHost(host: string | undefined, configuredRoot: string): HostContext {
  const root = configuredRoot.toLowerCase();
  if (!host) return { level: "platform", rootDomain: root };
  // Strip port. IPv6 wraps in brackets — those carry colons that aren't ports.
  let h = host.toLowerCase();
  if (h.startsWith("[")) {
    return { level: "platform", rootDomain: root };
  }
  const colon = h.indexOf(":");
  if (colon !== -1) h = h.slice(0, colon);
  // Plain numeric / localhost — no subdomains.
  if (h === "localhost" || /^[\d.]+$/.test(h)) {
    return { level: "platform", rootDomain: root };
  }
  // Strip the configured root. If the host doesn't end with the root,
  // we treat it as platform — covers cases like a custom domain
  // pointing at the same backend (handled separately in the future).
  if (h !== root && !h.endsWith(`.${root}`)) {
    return { level: "platform", rootDomain: root };
  }
  if (h === root) {
    return { level: "platform", rootDomain: root };
  }
  // Strip the trailing `.<root>` — what's left is the subdomain stack.
  const sub = h.slice(0, -1 - root.length);
  const parts = sub.split(".").filter(Boolean);
  if (parts.length === 1) {
    // Single label. Could be a tenant slug, OR a `<project>-<tenant>`
    // compound. We surface BOTH interpretations and let the resolver
    // pick the one that exists in the DB. The "tenant slug" form is
    // returned as the primary tenantSlug so platform-level code that
    // doesn't know about compound forms still works.
    const compoundCandidates = compoundSplits(parts[0]);
    return {
      level: "tenant",
      rootDomain: root,
      tenantSlug: parts[0],
      ...(compoundCandidates.length > 0 ? { compoundCandidates } : {}),
    };
  }
  if (parts.length >= 2) {
    // Project subdomain on top, tenant beneath.
    // <project>.<tenant>.<root> — labels read leftmost-first as
    // [project, tenant, ...future-extensions].
    return {
      level: "project",
      rootDomain: root,
      projectSlug: parts[0],
      tenantSlug: parts[1],
    };
  }
  return { level: "platform", rootDomain: root };
}

/**
 * Generate every plausible `<project>-<tenant>` split of a single
 * subdomain label. We enumerate every hyphen position and emit the
 * (project, tenant) pair on each side. The DB resolver tries them in
 * the order returned (left-to-right hyphen position).
 *
 * Example: `core-acme-games`
 *   → [ {project: "core",      tenant: "acme-games"},
 *       {project: "core-acme", tenant: "games"} ]
 *
 * No splits are emitted when the label has no hyphens, or has hyphens
 * only at the boundaries (which the slug regex already disallows but
 * we filter defensively).
 */
function compoundSplits(label: string): Array<{ projectSlug: string; tenantSlug: string }> {
  const out: Array<{ projectSlug: string; tenantSlug: string }> = [];
  for (let i = 1; i < label.length - 1; i++) {
    if (label[i] !== "-") continue;
    const projectSlug = label.slice(0, i);
    const tenantSlug = label.slice(i + 1);
    if (!projectSlug || !tenantSlug) continue;
    if (projectSlug.endsWith("-") || tenantSlug.startsWith("-")) continue;
    out.push({ projectSlug, tenantSlug });
  }
  return out;
}

function resolveSlug(request: FastifyRequest): string | null {
  // Host-based resolution wins over headers / params so a user landed on
  // `acme.tcgstudio.local` always operates against `acme` regardless of
  // any stale X-Tenant-Slug from a multi-tab session.
  if (request.hostContext?.tenantSlug) return request.hostContext.tenantSlug;

  const header = request.headers["x-tenant-slug"];
  if (typeof header === "string" && header.trim()) return header.trim();
  if (Array.isArray(header) && header[0]) return header[0];

  const query = request.query as Record<string, string> | undefined;
  if (query?.tenant) return query.tenant;

  const params = request.params as Record<string, string> | undefined;
  if (params?.tenantSlug) return params.tenantSlug;

  return null;
}

export default fp(async (fastify) => {
  const env = loadEnv();

  fastify.addHook("preHandler", async (request, reply) => {
    try {
      // Decode the Host header once and stash it. Downstream code
      // (resolveSlug, the /context endpoint) can read it without
      // re-parsing.
      request.hostContext = parseHost(request.headers.host, env.ROOT_DOMAIN);

      // Custom domain fallback — when parseHost classifies the host as
      // "platform" but the host actually doesn't equal the root, try a
      // TenantDomain lookup. A miss leaves hostContext alone (still
      // platform), so non-tenant hosts (e.g. unknown domains pointed
      // at our IP) keep the platform-level behavior.
      if (
        request.hostContext.level === "platform" &&
        request.headers.host &&
        !isHostEqualToRoot(request.headers.host, env.ROOT_DOMAIN)
      ) {
        const customHost = stripPort(request.headers.host).toLowerCase();
        // Two attempts: exact host match, and "strip leading sub" so
        // `cards.acmegames.com` finds a domain registered as
        // `acmegames.com` and reads `cards` as the project subdomain.
        const exact = await fastify.prisma.tenantDomain.findFirst({
          where: { hostname: customHost, status: { in: ["verified", "active"] } },
          select: {
            tenantId: true,
            projectSlug: true,
            tenant: { select: { slug: true } },
          },
        });
        let resolved = exact;
        let projectFromHost: string | undefined = exact?.projectSlug ?? undefined;
        if (!resolved) {
          // Strip the leftmost label and try again — supports project
          // subdomains under a custom domain.
          const idx = customHost.indexOf(".");
          if (idx > 0) {
            const projectLabel = customHost.slice(0, idx);
            const stem = customHost.slice(idx + 1);
            const parent = await fastify.prisma.tenantDomain.findFirst({
              where: { hostname: stem, status: { in: ["verified", "active"] } },
              select: {
                tenantId: true,
                projectSlug: true,
                tenant: { select: { slug: true } },
              },
            });
            if (parent) {
              resolved = parent;
              projectFromHost = projectLabel;
            }
          }
        }
        if (resolved) {
          request.hostContext = {
            level: projectFromHost ? "project" : "tenant",
            rootDomain: env.ROOT_DOMAIN,
            tenantSlug: resolved.tenant.slug,
            projectSlug: projectFromHost,
          };
        }
      }

      const slug = resolveSlug(request) ?? env.DEFAULT_TENANT_SLUG;

      if (!slug) {
        reply.code(404).send({
          error: "tenant_not_found",
          message: "No tenant specified.",
        });
        return;
      }

      let tenant = await fastify.prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, status: true },
      });

      // Compound-host fallback: when the literal slug doesn't exist,
      // try each `<project>-<tenant>` candidate. Only run this when
      // the slug came from the host (so a user explicitly typing a
      // wrong slug into X-Tenant-Slug still gets a 404).
      if (
        !tenant &&
        request.hostContext?.compoundCandidates?.length &&
        request.hostContext.tenantSlug === slug
      ) {
        for (const cand of request.hostContext.compoundCandidates) {
          const t = await fastify.prisma.tenant.findUnique({
            where: { slug: cand.tenantSlug },
            select: { id: true, slug: true, status: true },
          });
          if (!t) continue;
          const p = await fastify.prisma.project.findFirst({
            where: { tenantId: t.id, slug: cand.projectSlug },
            select: { id: true, slug: true },
          });
          if (p) {
            tenant = t;
            // Rewrite hostContext so all downstream code (project
            // lookup below, /context-style frontend hooks) sees the
            // resolved interpretation rather than the raw label.
            request.hostContext = {
              ...request.hostContext,
              level: "project",
              tenantSlug: t.slug,
              projectSlug: p.slug,
            };
            break;
          }
        }
      }

      if (!tenant) {
        reply.code(404).send({
          error: "tenant_not_found",
          message: `Tenant '${slug}' does not exist.`,
        });
        return;
      }

      if (tenant.status === "suspended" || tenant.status === "disabled") {
        reply.code(403).send({
          error: "tenant_suspended",
          message: `Tenant '${slug}' is ${tenant.status}.`,
        });
        return;
      }

      // Auth enforcement: tenant-scoped routes require either a valid
      // user (JWT) or a valid API key bound to THIS tenant.
      const isDefaultDev = env.NODE_ENV === "development" && slug === env.DEFAULT_TENANT_SLUG;

      // API key path — the key carries its own tenantId. We require it
      // to match the resolved tenant; cross-tenant key reuse would be
      // a serious leak. Project-scoped keys (apiKey.projectId set)
      // additionally require the resolved project — if any — to match.
      if (request.apiKey) {
        if (request.apiKey.tenantId !== tenant.id) {
          reply.code(403).send({
            error: "apikey_wrong_tenant",
            message: "This API key isn't valid for the requested tenant.",
          });
          return;
        }
        // Project pinning: when a key was issued for a specific
        // project, refuse access to a different one. The host may not
        // have a project pinned (`<tenant>.<root>` requests); in that
        // case we still allow tenant-level metadata calls but
        // downstream project-scoped routes can re-check via
        // `apiKey.projectId` if they want to be strict.
        if (request.apiKey.projectId && request.hostContext?.projectSlug) {
          const hostProject = await fastify.prisma.project.findFirst({
            where: { tenantId: tenant.id, slug: request.hostContext.projectSlug },
            select: { id: true },
          });
          if (!hostProject || hostProject.id !== request.apiKey.projectId) {
            reply.code(403).send({
              error: "apikey_wrong_project",
              message:
                "This API key is scoped to a different project than the one in the request URL.",
            });
            return;
          }
        }
        request.tenantContext = {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          level: request.hostContext?.projectSlug ? "project" : "tenant",
          featureFlags: new Set(),
        };
        return;
      }

      if (!request.currentUser && !isDefaultDev) {
        reply.code(401).send({
          error: "auth_required",
          message: "Sign in to access this tenant.",
        });
        return;
      }

      // If we're skipping auth, we still need a mock user or we skip the membership check.
      if (isDefaultDev && !request.currentUser) {
        request.tenantContext = {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          level: request.hostContext?.projectSlug ? "project" : "tenant",
          featureFlags: new Set(),
        };
        return;
      }

      // We know request.currentUser is set here because of the checks above.
      const currentUser = request.currentUser!;

      const member = await fastify.prisma.membership.findUnique({
        where: {
          tenantId_userId: {
            tenantId: tenant.id,
            userId: currentUser.id,
          },
        },
        select: { id: true, role: true },
      });

      if (!member) {
        reply.code(403).send({
          error: "tenant_forbidden",
          message: `You're not a member of tenant '${slug}'.`,
        });
        return;
      }

      // Resolve project subdomain (when host is <project>.<tenant>.<root>).
      // We look up the project by slug scoped to this tenant — a
      // missing match is non-fatal (we just leave projectId empty);
      // the route-level handler can decide whether absent context is
      // an error.
      let projectId: string | undefined;
      let projectSlug: string | undefined;
      if (request.hostContext?.projectSlug) {
        const project = await fastify.prisma.project.findFirst({
          where: { tenantId: tenant.id, slug: request.hostContext.projectSlug },
          select: { id: true, slug: true },
        });
        if (project) {
          projectId = project.id;
          projectSlug = project.slug;

          // Project-membership gate (sec 13.4). When the host pins us
          // to a specific project, the user MUST hold an explicit
          // ProjectMembership row. Tenant role doesn't grant project
          // access — strict separation between tenant management and
          // project login (the user's policy: "tenants cannot log into
          // projects unless added as a user"). API keys skip the gate
          // because they're already tenant-scoped and were minted by a
          // tenant admin.
          if (!request.apiKey) {
            const pm = await fastify.prisma.projectMembership.findFirst({
              where: { userId: currentUser.id, projectId: project.id },
              select: { id: true },
            });
            if (!pm) {
              reply.code(403).send({
                error: "project_forbidden",
                message: `You're not a member of project '${projectSlug}'.`,
              });
              return;
            }
          }
        }
      }

      request.tenantContext = {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        projectId,
        projectSlug,
        level: projectSlug ? "project" : "tenant",
        featureFlags: new Set(),
      };
    } catch (err) {
      request.log.error({ err }, "tenant hook error");
      throw err;
    }
  });
});

/**
 * Helper for route handlers — throws a 500 if the tenant context is missing,
 * which means the route was registered outside the tenant scope by mistake.
 */
export function requireTenant(request: FastifyRequest): TenantContext {
  if (!request.tenantContext) {
    throw new Error(
      "tenantContext missing — register this route under the tenant-scoped Fastify instance.",
    );
  }
  return request.tenantContext;
}

/**
 * Strip a port suffix off a host string. Handles bracketed IPv6.
 * Used by the custom-domain fallback resolver so the lookup matches
 * the user-typed host without us having to encode ports in the
 * TenantDomain table.
 */
function stripPort(host: string): string {
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return close === -1 ? host : host.slice(0, close + 1);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/** Same shape check parseHost does — exposed for the custom-domain hook. */
function isHostEqualToRoot(host: string, root: string): boolean {
  const h = stripPort(host).toLowerCase();
  const r = root.toLowerCase();
  return h === r || h.endsWith(`.${r}`);
}
