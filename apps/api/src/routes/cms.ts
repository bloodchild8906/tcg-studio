/**
 * CMS routes (sec 14).
 *
 * Implements the tenant-side editor API: sites, pages, and per-site
 * navigation menus. Public read endpoints live in `routes/public.ts`
 * because they have to resolve a tenant from the URL path/host without
 * an Authorization header.
 *
 * Editorial flow (sec 14.10):
 *   draft → in_review → approved → scheduled → published → unpublished → archived
 *
 * Publishing (`POST /pages/:id/publish`) snapshots the current
 * `contentJson` into `publishedJson` (so live readers never see a
 * half-edited tree) AND writes a CmsPageVersion row for restore.
 * Unpublishing flips status without touching `publishedJson` so a
 * later re-publish is a one-click action.
 */

import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireTenant } from "@/plugins/tenant";
import { requireUser } from "@/plugins/auth";
import { writeAudit } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { enqueueJob } from "@/lib/jobs";
import { channels, emit } from "@/plugins/realtime";

const idParam = z.object({ id: z.string().min(1) });

const slugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

// ---------- sites ----------------------------------------------------------

const siteCreateBody = z.object({
  kind: z.enum(["studio", "game", "gallery", "rules", "lore", "event"]).optional(),
  name: z.string().min(1).max(120),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  projectId: z.string().min(1).nullable().optional(),
  themeJson: z.record(z.unknown()).optional(),
  settingsJson: z.record(z.unknown()).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

const sitePatchBody = siteCreateBody.partial();

// ---------- pages ----------------------------------------------------------

/**
 * Block tree validator. We accept anything well-formed (id/type/props)
 * and trust plugin block types to validate their own props on render —
 * this matches the "core stays small, plugins extend" goal in sec 34.
 */
const blockSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(80),
    type: z.string().min(1).max(80),
    props: z.record(z.unknown()).optional(),
    children: z.array(blockSchema).optional(),
  }),
);

const contentSchema = z.object({
  blocks: z.array(blockSchema).default([]),
});

const pageCreateBody = z.object({
  siteId: z.string().min(1),
  /// "" is allowed and means "the site root".
  slug: z.union([z.literal(""), slugSchema]),
  title: z.string().min(1).max(160),
  seoDescription: z.string().max(320).optional(),
  seoJson: z.record(z.unknown()).optional(),
  contentJson: contentSchema.optional(),
  status: z
    .enum([
      "draft",
      "in_review",
      "approved",
      "scheduled",
      "published",
      "unpublished",
      "archived",
    ])
    .optional(),
  visibility: z
    .enum([
      "private",
      "internal_only",
      "preview_only",
      "public",
      "public_after_release",
      "hidden_but_linkable",
      "archived_public",
    ])
    .optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  /// Per-locale translation overrides (sec 47). Keyed by IETF locale tag.
  /// Each value can override title / seoDescription / publishedJson; missing
  /// keys fall back to the base fields at render time.
  translationsJson: z
    .record(
      z.object({
        title: z.string().max(160).optional(),
        seoDescription: z.string().max(320).optional(),
        publishedJson: contentSchema.optional(),
      }),
    )
    .optional(),
});

const pagePatchBody = pageCreateBody.omit({ siteId: true }).partial();

const publishBody = z.object({
  note: z.string().max(400).optional(),
  /// When omitted we publish immediately. When present and in the
  /// future, we only set status=scheduled + scheduledAt — a separate
  /// worker will fire the actual publish later.
  scheduledAt: z.string().datetime().nullable().optional(),
});

// ---------- navigation -----------------------------------------------------

const navItemSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(120),
    /// page = link to a CmsPage by slug; url = external; gallery =
    /// canonical /cards index; section = collapsible header.
    kind: z.enum(["page", "url", "gallery", "section"]),
    target: z.string().max(2000).optional(),
    slug: z.string().max(120).optional(),
    children: z.array(navItemSchema).optional(),
  }),
);

const navItemsSchema = z.object({
  items: z.array(navItemSchema).default([]),
});

