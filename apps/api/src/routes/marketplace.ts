/**
 * Marketplace API (sec 35).
 *
 * Endpoints group into three buckets:
 *
 *   Catalog (read-only) — list / search / get packages.
 *   Installs            — install / uninstall / list-mine for the
 *                         active tenant.
 *   Authoring           — register as a publisher, create + publish
 *                         packages from your own tenant. Gated by the
 *                         `publicMarketplacePublishing` feature flag.
 *
 * Conventions match the rest of /api/v1: Zod validation, tenant
 * resolution via `requireTenant`, audit rows on mutating actions.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { applyInstall } from "@/lib/marketplace";
import { featureEnabled, FeatureDisabledError } from "@/lib/plans";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  q: z.string().optional(),
  kind: z.string().optional(),
  category: z.string().optional(),
  scope: z.enum(["platform", "tenant"]).optional(),
  /** Filter to packages this tenant has installed. */
  installed: z.enum(["true", "false"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(48),
});

// Authoring inputs — kept narrow so a publisher can't smuggle arbitrary
// fields into the row (priceCents update, status flips). Status moves
// happen through dedicated review endpoints; price changes through a
// separate PATCH that re-routes to billing review (TODO).

const upsertPublisherBody = z.object({
  displayName: z.string().min(1).max(120),
  bio: z.string().max(2000).default(""),
  websiteUrl: z.string().max(500).default(""),
  iconAssetId: z.string().nullable().optional(),
});

const createPackageBody = z.object({
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase, hyphens, no leading hyphen"),
  name: z.string().min(1).max(140),
  kind: z.string().min(1).max(40),
  category: z.string().max(60).optional(),
  summary: z.string().max(280).default(""),
  description: z.string().max(8000).default(""),
  iconAssetId: z.string().nullable().optional(),
  galleryJson: z.array(z.string()).default([]),
  tagsJson: z.array(z.string()).default([]),
  /** "platform" requires `publicMarketplacePublishing` on the plan. */
  scope: z.enum(["platform", "tenant"]).default("platform"),
});

const updatePackageBody = z.object({
  name: z.string().min(1).max(140).optional(),
  category: z.string().max(60).nullable().optional(),
  summary: z.string().max(280).optional(),
  description: z.string().max(8000).optional(),
  iconAssetId: z.string().nullable().optional(),
  galleryJson: z.array(z.string()).optional(),
  tagsJson: z.array(z.string()).optional(),
  status: z.enum(["draft", "review", "approved", "deprecated"]).optional(),
});

const publishVersionBody = z.object({
  version: z
    .string()
    .min(1)
    .max(40)
    .regex(/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i, "must be semver-like"),
  changelog: z.string().max(4000).default(""),
  contentJson: z.record(z.unknown()).default({}),
});

const reviewBody = z.object({
  rating: z.number().int().min(1).max(5),
  body: z.string().max(2000).default(""),
});

