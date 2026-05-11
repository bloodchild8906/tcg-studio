/**
 * Fastify bootstrap.
 *
 * Two scopes:
 *   • Top-level     — health endpoints, no tenant required.
 *   • Tenant-scoped — every API route, gated by the tenant plugin so
 *                     `request.tenantContext` is always populated.
 *
 * Order matters: prisma → tenant → routes. We register the tenant plugin
 * inside an `register` block so health endpoints (registered above it) skip
 * the tenant check.
 */

import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import sensible from "@fastify/sensible";

import { loadEnv } from "@/env";
import prismaPlugin from "@/plugins/prisma";
import storagePlugin from "@/plugins/storage";
import authPlugin from "@/plugins/auth";
import tenantPlugin from "@/plugins/tenant";
import errorPlugin from "@/plugins/error";
import healthRoutes from "@/routes/health";
import authRoutes from "@/routes/auth";
import tenantRoutes from "@/routes/tenants";
import projectRoutes from "@/routes/projects";
import projectMembershipRoutes from "@/routes/projectMemberships";
import supportRoutes from "@/routes/support";
import cardTypeRoutes from "@/routes/cardTypes";
import templateRoutes from "@/routes/templates";
import cardRoutes from "@/routes/cards";
import setRoutes from "@/routes/sets";
import keywordRoutes from "@/routes/keywords";
import factionRoutes from "@/routes/factions";
import blockRoutes from "@/routes/blocks";
import loreRoutes from "@/routes/lore";
import deckRoutes from "@/routes/decks";
import boardRoutes from "@/routes/boards";
import rulesetRoutes from "@/routes/rulesets";
import abilityRoutes from "@/routes/abilities";
import variantBadgeRoutes from "@/routes/variantBadges";
import contextRoutes from "@/routes/context";
import tenantDomainRoutes from "@/routes/tenantDomains";
import publicRoutes from "@/routes/public";
import assetRoutes from "@/routes/assets";
import assetFolderRoutes from "@/routes/assetFolders";
import membershipRoutes from "@/routes/memberships";
import cmsRoutes from "@/routes/cms";
import proxyHookRoutes from "@/routes/proxyHooks";
import apiKeyRoutes from "@/routes/apiKeys";
import auditRoutes from "@/routes/audit";
import pluginRoutes from "@/routes/plugins";
import collabRoutes from "@/routes/collab";
import webhookRoutes from "@/routes/webhooks";
import jobRoutes from "@/routes/jobs";
import planRoutes from "@/routes/plans";
import marketplaceRoutes from "@/routes/marketplace";
import searchRoutes from "@/routes/search";
import cardCommentRoutes from "@/routes/cardComments";
import realtimePlugin, { registerWebsocketSupport } from "@/plugins/realtime";
import playtestRoutes from "@/routes/playtest";
import platformRoutes from "@/routes/platform";
import inlineImageRoutes from "@/routes/inlineImages";
import { JobWorker } from "@/lib/jobs";
// Side-effect import — registers the built-in handlers so the worker
// can dispatch them by type. New handlers go in lib/jobHandlers.ts.
import "@/lib/jobHandlers";

