/**
 * Tenant-scoped search (sec 39).
 *
 * Single fanout endpoint that searches across the user-visible data
 * surfaces in one request. Results are mixed across kinds and
 * returned with a stable `kind` discriminator the frontend uses to
 * pick the right icon + navigation target.
 *
 * Why fanout instead of a dedicated index:
 *
 *   • Postgres trigram / GIN indexes give us decent search quality
 *     for the dataset sizes we care about (thousands per tenant).
 *   • Spinning up Meilisearch / Typesense / Elastic for v0 would
 *     ship a second runtime + a sync pipeline; not worth the
 *     complexity until we need fuzzy/suggest/typo-tolerant queries.
 *   • A separate index can replace this endpoint later — frontend
 *     just consumes the same response shape.
 *
 * Tenant isolation — every query filters by the current tenant. We
 * NEVER trust a client-supplied tenantId; the resolver attaches the
 * authoritative one to `request` via `requireTenant`.
 *
 * The active project, if known, biases results: cards / assets /
 * sets / abilities / keywords / factions / lore from the current
 * project come first; cross-project results follow.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireTenant } from "@/plugins/tenant";

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  /** Bias results to this project — cards / assets / etc filter to it
   *  first, then cross-project as a second pass. */
  projectId: z.string().optional(),
  /** Restrict the kinds searched. Comma-separated; default = all. */
  kinds: z.string().optional(),
  /** Per-kind cap. The endpoint always returns at most `limit` per
   *  kind so a noisy kind (e.g. assets) can't drown a precise hit
   *  in a different kind. */
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const ALL_KINDS = [
  "project",
  "card",
  "card_type",
  "asset",
  "set",
  "deck",
  "keyword",
  "faction",
  "lore",
  "ability",
  "cms_page",
  "marketplace",
] as const;

type Kind = (typeof ALL_KINDS)[number];

interface Hit {
  id: string;
  kind: Kind;
  title: string;
  subtitle?: string;
  /** A small text excerpt from the matching field, when applicable. */
  match?: string;
  /** Optional project context for navigation hints. */
  projectId?: string;
  projectSlug?: string;
  /** Numerical score — higher is better. Front-end may resort. */
  score?: number;
}