export default async function marketplaceRoutes(fastify: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Catalog
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/marketplace/packages", async (request) => {
    const ctx = requireTenant(request);
    const q = listQuery.parse(request.query);

    // Visibility:
    //   • approved + scope=platform — visible to everyone.
    //   • scope=tenant + tenantId=current — visible to the owner.
    //   • status != approved — visible only to the package's owner tenant.
    const where: Prisma.MarketplacePackageWhereInput = {
      AND: [
        q.kind ? { kind: q.kind } : {},
        q.category ? { category: q.category } : {},
        q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: "insensitive" as const } },
                { summary: { contains: q.q, mode: "insensitive" as const } },
                { description: { contains: q.q, mode: "insensitive" as const } },
                { slug: { contains: q.q.toLowerCase(), mode: "insensitive" as const } },
              ],
            }
          : {},
        {
          OR: [
            { scope: "platform", status: "approved" },
            { tenantId: ctx.tenantId },
          ],
        },
        q.scope ? { scope: q.scope } : {},
      ],
    };

    const take = q.limit;
    const packages = await fastify.prisma.marketplacePackage.findMany({
      where,
      orderBy: [{ installCount: "desc" }, { name: "asc" }],
      take: take + 1,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        publisher: { select: { displayName: true, verified: true, iconAssetId: true } },
        _count: { select: { installs: true, reviews: true, versions: true } },
      },
    });

    const hasMore = packages.length > take;
    const slice = hasMore ? packages.slice(0, take) : packages;
    const nextCursor = hasMore ? slice[slice.length - 1].id : null;

    let installedIds: Set<string> | null = null;
    if (q.installed === "true" || q.installed === "false") {
      const ids = slice.map((p) => p.id);
      const installs = await fastify.prisma.marketplaceInstall.findMany({
        where: { tenantId: ctx.tenantId, packageId: { in: ids } },
        select: { packageId: true },
      });
      installedIds = new Set(installs.map((i) => i.packageId));
    }

    let result = slice;
    if (q.installed === "true" && installedIds)
      result = slice.filter((p) => installedIds!.has(p.id));
    if (q.installed === "false" && installedIds)
      result = slice.filter((p) => !installedIds!.has(p.id));

    return { packages: result, nextCursor };
  });

  fastify.get("/api/v1/marketplace/packages/:id", async (request, reply) => {
    const ctx = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const pkg = await fastify.prisma.marketplacePackage.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        AND: [
          {
            OR: [
              { scope: "platform", status: { in: ["approved", "review"] } },
              { tenantId: ctx.tenantId },
            ],
          },
        ],
      },
      include: {
        publisher: true,
        versions: { orderBy: { createdAt: "desc" }, take: 50 },
        reviews: {
          orderBy: { createdAt: "desc" },
          take: 25,
        },
        _count: { select: { installs: true, reviews: true, versions: true } },
      },
    });
    if (!pkg) return reply.code(404).send({ error: "package_not_found" });

    const installed = await fastify.prisma.marketplaceInstall.findUnique({
      where: { tenantId_packageId: { tenantId: ctx.tenantId, packageId: pkg.id } },
    });
    return { package: pkg, install: installed };
  });

  // -------------------------------------------------------------------------
  // Installs
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/marketplace/installs", async (request) => {
    const ctx = requireTenant(request);
    const installs = await fastify.prisma.marketplaceInstall.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        package: {
          include: {
            publisher: { select: { displayName: true, verified: true } },
          },
        },
      },
      orderBy: { installedAt: "desc" },
    });
    return { installs };
  });

  fastify.post("/api/v1/marketplace/packages/:id/install", async (request, reply) => {
    const ctx = requireTenant(request);
    const user = requireUser(request);
    const { id } = idParam.parse(request.params);

    const pkg = await fastify.prisma.marketplacePackage.findFirst({
      where: {
        OR: [{ id }, { slug: id }],
        AND: [
          {
            OR: [
              { scope: "platform", status: "approved" },
              { tenantId: ctx.tenantId },
            ],
          },
        ],
      },
      include: {
        versions: {
          where: { status: "approved" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    if (!pkg) return reply.code(404).send({ error: "package_not_found" });

    const latest = pkg.versions[0] ?? null;

    const install = await fastify.prisma.marketplaceInstall.upsert({
      where: { tenantId_packageId: { tenantId: ctx.tenantId, packageId: pkg.id } },
      create: {
        tenantId: ctx.tenantId,
        packageId: pkg.id,
        versionId: latest?.id,
        enabled: true,
      },
      update: { enabled: true, versionId: latest?.id ?? undefined },
      include: { package: true },
    });

    // Bump the denormalized counter (best-effort; race-tolerant since
    // it's only used for sort + display).
    await fastify.prisma.marketplacePackage.update({
      where: { id: pkg.id },
      data: { installCount: { increment: 1 } },
    });

    // Run kind-specific side-effects (plugin upsert, theme merge, ...).
    try {
      await applyInstall({
        prisma: fastify.prisma,
        tenantId: ctx.tenantId,
        packageId: pkg.id,
        versionContent: latest
          ? (latest.contentJson as Record<string, unknown>)
          : null,
        pkg: { id: pkg.id, slug: pkg.slug, name: pkg.name, kind: pkg.kind },
      });
    } catch (err) {
      fastify.log.error(
        { err, packageId: pkg.id, tenantId: ctx.tenantId },
        "marketplace install side-effect failed",
      );
    }

    await writeAudit(fastify.prisma, request, {
      tenantId: ctx.tenantId,
      action: "marketplace.install",
      actorUserId: user.id,
      entityType: "marketplace_package",
      entityId: pkg.id,
      metadata: { slug: pkg.slug, kind: pkg.kind, version: latest?.version },
    });

    return reply.code(201).send({ install });
  });

  fastify.post(
    "/api/v1/marketplace/packages/:id/uninstall",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);

      const pkg = await fastify.prisma.marketplacePackage.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });
      if (!pkg) return reply.code(404).send({ error: "package_not_found" });

      const result = await fastify.prisma.marketplaceInstall.deleteMany({
        where: { tenantId: ctx.tenantId, packageId: pkg.id },
      });
      if (result.count === 0)
        return reply.code(404).send({ error: "not_installed" });

      await fastify.prisma.marketplacePackage.update({
        where: { id: pkg.id },
        data: { installCount: { decrement: 1 } },
      });

      await writeAudit(fastify.prisma, request, {
        tenantId: ctx.tenantId,
        action: "marketplace.uninstall",
        actorUserId: user.id,
        entityType: "marketplace_package",
        entityId: pkg.id,
        metadata: { slug: pkg.slug },
      });

      return reply.code(204).send();
    },
  );

  // -------------------------------------------------------------------------
  // Reviews
  // -------------------------------------------------------------------------

  fastify.post(
    "/api/v1/marketplace/packages/:id/reviews",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);
      const body = reviewBody.parse(request.body);

      const pkg = await fastify.prisma.marketplacePackage.findFirst({
        where: { OR: [{ id }, { slug: id }] },
      });
      if (!pkg) return reply.code(404).send({ error: "package_not_found" });

      // One review per (package, user) — re-submitting updates.
      const review = await fastify.prisma.marketplaceReview.upsert({
        where: { packageId_userId: { packageId: pkg.id, userId: user.id } },
        create: {
          packageId: pkg.id,
          tenantId: ctx.tenantId,
          userId: user.id,
          rating: body.rating,
          body: body.body,
        },
        update: { rating: body.rating, body: body.body },
      });

      // Recompute the denormalized rating snapshot.
      const agg = await fastify.prisma.marketplaceReview.aggregate({
        where: { packageId: pkg.id },
        _avg: { rating: true },
        _count: { rating: true },
      });
      await fastify.prisma.marketplacePackage.update({
        where: { id: pkg.id },
        data: {
          ratingAvg10: Math.round((agg._avg.rating ?? 0) * 10),
          ratingCount: agg._count.rating ?? 0,
        },
      });

      await writeAudit(fastify.prisma, request, {
        tenantId: ctx.tenantId,
        action: "marketplace.review",
        actorUserId: user.id,
        entityType: "marketplace_package",
        entityId: pkg.id,
        metadata: { rating: body.rating },
      });

      return { review };
    },
  );

  // -------------------------------------------------------------------------
  // Authoring — publisher
  // -------------------------------------------------------------------------

  fastify.get("/api/v1/marketplace/publisher", async (request) => {
    const ctx = requireTenant(request);
    const publisher = await fastify.prisma.marketplacePublisher.findUnique({
      where: { tenantId: ctx.tenantId },
    });
    return { publisher };
  });

  fastify.put("/api/v1/marketplace/publisher", async (request) => {
    const ctx = requireTenant(request);
    const user = requireUser(request);
    const body = upsertPublisherBody.parse(request.body);

    const publisher = await fastify.prisma.marketplacePublisher.upsert({
      where: { tenantId: ctx.tenantId },
      create: {
        tenantId: ctx.tenantId,
        displayName: body.displayName,
        bio: body.bio,
        websiteUrl: body.websiteUrl,
        iconAssetId: body.iconAssetId ?? null,
      },
      update: {
        displayName: body.displayName,
        bio: body.bio,
        websiteUrl: body.websiteUrl,
        iconAssetId: body.iconAssetId ?? null,
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId: ctx.tenantId,
      action: "marketplace.publisher.update",
      actorUserId: user.id,
      entityType: "marketplace_publisher",
      entityId: publisher.id,
    });

    return { publisher };
  });

  // -------------------------------------------------------------------------
  // Authoring — packages
  // -------------------------------------------------------------------------

  /** List packages owned by the active tenant (drafts + published). */
  fastify.get("/api/v1/marketplace/my/packages", async (request) => {
    const ctx = requireTenant(request);
    const packages = await fastify.prisma.marketplacePackage.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        _count: { select: { installs: true, reviews: true, versions: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    return { packages };
  });

  fastify.post("/api/v1/marketplace/packages", async (request, reply) => {
    const ctx = requireTenant(request);
    const user = requireUser(request);
    const body = createPackageBody.parse(request.body);

    if (body.scope === "platform") {
      const allowed = await featureEnabled(
        fastify.prisma,
        ctx.tenantId,
        "publicMarketplacePublishing",
      );
      if (!allowed)
        throw new FeatureDisabledError("publicMarketplacePublishing");
    }

    const publisher = await fastify.prisma.marketplacePublisher.findUnique({
      where: { tenantId: ctx.tenantId },
    });

    const existing = await fastify.prisma.marketplacePackage.findUnique({
      where: { slug: body.slug },
    });
    if (existing) return reply.code(409).send({ error: "slug_taken" });

    const pkg = await fastify.prisma.marketplacePackage.create({
      data: {
        slug: body.slug,
        name: body.name,
        kind: body.kind,
        category: body.category ?? null,
        summary: body.summary,
        description: body.description,
        iconAssetId: body.iconAssetId ?? null,
        galleryJson: body.galleryJson as object,
        tagsJson: body.tagsJson as object,
        scope: body.scope,
        tenantId: ctx.tenantId,
        publisherId: publisher?.id ?? null,
        authorName: publisher?.displayName ?? "",
        // First-class moderation: tenant-scope packages auto-approve;
        // platform-scope go to "review" until a platform admin flips.
        status: body.scope === "tenant" ? "approved" : "review",
      },
    });

    await writeAudit(fastify.prisma, request, {
      tenantId: ctx.tenantId,
      action: "marketplace.package.create",
      actorUserId: user.id,
      entityType: "marketplace_package",
      entityId: pkg.id,
      metadata: { slug: pkg.slug, kind: pkg.kind, scope: pkg.scope },
    });

    return reply.code(201).send({ package: pkg });
  });

  fastify.patch(
    "/api/v1/marketplace/packages/:id",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);
      const body = updatePackageBody.parse(request.body);

      const owned = await fastify.prisma.marketplacePackage.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!owned) return reply.code(404).send({ error: "not_found" });

      const data: Prisma.MarketplacePackageUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.category !== undefined) data.category = body.category;
      if (body.summary !== undefined) data.summary = body.summary;
      if (body.description !== undefined) data.description = body.description;
      if (body.iconAssetId !== undefined) data.iconAssetId = body.iconAssetId;
      if (body.galleryJson !== undefined)
        data.galleryJson = body.galleryJson as object;
      if (body.tagsJson !== undefined) data.tagsJson = body.tagsJson as object;
      if (body.status !== undefined) {
        // Only allow self-flips into draft / deprecated. Promotion to
        // approved goes through a platform admin endpoint (TODO).
        if (body.status === "approved" && owned.scope === "platform") {
          return reply
            .code(403)
            .send({ error: "platform_packages_need_admin_approval" });
        }
        data.status = body.status;
      }

      const pkg = await fastify.prisma.marketplacePackage.update({
        where: { id },
        data,
      });

      await writeAudit(fastify.prisma, request, {
        tenantId: ctx.tenantId,
        action: "marketplace.package.update",
        actorUserId: user.id,
        entityType: "marketplace_package",
        entityId: id,
      });

      return { package: pkg };
    },
  );

  fastify.delete(
    "/api/v1/marketplace/packages/:id",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);

      const result = await fastify.prisma.marketplacePackage.deleteMany({
        where: { id, tenantId: ctx.tenantId },
      });
      if (result.count === 0)
        return reply.code(404).send({ error: "not_found" });

      await writeAudit(fastify.prisma, request, {
        tenantId: ctx.tenantId,
        action: "marketplace.package.delete",
        actorUserId: user.id,
        entityType: "marketplace_package",
        entityId: id,
      });

      return reply.code(204).send();
    },
  );

  fastify.post(
    "/api/v1/marketplace/packages/:id/versions",
    async (request, reply) => {
      const ctx = requireTenant(request);
      const user = requireUser(request);
      const { id } = idParam.parse(request.params);
      const body = publishVersionBody.parse(request.body);

      const pkg = await fastify.prisma.marketplacePackage.findFirst({
        where: { id, tenantId: ctx.tenantId },
      });
      if (!pkg) return reply.code(404).send({ error: "not_found" });

      const dup = await fastify.prisma.marketplacePackageVersion.findUnique({
        where: { packageId_version: { packageId: id, version: body.version } },
      });
      if (dup) return reply.code(409).send({ error: "version_exists" });

      const version = await fastify.prisma.marketplacePackageVersion.create({
        data: {
          packageId: id,
          version: body.version,
          changelog: body.changelog,
          contentJson: body.contentJson as object,
          status: pkg.scope === "tenant" ? "approved" : "review",
          publishedAt: new Date(),
        },
      });

      await writeAudit(fastify.prisma, request, {
        tenantId: ctx.tenantId,
        action: "marketplace.version.publish",
        actorUserId: user.id,
        entityType: "marketplace_package",
        entityId: id,
        metadata: { version: body.version },
      });

      return reply.code(201).send({ version });
    },
  );

  // -------------------------------------------------------------------------
  // Templates — starter scaffolds for authoring (#182)
  // -------------------------------------------------------------------------
  //
  // A developer who wants to author a plugin / theme / frame pack /
  // etc. hits this endpoint to download a starter scaffold. The
  // returned JSON has the shape `MarketplacePackageVersion.contentJson`
  // expects for that kind, plus a manifest with sensible defaults
  // the author edits before submitting. We don't gate by role — the
  // template is just an example, and there's no point making people
  // sign up before they can see how a plugin looks.

  fastify.get(
    "/api/v1/marketplace/templates/:kind",
    async (request, reply) => {
      const { kind } = z
        .object({ kind: z.string().min(1).max(40) })
        .parse(request.params);
      const tpl = MARKETPLACE_TEMPLATES[kind];
      if (!tpl) {
        return reply.code(404).send({
          error: "unknown_kind",
          knownKinds: Object.keys(MARKETPLACE_TEMPLATES),
        });
      }
      return reply.send({ kind, template: tpl });
    },
  );

  // List every available template — used by the frontend to render
  // a "what can I author?" picker without hard-coding the kinds.
  fastify.get("/api/v1/marketplace/templates", async () => {
    return {
      kinds: Object.keys(MARKETPLACE_TEMPLATES).map((k) => ({
        kind: k,
        label: MARKETPLACE_TEMPLATE_LABELS[k] ?? k,
        summary: MARKETPLACE_TEMPLATE_SUMMARIES[k] ?? "",
      })),
    };
  });
}