async function build() {
  const env = loadEnv();

  const fastify = Fastify({
    logger: env.PRETTY_LOGS
      ? {
          level: env.NODE_ENV === "production" ? "info" : "debug",
          transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss" } },
        }
      : { level: "info" },
    trustProxy: true,
  });

  await fastify.register(sensible);
  await fastify.register(helmet, {
    // SPA can be hosted on a different origin in dev; lock this down later.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  });
  await fastify.register(cors, {
    // Origin matching is host-aware so subdomain-routed dev URLs work.
    // We accept:
    //   • The explicit list in CORS_ORIGINS (comma-separated, exact match)
    //   • Anything ending in `.<ROOT_DOMAIN>` at any port — covers
    //     `acme.tcgstudio.local:5173`, `saga-acme.tcgstudio.local:5173`,
    //     and custom-domain test hosts pointed at 127.0.0.1.
    //   • Any TenantDomain hostname registered in the DB at runtime —
    //     makes prod custom domains work without redeploying CORS rules.
    //     We don't need that for dev so it's left to a future hook.
    // `*` short-circuits to "allow any" for staging environments.
    origin: env.CORS_ORIGINS === "*"
      ? true
      : (origin, cb) => {
          // No-origin requests (curl, server-to-server) are always allowed.
          if (!origin) return cb(null, true);
          const allowed = env.CORS_ORIGINS.split(",")
            .map((o: string) => o.trim())
            .filter(Boolean);
          if (allowed.includes(origin)) return cb(null, true);
          // Suffix-match against ROOT_DOMAIN. URL parses `http://x:5173`
          // so we read `.hostname` (no scheme/port) for the suffix check.
          try {
            const u = new URL(origin);
            const root = env.ROOT_DOMAIN.toLowerCase();
            const host = u.hostname.toLowerCase();
            if (host === root || host.endsWith(`.${root}`)) {
              return cb(null, true);
            }
          } catch {
            /* fall through to deny */
          }
          return cb(new Error(`origin ${origin} not allowed`), false);
        },
    credentials: true,
  });
  await fastify.register(prismaPlugin);
  await fastify.register(storagePlugin);
  await fastify.register(authPlugin);
  await fastify.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // matches assets route MAX_BYTES
      files: 1,
    },
  });
  await fastify.register(errorPlugin);

  // WebSocket support has to register at the root scope BEFORE any
  // encapsulated block adds a `/ws` route. Registering it inside the
  // tenant-scoped block confused @fastify/websocket's upgrade hook
  // and caused every regular HTTP request to be killed mid-handshake
  // (`ERR_EMPTY_RESPONSE` in the browser). The route definition still
  // lives inside the tenant block via `realtimePlugin` below — only
  // the plugin attachment moves to root.
  await fastify.register(registerWebsocketSupport);

  // Tenant-free routes go here — health endpoints don't need a tenant,
  // and the tenant CRUD itself can't require tenant context (chicken/egg).
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(tenantRoutes);
  // Host context — frontend calls this on boot to learn the level
  // (platform / tenant / project) from the request's Host header.
  await fastify.register(contextRoutes);
  // Public read-only routes resolve their tenant from the URL path.
  // Live alongside the unauthenticated routes by design.
  await fastify.register(publicRoutes);
  // Proxy hooks (Caddy on-demand TLS, etc.) are pre-tenant — they tell
  // the proxy whether a hostname is configured before any tenant lookup
  // happens. Token-gated via PROXY_HOOK_TOKEN.
  await fastify.register(proxyHookRoutes);
  // Platform-admin routes — auth-gated via JWT, but cross-tenant by
  // design so they sit outside the tenant-scoped block. The route
  // file enforces `User.platformRole`.
  await fastify.register(platformRoutes);
  // Inline-image endpoints live at root scope (not tenant-encapsulated)
  // because the public GETs need to be reachable from anyone — the
  // public site's header pulls the tenant logo without auth.
  await fastify.register(inlineImageRoutes);

  // Everything below this register call gets tenant context auto-resolved.
  await fastify.register(async (app) => {
    await app.register(tenantPlugin);
    await app.register(projectRoutes);
    await app.register(projectMembershipRoutes);
    await app.register(supportRoutes);
    await app.register(cardTypeRoutes);
    await app.register(templateRoutes);
    await app.register(cardRoutes);
    await app.register(setRoutes);
    await app.register(keywordRoutes);
    await app.register(factionRoutes);
    await app.register(blockRoutes);
    await app.register(loreRoutes);
    await app.register(deckRoutes);
    await app.register(boardRoutes);
    await app.register(rulesetRoutes);
    await app.register(abilityRoutes);
    await app.register(variantBadgeRoutes);
    await app.register(tenantDomainRoutes);
    await app.register(assetRoutes);
    await app.register(assetFolderRoutes);
    await app.register(membershipRoutes);
    await app.register(cmsRoutes);
    await app.register(apiKeyRoutes);
    await app.register(auditRoutes);
    await app.register(pluginRoutes);
    await app.register(collabRoutes);
    await app.register(webhookRoutes);
    await app.register(jobRoutes);
    await app.register(planRoutes);
    await app.register(marketplaceRoutes);
    await app.register(searchRoutes);
    await app.register(cardCommentRoutes);
    await app.register(playtestRoutes);
    // Realtime hub — the upgrade endpoint at /ws is tenant-aware
    // (uses the same hostname resolver as REST), so it sits inside
    // the tenant-scoped block.
    await app.register(realtimePlugin);
  });

  return { fastify, env };
}

async function main() {
  const { fastify, env } = await build();

  // Boot the in-process job worker. v0 design: jobs run inside the
  // same Node process as the API. This is fine for low traffic; the
  // worker can move into a dedicated container later by extracting
  // this same JobWorker into a separate entrypoint that boots Prisma
  // and calls .start() without registering Fastify routes.
  const worker = new JobWorker(fastify.prisma, fastify.log, {
    pollMs: 1500,
    maxConcurrent: 2,
  });
  worker.start();

  // Graceful shutdown — Fastify's onClose hooks (incl. Prisma) run on signals.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      fastify.log.info({ sig }, "shutting down");
      await worker.stop();
      await fastify.close();
      process.exit(0);
    });
  }

  try {
    await fastify.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