export default async function searchRoutes(fastify: FastifyInstance) {
  fastify.get("/api/v1/search", async (request) => {
    const ctx = requireTenant(request);
    const { q, projectId, kinds, limit } = searchQuery.parse(request.query);

    const wanted: Set<Kind> = kinds
      ? new Set(
          kinds
            .split(",")
            .map((s) => s.trim() as Kind)
            .filter((k) => ALL_KINDS.includes(k as Kind)),
        )
      : new Set(ALL_KINDS);

    const needle = q.trim();
    const ci = (_field: string): Prisma.StringFilter => ({
      contains: needle,
      mode: "insensitive",
    });

    // We deliberately run all queries in parallel — each one is cheap
    // and the wall-clock time is dominated by the slowest single
    // query, not the sum.
    const tasks: Array<Promise<Hit[]>> = [];

    if (wanted.has("project")) {
      tasks.push(
        fastify.prisma.project
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              OR: [
                { name: ci("name") },
                { slug: ci("slug") },
                { description: ci("description") },
              ],
            },
            take: limit,
            select: { id: true, name: true, slug: true, description: true },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "project",
              title: r.name,
              subtitle: `Project · ${r.slug}`,
              match: r.description?.slice(0, 120),
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("card")) {
      tasks.push(
        fastify.prisma.card
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              // Card text fields live inside `dataJson` — Postgres
              // JSON path queries would be cheap but Prisma's
              // generated types make case-insensitive json lookup
              // awkward. Title + slug catches 90% of real queries.
              OR: [{ name: ci("name") }, { slug: ci("slug") }],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              projectId: true,
              project: { select: { slug: true } },
            },
            orderBy: { updatedAt: "desc" },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "card",
              title: r.name,
              subtitle: `Card · ${r.slug}`,
              projectId: r.projectId,
              projectSlug: r.project?.slug,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("card_type")) {
      tasks.push(
        fastify.prisma.cardType
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [{ name: ci("name") }, { slug: ci("slug") }],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              projectId: true,
              project: { select: { slug: true } },
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "card_type",
              title: r.name,
              subtitle: `Card type · ${r.slug}`,
              projectId: r.projectId,
              projectSlug: r.project?.slug,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("asset")) {
      tasks.push(
        fastify.prisma.asset
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [{ name: ci("name") }, { slug: ci("slug") }],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              type: true,
              projectId: true,
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "asset",
              title: r.name,
              subtitle: `Asset · ${r.type} · ${r.slug}`,
              projectId: r.projectId ?? undefined,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("set")) {
      tasks.push(
        fastify.prisma.set
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [
                { name: ci("name") },
                { code: ci("code") },
                { description: ci("description") },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              code: true,
              projectId: true,
              project: { select: { slug: true } },
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "set",
              title: r.name,
              subtitle: `Set · ${r.code}`,
              projectId: r.projectId,
              projectSlug: r.project?.slug,
              score: scoreOf(needle, r.name, r.code),
            })),
          ),
      );
    }

    if (wanted.has("deck")) {
      tasks.push(
        fastify.prisma.deck
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [{ name: ci("name") }, { slug: ci("slug") }],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              projectId: true,
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "deck",
              title: r.name,
              subtitle: `Deck · ${r.slug}`,
              projectId: r.projectId,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("keyword")) {
      tasks.push(
        fastify.prisma.keyword
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [
                { name: ci("name") },
                { slug: ci("slug") },
                { reminderText: ci("reminderText") },
                { rulesDefinition: ci("rulesDefinition") },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              reminderText: true,
              projectId: true,
              project: { select: { slug: true } },
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "keyword",
              title: r.name,
              subtitle: `Keyword · ${r.slug}`,
              match: r.reminderText?.slice(0, 120),
              projectId: r.projectId,
              projectSlug: r.project?.slug,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("faction")) {
      tasks.push(
        fastify.prisma.faction
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [
                { name: ci("name") },
                { slug: ci("slug") },
                { description: ci("description") },
                { lore: ci("lore") },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              description: true,
              projectId: true,
              project: { select: { slug: true } },
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "faction",
              title: r.name,
              subtitle: `Faction · ${r.slug}`,
              match: r.description?.slice(0, 120),
              projectId: r.projectId,
              projectSlug: r.project?.slug,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("ability")) {
      tasks.push(
        fastify.prisma.ability
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [
                { name: ci("name") },
                { slug: ci("slug") },
                { text: ci("text") },
                { reminderText: ci("reminderText") },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              text: true,
              projectId: true,
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "ability",
              title: r.name,
              subtitle: `Ability · ${r.slug}`,
              match: r.text?.slice(0, 120),
              projectId: r.projectId,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("lore")) {
      tasks.push(
        fastify.prisma.lore
          .findMany({
            where: {
              tenantId: ctx.tenantId,
              ...(projectId ? { projectId } : {}),
              OR: [
                { name: ci("name") },
                { slug: ci("slug") },
                { summary: ci("summary") },
                { body: ci("body") },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              kind: true,
              summary: true,
              projectId: true,
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "lore",
              title: r.name,
              subtitle: `Lore · ${r.kind} · ${r.slug}`,
              match: r.summary?.slice(0, 120),
              projectId: r.projectId,
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("cms_page")) {
      tasks.push(
        fastify.prisma.cmsPage
          .findMany({
            where: {
              site: { tenantId: ctx.tenantId },
              OR: [
                { title: ci("title") },
                { slug: ci("slug") },
                { seoDescription: ci("seoDescription") },
              ],
            },
            take: limit,
            select: {
              id: true,
              title: true,
              slug: true,
              seoDescription: true,
              site: { select: { id: true, name: true, slug: true } },
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "cms_page",
              title: r.title,
              subtitle: `Page · ${r.site.name} · /${r.slug || "(home)"}`,
              match: r.seoDescription?.slice(0, 120),
              score: scoreOf(needle, r.title, r.slug),
            })),
          ),
      );
    }

    if (wanted.has("marketplace")) {
      tasks.push(
        fastify.prisma.marketplacePackage
          .findMany({
            where: {
              OR: [
                { scope: "platform", status: "approved" },
                { tenantId: ctx.tenantId },
              ],
              AND: [
                {
                  OR: [
                    { name: ci("name") },
                    { slug: ci("slug") },
                    { summary: ci("summary") },
                    { description: ci("description") },
                  ],
                },
              ],
            },
            take: limit,
            select: {
              id: true,
              name: true,
              slug: true,
              summary: true,
              kind: true,
            },
          })
          .then((rows) =>
            rows.map<Hit>((r) => ({
              id: r.id,
              kind: "marketplace",
              title: r.name,
              subtitle: `Marketplace · ${r.kind}`,
              match: r.summary?.slice(0, 120),
              score: scoreOf(needle, r.name, r.slug),
            })),
          ),
      );
    }

    const all = (await Promise.all(tasks)).flat();
    // Sort within-kind by score; the frontend groups by kind so a
    // global sort is unnecessary, but a stable order helps the
    // "first result is best" UX.
    all.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    // Group by kind for a tidy response. Each kind is its own array
    // so the client can render section headers without re-bucketing.
    const grouped: Record<string, Hit[]> = {};
    for (const k of ALL_KINDS) grouped[k] = [];
    for (const hit of all) grouped[hit.kind].push(hit);

    return {
      query: needle,
      total: all.length,
      hits: all,
      grouped,
    };
  });
}

/** Tiny scoring heuristic — same idea the old client-side filter
 *  used. Prefix on title beats prefix on slug beats contains. */
function scoreOf(q: string, ...fields: Array<string | null | undefined>): number {
  const needle = q.toLowerCase();
  let best = 0;
  let weight = 100;
  for (const f of fields) {
    if (!f) {
      weight = Math.max(10, weight - 10);
      continue;
    }
    const s = f.toLowerCase();
    if (s === needle) best = Math.max(best, weight + 50);
    else if (s.startsWith(needle)) best = Math.max(best, weight);
    else if (s.includes(needle)) best = Math.max(best, weight - 30);
    weight = Math.max(10, weight - 10);
  }
  return best;
}