/* --------------------------------------------------------------------- */
/* Template scaffolds                                                     */
/* --------------------------------------------------------------------- */
//
// Each template is { package, version } where `package` is the create-
// route input shape and `version` is the create-version input. The
// author fills out fields, drops the file into the create-package +
// create-version calls, and a submission lands in the review queue.
//
// Kept dependency-free + inline so the route is fast (templates don't
// hit the database) and so contributors can read the example payload
// alongside the route that serves it.

const MARKETPLACE_TEMPLATE_LABELS: Record<string, string> = {
  plugin: "Plugin",
  frame_pack: "Frame pack",
  icon_pack: "Icon pack",
  font_pack: "Font pack",
  rules_pack: "Rules pack",
  ability_pack: "Ability pack",
  exporter: "Exporter",
  starter_kit: "Starter kit",
  cms_theme: "CMS theme",
  cms_block_pack: "CMS block pack",
  board_layout: "Board layout",
  print_profile: "Print profile",
  pack_generator: "Pack generator",
};

const MARKETPLACE_TEMPLATE_SUMMARIES: Record<string, string> = {
  plugin: "Sandboxed iframe runner with a host-API permission manifest.",
  frame_pack: "Bundle of card frame / nameplate / banner assets keyed by faction.",
  icon_pack: "Faction / cost / keyword icon set.",
  font_pack: "Hosted webfont family with style + weight metadata.",
  rules_pack: "Turn structure + phases + priority windows.",
  ability_pack: "Reusable ability graph nodes.",
  exporter: "Custom export profile — runs through the plugin runtime.",
  starter_kit: "Pre-seeded project with cards / sets / templates.",
  cms_theme: "CMS theme tokens + layout overrides.",
  cms_block_pack: "Custom CMS block definitions.",
  board_layout: "Playmat / zone layout for the playtest engine.",
  print_profile: "DPI / bleed / safe-zone preset.",
  pack_generator: "Booster-pack rarity slot rules.",
};