const navCreateBody = z.object({
  siteId: z.string().min(1),
  placement: z.enum(["header", "footer", "mobile", "sidebar", "rules", "lore", "members", "custom"]),
  name: z.string().min(1).max(120),
  itemsJson: navItemsSchema.optional(),
});

const navPatchBody = navCreateBody.omit({ siteId: true }).partial();

// ---------------------------------------------------------------------------

export default async function cmsRoutes(fastify: FastifyInstance) {
  // -------- Sites --------------------------------------------------------

  fastify.get("/api/v1/cms/sites", async (request) => {
    const { tenantId } = requireTenant(request);
    const projectId = (request.query as Record<string, string>)?.projectId;
    const sites = await fastify.prisma.cmsSite.findMany({
      where: {
        tenantId,
        ...(projectId === "null" ? { projectId: null } : projectId ? { projectId } : {}),
      },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    });
    return { sites };
  });

  fastify.post("/api/v1/cms/sites", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = siteCreateBody.parse(request.body);

    if (body.projectId) {
      const project = await fastify.prisma.project.findFirst({
        where: { id: body.projectId, tenantId },
        select: { id: true },
      });
      if (!project) return reply.code(404).send({ error: "project_not_found" });
    }

    const site = await fastify.prisma.cmsSite.create({
      data: {
        tenantId,
        projectId: body.projectId ?? null,
        kind: body.kind ?? "studio",
        name: body.name,
        slug: body.slug,
        description: body.description ?? "",
        themeJson: (body.themeJson ?? {}) as Prisma.InputJsonValue,
        settingsJson: (body.settingsJson ?? {}) as Prisma.InputJsonValue,
        status: body.status ?? "draft",
      },
    });
    return reply.code(201).send({ site });
  });

  fastify.get("/api/v1/cms/sites/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const site = await fastify.prisma.cmsSite.findFirst({
      where: { id, tenantId },
      include: {
        pages: {
          select: {
            id: true,
            slug: true,
            title: true,
            status: true,
            visibility: true,
            updatedAt: true,
            publishedAt: true,
          },
          orderBy: { updatedAt: "desc" },
        },
        navigations: true,
      },
    });
    if (!site) return reply.code(404).send({ error: "not_found" });
    return { site };
  });

  fastify.patch("/api/v1/cms/sites/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = sitePatchBody.parse(request.body);

    const data: Prisma.CmsSiteUpdateInput = {};
    if (body.kind !== undefined) data.kind = body.kind;
    if (body.name !== undefined) data.name = body.name;
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.description !== undefined) data.description = body.description;
    if (body.themeJson !== undefined) {
      data.themeJson = body.themeJson as Prisma.InputJsonValue;
    }
    if (body.settingsJson !== undefined) {
      data.settingsJson = body.settingsJson as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;

    const result = await fastify.prisma.cmsSite.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const site = await fastify.prisma.cmsSite.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { site };
  });

  fastify.delete("/api/v1/cms/sites/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cmsSite.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -------- Seed defaults ------------------------------------------------
  //
  // Tenants created before the auto-seed migration (or whose seed
  // failed) can backfill the home + login + members CMS pages on
  // demand. Idempotent — re-running just no-ops if everything is
  // already in place. Returns which pages were created.
  fastify.post("/api/v1/cms/seed-defaults", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const tenant = await fastify.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, brandingJson: true },
    });
    const branding = (tenant?.brandingJson ?? {}) as {
      productName?: string;
      tagline?: string;
    };
    const { ensureDefaultCmsContent } = await import("@/lib/cmsDefaults");
    const result = await ensureDefaultCmsContent(fastify.prisma, tenantId, {
      siteName: tenant?.name,
      productName: branding.productName ?? tenant?.name,
      tagline: branding.tagline,
    });
    return reply.send({ result });
  });

  // -------- Pages --------------------------------------------------------

  fastify.get("/api/v1/cms/pages", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const siteId = (request.query as Record<string, string>)?.siteId;
    if (!siteId) {
      return reply.code(400).send({ error: "siteId_required" });
    }
    const pages = await fastify.prisma.cmsPage.findMany({
      where: { tenantId, siteId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        siteId: true,
        slug: true,
        title: true,
        seoDescription: true,
        status: true,
        visibility: true,
        scheduledAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { pages };
  });

  fastify.post("/api/v1/cms/pages", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = pageCreateBody.parse(request.body);

    const site = await fastify.prisma.cmsSite.findFirst({
      where: { id: body.siteId, tenantId },
      select: { id: true },
    });
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const page = await fastify.prisma.cmsPage.create({
      data: {
        tenantId,
        siteId: site.id,
        slug: body.slug,
        title: body.title,
        seoDescription: body.seoDescription ?? "",
        seoJson: (body.seoJson ?? {}) as Prisma.InputJsonValue,
        contentJson:
          (body.contentJson ?? { blocks: [] }) as unknown as Prisma.InputJsonValue,
        publishedJson: { blocks: [] } as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
        visibility: body.visibility ?? "public",
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
      },
    });
    return reply.code(201).send({ page });
  });

  fastify.get("/api/v1/cms/pages/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const page = await fastify.prisma.cmsPage.findFirst({
      where: { id, tenantId },
    });
    if (!page) return reply.code(404).send({ error: "not_found" });
    return { page };
  });

  fastify.patch("/api/v1/cms/pages/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = pagePatchBody.parse(request.body);

    const data: Prisma.CmsPageUpdateInput = {};
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.title !== undefined) data.title = body.title;
    if (body.seoDescription !== undefined) data.seoDescription = body.seoDescription;
    if (body.seoJson !== undefined) {
      data.seoJson = body.seoJson as Prisma.InputJsonValue;
    }
    if (body.contentJson !== undefined) {
      data.contentJson = body.contentJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.visibility !== undefined) data.visibility = body.visibility;
    if (body.scheduledAt !== undefined) {
      data.scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    }
    if (body.translationsJson !== undefined) {
      data.translationsJson =
        body.translationsJson as unknown as Prisma.InputJsonValue;
    }

    const result = await fastify.prisma.cmsPage.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const page = await fastify.prisma.cmsPage.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { page };
  });

  fastify.delete("/api/v1/cms/pages/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cmsPage.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /**
   * Publish (or schedule) a page. Snapshots `contentJson` into
   * `publishedJson` and writes a version row. With `scheduledAt`
   * in the future we leave publishedJson alone and just flip status
   * to "scheduled" — a worker will sweep this later (not built yet).
   */
  fastify.post("/api/v1/cms/pages/:id/publish", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = publishBody.parse(request.body ?? {});
    const user = requireUser(request);

    const page = await fastify.prisma.cmsPage.findFirst({
      where: { id, tenantId },
    });
    if (!page) return reply.code(404).send({ error: "not_found" });

    const now = new Date();
    const sched = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const isScheduled = sched && sched > now;

    const result = await fastify.prisma.$transaction(async (tx) => {
      const lastVersion = await tx.cmsPageVersion.findFirst({
        where: { pageId: page.id },
        orderBy: { versionNum: "desc" },
        select: { versionNum: true },
      });
      const nextVersion = (lastVersion?.versionNum ?? 0) + 1;

      const version = await tx.cmsPageVersion.create({
        data: {
          tenantId,
          pageId: page.id,
          versionNum: nextVersion,
          title: page.title,
          slug: page.slug,
          status: isScheduled ? "scheduled" : "published",
          contentJson: page.contentJson as Prisma.InputJsonValue,
          note: body.note ?? "",
          createdBy: user.id,
        },
      });

      const updated = await tx.cmsPage.update({
        where: { id: page.id },
        data: isScheduled
          ? { status: "scheduled", scheduledAt: sched }
          : {
              status: "published",
              publishedJson: page.contentJson as Prisma.InputJsonValue,
              publishedAt: now,
              scheduledAt: null,
            },
      });

      return { page: updated, version };
    });

    // Audit + webhook fan-out — non-blocking, fire-and-forget.
    await writeAudit(fastify.prisma, request, {
      tenantId,
      action: isScheduled ? "cms.page.schedule" : "cms.page.publish",
      actorUserId: user.id,
      entityType: "cms_page",
      entityId: page.id,
      metadata: { slug: page.slug, version: result.version.versionNum },
    });
    void dispatchWebhook(fastify.prisma, request.log, {
      tenantId,
      event: isScheduled ? "cms.page.schedule" : "cms.page.publish",
      data: {
        pageId: page.id,
        slug: page.slug,
        title: page.title,
        version: result.version.versionNum,
        scheduledAt: isScheduled ? sched?.toISOString() ?? null : null,
      },
    });
    emit({
      channel: channels.cmsSite(tenantId, page.siteId),
      kind: isScheduled ? "cms.page.schedule" : "cms.page.publish",
      payload: {
        pageId: page.id,
        slug: page.slug,
        title: page.title,
        version: result.version.versionNum,
        scheduledAt: isScheduled ? sched?.toISOString() ?? null : null,
      },
    });

    // Scheduled publishes: queue a background job that fires at the
    // scheduled time and flips the page to "published". The job
    // handler `cms.publish.scheduled` lives in lib/jobHandlers.ts.
    if (isScheduled && sched) {
      await enqueueJob(fastify.prisma, {
        tenantId,
        type: "cms.publish.scheduled",
        payload: { pageId: page.id },
        runAt: sched,
        createdBy: user.id,
      });
    }

    return reply.send(result);
  });

  /** Pull a page out of public view. Keeps `publishedJson` so a quick
   * re-publish doesn't require re-saving the snapshot. */
  fastify.post("/api/v1/cms/pages/:id/unpublish", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cmsPage.updateMany({
      where: { id, tenantId },
      data: { status: "unpublished" },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const page = await fastify.prisma.cmsPage.findFirstOrThrow({
      where: { id, tenantId },
    });
    return reply.send({ page });
  });

  fastify.get("/api/v1/cms/pages/:id/versions", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const page = await fastify.prisma.cmsPage.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!page) return reply.code(404).send({ error: "not_found" });
    const versions = await fastify.prisma.cmsPageVersion.findMany({
      where: { pageId: page.id },
      orderBy: { versionNum: "desc" },
      select: {
        id: true,
        versionNum: true,
        title: true,
        slug: true,
        status: true,
        note: true,
        createdBy: true,
        createdAt: true,
      },
    });
    return { versions };
  });

  /** Restore a prior version into the page's `contentJson` (does NOT
   * publish — caller can decide). */
  fastify.post("/api/v1/cms/pages/:id/versions/:versionId/restore", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const params = z
      .object({ id: z.string().min(1), versionId: z.string().min(1) })
      .parse(request.params);

    const page = await fastify.prisma.cmsPage.findFirst({
      where: { id: params.id, tenantId },
    });
    if (!page) return reply.code(404).send({ error: "page_not_found" });

    const version = await fastify.prisma.cmsPageVersion.findFirst({
      where: { id: params.versionId, pageId: page.id, tenantId },
    });
    if (!version) return reply.code(404).send({ error: "version_not_found" });

    const updated = await fastify.prisma.cmsPage.update({
      where: { id: page.id },
      data: {
        contentJson: version.contentJson as Prisma.InputJsonValue,
        title: version.title,
        slug: version.slug,
        status: "draft",
      },
    });
    return reply.send({ page: updated });
  });

  // -------- Navigation ---------------------------------------------------

  fastify.get("/api/v1/cms/navigations", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const siteId = (request.query as Record<string, string>)?.siteId;
    if (!siteId) return reply.code(400).send({ error: "siteId_required" });
    const navigations = await fastify.prisma.cmsNavigation.findMany({
      where: { tenantId, siteId },
      orderBy: { placement: "asc" },
    });
    return { navigations };
  });

  fastify.post("/api/v1/cms/navigations", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = navCreateBody.parse(request.body);

    const site = await fastify.prisma.cmsSite.findFirst({
      where: { id: body.siteId, tenantId },
      select: { id: true },
    });
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const nav = await fastify.prisma.cmsNavigation.create({
      data: {
        tenantId,
        siteId: site.id,
        placement: body.placement,
        name: body.name,
        itemsJson:
          (body.itemsJson ?? { items: [] }) as unknown as Prisma.InputJsonValue,
      },
    });
    return reply.code(201).send({ navigation: nav });
  });

  fastify.patch("/api/v1/cms/navigations/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = navPatchBody.parse(request.body);

    const data: Prisma.CmsNavigationUpdateInput = {};
    if (body.placement !== undefined) data.placement = body.placement;
    if (body.name !== undefined) data.name = body.name;
    if (body.itemsJson !== undefined) {
      data.itemsJson = body.itemsJson as unknown as Prisma.InputJsonValue;
    }

    const result = await fastify.prisma.cmsNavigation.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const navigation = await fastify.prisma.cmsNavigation.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { navigation };
  });

  fastify.delete("/api/v1/cms/navigations/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cmsNavigation.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  // -------- Forms (sec 14.15) -------------------------------------------

  await registerFormRoutes(fastify);
}