const MARKETPLACE_TEMPLATES: Record<string, unknown> = {
  plugin: {
    package: {
      slug: "my-plugin",
      name: "My Plugin",
      kind: "plugin",
      category: "Tools",
      summary: "Adds a custom panel to the Card Type Designer.",
      description:
        "## What it does\n\nThis plugin adds…\n\n## Permissions\n\nReads project / cards.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["example", "plugin"],
    },
    version: {
      version: "0.1.0",
      changelog: "Initial release.",
      contentJson: {
        manifest: {
          id: "com.example.my-plugin",
          name: "My Plugin",
          version: "0.1.0",
          permissions: ["read:project", "read:cards"],
          uiContributions: [
            {
              slot: "designer.inspector.bottom",
              label: "Example panel",
              entry: "index.html",
            },
          ],
        },
        files: {
          "index.html":
            "<!doctype html>\n<html><body>\n<h1>Hello from my plugin</h1>\n<script type=\"module\" src=\"./plugin.js\"></script>\n</body></html>",
          "plugin.js":
            "// Use the host API attached to window.tcgsdk.\nwindow.tcgsdk?.ready?.();\n",
        },
      },
    },
  },
  frame_pack: {
    package: {
      slug: "my-frame-pack",
      name: "My Frame Pack",
      kind: "frame_pack",
      category: "Visuals",
      summary: "Frames in five faction variants.",
      description: "Five faction frames + matching nameplates and ability boxes.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["frame", "faction"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        assets: [
          {
            name: "frame-fire",
            type: "frame",
            faction: "fire",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,…replace_me…",
          },
        ],
      },
    },
  },
  icon_pack: {
    package: {
      slug: "my-icon-pack",
      name: "My Icon Pack",
      kind: "icon_pack",
      category: "Visuals",
      summary: "Faction + cost icons.",
      description: "Drop-in icon set for cost slots and keyword badges.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["icon"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        icons: [
          {
            name: "cost-fire",
            kind: "cost",
            mimeType: "image/svg+xml",
            dataUrl: "data:image/svg+xml;base64,…replace_me…",
          },
        ],
      },
    },
  },
  font_pack: {
    package: {
      slug: "my-font-pack",
      name: "My Font Pack",
      kind: "font_pack",
      category: "Visuals",
      summary: "Hosted display font for card titles.",
      description: "Open-source titling font with bold + italic variants.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["font"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        fonts: [
          {
            family: "MyTitleFont",
            url: "https://example.com/mytitlefont.woff2",
            style: "normal",
            weight: 700,
          },
        ],
      },
    },
  },
  rules_pack: {
    package: {
      slug: "my-rules-pack",
      name: "My Rules Pack",
      kind: "rules_pack",
      category: "Rules",
      summary: "Custom turn structure.",
      description: "Replaces the default phase ladder with a draft-style turn.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["rules", "turn"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        ruleset: {
          phases: [
            { id: "untap", label: "Untap" },
            { id: "draw", label: "Draw" },
            { id: "main", label: "Main" },
            { id: "end", label: "End" },
          ],
        },
      },
    },
  },
  ability_pack: {
    package: {
      slug: "my-ability-pack",
      name: "My Ability Pack",
      kind: "ability_pack",
      category: "Rules",
      summary: "Reusable ability graph nodes.",
      description: "Adds Lifelink and Trample to the ability node library.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["ability"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        nodes: [
          { id: "lifelink", label: "Lifelink", trigger: "damage_dealt", effect: "gain_life" },
        ],
      },
    },
  },
  exporter: {
    package: {
      slug: "my-exporter",
      name: "My Exporter",
      kind: "exporter",
      category: "Production",
      summary: "Custom Tabletop Simulator deck exporter.",
      description: "Bundles cards into a TTS deck with custom back art.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["export", "tts"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        manifest: {
          id: "com.example.my-exporter",
          name: "My Exporter",
          target: "tts",
        },
        code: "// Exporter code — runs in the plugin sandbox.\nexport async function run(host) {\n  const cards = await host.cards.list();\n  return { fileName: 'deck.json', bytes: new TextEncoder().encode(JSON.stringify(cards)) };\n}\n",
      },
    },
  },
  starter_kit: {
    package: {
      slug: "my-starter-kit",
      name: "My Starter Kit",
      kind: "starter_kit",
      category: "Education",
      summary: "Beginner-friendly card game template.",
      description: "Pre-built project with 3 card types, 50 cards, and a Core set.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["starter", "tutorial"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        project: { name: "Starter Game", slug: "starter-game" },
        cardTypes: [],
        cards: [],
        sets: [{ name: "Core", code: "COR" }],
      },
    },
  },
  cms_theme: {
    package: {
      slug: "my-cms-theme",
      name: "My CMS Theme",
      kind: "cms_theme",
      category: "Visuals",
      summary: "Studio-dark CMS theme.",
      description: "Brass + obsidian palette with bold display headings.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["cms", "theme"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        theme: {
          tokensJson: {
            accent: "#d4a24c",
            surface: "#0b0d10",
            text: "#e6e9ee",
            headingFont: "Inter",
            bodyFont: "Inter",
            density: "comfortable",
            radius: 12,
          },
          layoutJson: { container: "1200px" },
        },
      },
    },
  },
  cms_block_pack: {
    package: {
      slug: "my-cms-blocks",
      name: "My CMS Blocks",
      kind: "cms_block_pack",
      category: "Visuals",
      summary: "Custom CMS blocks for card-game sites.",
      description: "Adds a deck-list block and a tournament-result block.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["cms", "blocks"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        blocks: [
          { type: "deck_list", label: "Deck list", schema: { deckId: "string" } },
        ],
      },
    },
  },
  board_layout: {
    package: {
      slug: "my-board-layout",
      name: "My Board Layout",
      kind: "board_layout",
      category: "Production",
      summary: "Commander-style 4-player playmat.",
      description: "Cross-shaped layout with shared center.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["board", "commander"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        width: 1920,
        height: 1080,
        zones: [],
      },
    },
  },
  print_profile: {
    package: {
      slug: "my-print-profile",
      name: "My Print Profile",
      kind: "print_profile",
      category: "Production",
      summary: "MakePlayingCards.com poker preset.",
      description: "300 DPI, 3mm bleed, 5mm safe zone, sheet of 18.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["print", "preset"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        dpi: 300,
        bleedMm: 3,
        safeZoneMm: 5,
        sheetLayout: { cols: 3, rows: 6 },
      },
    },
  },
  pack_generator: {
    package: {
      slug: "my-pack-rules",
      name: "My Pack Rules",
      kind: "pack_generator",
      category: "Production",
      summary: "Standard 15-card booster rules.",
      description: "11 commons + 3 uncommons + 1 rare/mythic slot with weighted upgrade.",
      priceCents: 0,
      authorName: "Your name",
      tagsJson: ["pack", "booster"],
    },
    version: {
      version: "1.0.0",
      changelog: "Initial release.",
      contentJson: {
        slots: [
          { rarity: "common", count: 11 },
          { rarity: "uncommon", count: 3 },
          { rarity: "rare", count: 1, mythicChance: 0.125 },
        ],
      },
    },
  },
};