// ===========================================================================
// Forms
// ===========================================================================

const formFieldKindSchema = z.enum([
  "text",
  "longtext",
  "email",
  "number",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "phone",
  "date",
]);

const formFieldSchema = z.object({
  id: z.string().min(1).max(80),
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9_]*$/, "must be snake_case starting with a letter"),
  label: z.string().min(1).max(160),
  kind: formFieldKindSchema,
  required: z.boolean().optional(),
  placeholder: z.string().max(160).optional(),
  helpText: z.string().max(400).optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional(),
  /// Plain-string regex pattern, validated client-side. Server uses
  /// kind-based validation; this is a hint for the renderer only.
  pattern: z.string().max(200).optional(),
  /// Min/max for number kind.
  min: z.number().optional(),
  max: z.number().optional(),
});

const formFieldsSchema = z.object({
  fields: z.array(formFieldSchema).default([]),
});

const formSettingsSchema = z
  .object({
    emailRecipients: z.array(z.string().email()).optional(),
    webhookUrl: z.string().url().optional(),
    successMessage: z.string().max(400).optional(),
    rateLimitPerHour: z.number().int().min(1).max(10000).optional(),
    requireConsent: z.boolean().optional(),
    consentLabel: z.string().max(400).optional(),
  })
  .partial();

const formCreateBody = z.object({
  siteId: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  fieldsJson: formFieldsSchema.optional(),
  settingsJson: formSettingsSchema.optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
});

const formPatchBody = formCreateBody.omit({ siteId: true }).partial();

async function registerFormRoutes(fastify: import("fastify").FastifyInstance) {
  fastify.get("/api/v1/cms/forms", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const siteId = (request.query as Record<string, string>)?.siteId;
    if (!siteId) return reply.code(400).send({ error: "siteId_required" });
    const forms = await fastify.prisma.cmsForm.findMany({
      where: { tenantId, siteId },
      orderBy: { name: "asc" },
      include: { _count: { select: { submissions: true } } },
    });
    return {
      forms: forms.map((f) => ({
        id: f.id,
        tenantId: f.tenantId,
        siteId: f.siteId,
        slug: f.slug,
        name: f.name,
        description: f.description,
        fieldsJson: f.fieldsJson,
        settingsJson: f.settingsJson,
        status: f.status,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        submissionCount: f._count.submissions,
      })),
    };
  });

  fastify.post("/api/v1/cms/forms", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = formCreateBody.parse(request.body);

    const site = await fastify.prisma.cmsSite.findFirst({
      where: { id: body.siteId, tenantId },
      select: { id: true },
    });
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const form = await fastify.prisma.cmsForm.create({
      data: {
        tenantId,
        siteId: site.id,
        slug: body.slug,
        name: body.name,
        description: body.description ?? "",
        fieldsJson:
          (body.fieldsJson ?? { fields: [] }) as unknown as Prisma.InputJsonValue,
        settingsJson:
          (body.settingsJson ?? {}) as unknown as Prisma.InputJsonValue,
        status: body.status ?? "draft",
      },
    });
    return reply.code(201).send({ form });
  });

  fastify.get("/api/v1/cms/forms/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const form = await fastify.prisma.cmsForm.findFirst({
      where: { id, tenantId },
    });
    if (!form) return reply.code(404).send({ error: "not_found" });
    return { form };
  });

  fastify.patch("/api/v1/cms/forms/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = formPatchBody.parse(request.body);

    const data: Prisma.CmsFormUpdateInput = {};
    if (body.slug !== undefined) data.slug = body.slug;
    if (body.name !== undefined) data.name = body.name;
    if (body.description !== undefined) data.description = body.description;
    if (body.fieldsJson !== undefined) {
      data.fieldsJson = body.fieldsJson as unknown as Prisma.InputJsonValue;
    }
    if (body.settingsJson !== undefined) {
      data.settingsJson = body.settingsJson as unknown as Prisma.InputJsonValue;
    }
    if (body.status !== undefined) data.status = body.status;

    const result = await fastify.prisma.cmsForm.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    const form = await fastify.prisma.cmsForm.findFirstOrThrow({
      where: { id, tenantId },
    });
    return { form };
  });

  fastify.delete("/api/v1/cms/forms/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.cmsForm.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });

  /**
   * List submissions for a form. Newest first. Pagination is keyset by
   * `before` (ISO date) — cheap and lets the caller scroll without
   * page numbers.
   */
  fastify.get(
    "/api/v1/cms/forms/:id/submissions",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { id } = idParam.parse(request.params);
      const q = request.query as Record<string, string>;
      const before = q.before ? new Date(q.before) : undefined;
      const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);

      const form = await fastify.prisma.cmsForm.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!form) return reply.code(404).send({ error: "not_found" });

      const submissions = await fastify.prisma.cmsFormSubmission.findMany({
        where: {
          tenantId,
          formId: form.id,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return { submissions };
    },
  );

  /**
   * CSV export of every submission for a form. Rows are keyed by the
   * form's *current* field list — fields removed since capture won't
   * appear; fields added since capture will appear empty for older rows.
   */
  fastify.get(
    "/api/v1/cms/forms/:id/submissions.csv",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { id } = idParam.parse(request.params);

      const form = await fastify.prisma.cmsForm.findFirst({
        where: { id, tenantId },
      });
      if (!form) return reply.code(404).send({ error: "not_found" });

      const submissions = await fastify.prisma.cmsFormSubmission.findMany({
        where: { tenantId, formId: form.id },
        orderBy: { createdAt: "desc" },
      });

      const fieldsParsed = formFieldsSchema.safeParse(form.fieldsJson);
      const fields = fieldsParsed.success ? fieldsParsed.data.fields : [];
      const headers = ["submitted_at", "ip", ...fields.map((f) => f.name)];

      const rows = submissions.map((s) => {
        const payload = (s.payloadJson ?? {}) as Record<string, unknown>;
        return [
          s.createdAt.toISOString(),
          s.ip ?? "",
          ...fields.map((f) => csvCell(payload[f.name])),
        ];
      });

      const csv =
        [headers, ...rows]
          .map((r) => r.map(csvCell).join(","))
          .join("\n") + "\n";

      reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${form.slug}-submissions.csv"`,
        );
      return reply.send(csv);
    },
  );

  fastify.delete(
    "/api/v1/cms/submissions/:id",
    async (request, reply) => {
      const { tenantId } = requireTenant(request);
      const { id } = idParam.parse(request.params);
      const result = await fastify.prisma.cmsFormSubmission.deleteMany({
        where: { id, tenantId },
      });
      if (result.count === 0)
        return reply.code(404).send({ error: "not_found" });
      return reply.code(204).send();
    },
  );
}

/**
 * Quote a value for inclusion in a CSV cell. Wraps in quotes when the
 * value contains commas, quotes, or newlines, doubling embedded quotes
 * per RFC 4180. Numbers and booleans are stringified verbatim.
 */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s: string;
  if (typeof v === "string") s = v;
  else if (Array.isArray(v)) s = v.map((x) => String(x)).join(";");
  else s = JSON.stringify(v);
  if (/[,"\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
