/**
 * Public read-only API (sec 15 + sec 36.5).
 *
 * Tenant-scoped, no-auth endpoints used by:
 *   • the public card gallery / rules portal (CMS-driven sites later)
 *   • third-party SDKs / integrations that need the released card pool
 *
 * Why a separate route file: these endpoints sit OUTSIDE the tenant
 * plugin's "must be authenticated" wall. Tenant context is resolved
 * from the URL path (`/api/public/:tenantSlug/...`) rather than from
 * the X-Tenant-Slug header that authenticated routes use.
 *
 * Visibility filter: by default we return only cards whose `status`
 * indicates release-ready content (released / approved). Authors who
 * want to expose drafts publicly can pass `?includeDrafts=true` —
 * useful for staging environments and white-label preview sites.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";

const tenantParam = z.object({ tenantSlug: z.string().min(1).max(80) });
const cardParam = tenantParam.extend({ cardSlug: z.string().min(1).max(120) });
const setParam = tenantParam.extend({ setCode: z.string().min(1).max(8) });

const PUBLIC_CARD_STATUSES = new Set([
  "released",
  "approved",
  // "art_complete" is sometimes used by studios as a "show preview" gate
  // before the card is officially released. Authors can override via the
  // includeDrafts param.
]);

export default async function publicRoutes(fastify: FastifyInstance) {
  /**
   * Public branding for a tenant. The login page hits this when the
   * user lands on `<tenant>.tcgstudio.local` so the page can paint
   * the tenant's product name + logo + accent color BEFORE the user
   * authenticates. White-label promise (sec 11): visiting Acme's
   * subdomain should look like Acme's product, not TCGStudio.
   *
   * Only fields safe to expose pre-auth go in the response. Internal
   * support emails and legal text are kept server-side.
   */
  fastify.get(
    "/api/public/:tenantSlug/branding",
    async (request, reply) => {
      const params = tenantParam.parse(request.params);
      const tenant = await fastify.prisma.tenant.findFirst({
        where: { slug: params.tenantSlug },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          brandingJson: true,
        },
      });
      if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

      const b = (tenant.brandingJson as Record<string, unknown> | null) ?? {};
      return {
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        productName:
          typeof b.productName === "string" && b.productName
            ? b.productName
            : tenant.name,
        logoAssetId:
          typeof b.logoAssetId === "string" ? b.logoAssetId : null,
        accentColor:
          typeof b.accentColor === "string" ? b.accentColor : null,
        hidePlatformBranding: b.hidePlatformBranding === true,
        supportEmail:
          typeof b.supportEmail === "string" ? b.supportEmail : null,
        // Tenant-side opt-in toggles. The members area is off by
        // default — surfacing it requires an explicit Settings flip.
        membersAreaEnabled: b.membersAreaEnabled === true,
      };
    },
  );

  /**
   * Public CMS navigation by placement. Lets the public-facing
   * surfaces (members area, public site) render tenant-authored
   * menus without dragging the auth-walled navigation API into
   * the bundle. We stick with placements the spec exposes (sec
   * 14.14) plus the new `members` placement that drives links
   * inside the members area.
   */
  fastify.get(
    "/api/public/:tenantSlug/cms/navigations/:placement",
    async (request, reply) => {
      const params = z
        .object({
          tenantSlug: z.string().min(1).max(80),
          placement: z.enum([
            "header",
            "footer",
            "mobile",
            "sidebar",
            "rules",
            "lore",
            "members",
            "custom",
          ]),
        })
        .parse(request.params);
      const tenant = await fastify.prisma.tenant.findFirst({
        where: { slug: params.tenantSlug },
        select: { id: true },
      });
      if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

      // Tenants may have multiple sites — we pick the first matching
      // navigation across them. A more advanced setup could add a
      // siteSlug query param to disambiguate.
      const nav = await fastify.prisma.cmsNavigation.findFirst({
        where: {
          tenantId: tenant.id,
          placement: params.placement,
          site: { tenantId: tenant.id },
        },
        select: {
          id: true,
          name: true,
          placement: true,
          itemsJson: true,
        },
      });
      if (!nav) return reply.code(404).send({ error: "not_found" });
      return { navigation: nav };
    },
  );

  /**
   * List released cards for a tenant. Filters: project, set, faction,
   * search query, optional draft inclusion.
   */
  fastify.get("/api/public/:tenantSlug/cards", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const includeDrafts = q.includeDrafts === "true";
    const projectId = q.projectId;
    const setId = q.setId;
    const search = (q.q ?? "").trim().toLowerCase();

    const cards = await fastify.prisma.card.findMany({
      where: {
        tenantId: tenant.id,
        ...(projectId ? { projectId } : {}),
        ...(setId ? { setId } : {}),
        ...(includeDrafts
          ? {}
          : { status: { in: Array.from(PUBLIC_CARD_STATUSES) } }),
      },
      orderBy: [{ collectorNumber: "asc" }, { name: "asc" }],
      take: 500,
    });

    // Apply name/slug search after the DB query — small datasets and a
    // case-insensitive substring match isn't worth a tsvector index yet.
    const filtered = search
      ? cards.filter(
          (c) =>
            c.name.toLowerCase().includes(search) ||
            c.slug.toLowerCase().includes(search),
        )
      : cards;

    return {
      tenant: { name: tenant.name, slug: tenant.slug },
      cards: filtered.map(toPublicCard),
    };
  });

  /**
   * One card by slug. Returns 404 when the card isn't released and
   * `?includeDrafts` isn't set — drafts shouldn't leak through a casual
   * URL guess.
   *
   * The response embeds the card's CardType + active Template so the
   * public gallery can render the card 1:1 via the same SVG renderer
   * the designer uses, without a second round-trip.
   */
  fastify.get("/api/public/:tenantSlug/cards/:cardSlug", async (request, reply) => {
    const params = cardParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const includeDrafts = q.includeDrafts === "true";
    const card = await fastify.prisma.card.findFirst({
      where: {
        tenantId: tenant.id,
        slug: params.cardSlug,
        ...(includeDrafts
          ? {}
          : { status: { in: Array.from(PUBLIC_CARD_STATUSES) } }),
      },
    });
    if (!card) return reply.code(404).send({ error: "not_found" });

    // Resolve the card type + active template. The template's JSON is
    // the source of truth for layout — we send it inline so the public
    // gallery doesn't need a separate fetch (and so we can later add an
    // ETag / immutable-cache header without coordinating two requests).
    const cardType = await fastify.prisma.cardType.findFirst({
      where: { id: card.cardTypeId, tenantId: tenant.id },
      select: { id: true, name: true, slug: true, schemaJson: true, activeTemplateId: true },
    });
    const template = cardType?.activeTemplateId
      ? await fastify.prisma.template.findFirst({
          where: { id: cardType.activeTemplateId, tenantId: tenant.id },
          select: { id: true, name: true, version: true, contentJson: true },
        })
      : null;

    return {
      card: toPublicCard(card),
      cardType: cardType ?? null,
      template: template ?? null,
    };
  });

  /** List sets for the tenant — a quick lookup for the gallery's filters. */
  fastify.get("/api/public/:tenantSlug/sets", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const sets = await fastify.prisma.set.findMany({
      where: {
        tenantId: tenant.id,
        // Public sets only — drafts/private sets stay hidden from the gallery.
        status: { in: ["released", "locked", "playtesting"] },
      },
      orderBy: [{ releaseDate: "desc" }, { createdAt: "desc" }],
      include: { _count: { select: { cards: true } } },
    });
    return {
      sets: sets.map(({ _count, packRulesJson: _, ...s }) => ({
        ...s,
        cardCount: _count.cards,
      })),
    };
  });

  /** Set detail — same shape as the list entry but for one set. */
  fastify.get("/api/public/:tenantSlug/sets/:setCode", async (request, reply) => {
    const params = setParam.parse(request.params);
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const set = await fastify.prisma.set.findFirst({
      where: {
        tenantId: tenant.id,
        code: params.setCode.toUpperCase(),
        status: { in: ["released", "locked", "playtesting"] },
      },
      include: { _count: { select: { cards: true } } },
    });
    if (!set) return reply.code(404).send({ error: "not_found" });
    const { _count, packRulesJson: _, ...rest } = set;
    return { set: { ...rest, cardCount: _count.cards } };
  });

  /**
   * Faction directory. Useful for a "factions" page on a CMS-driven
   * site or a dropdown in a third-party deckbuilder.
   */
  fastify.get("/api/public/:tenantSlug/factions", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const factions = await fastify.prisma.faction.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        status: "approved",
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { factions };
  });

  /**
   * Public lore listing. Filters: project, kind. Visibility-gated to
   * "public" entries only — drafts and internal-only entries stay hidden
   * even with includeDrafts (lore privacy is stricter than card status).
   */
  fastify.get("/api/public/:tenantSlug/lore", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const lore = await fastify.prisma.lore.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        visibility: { in: ["public", "public_after_release"] },
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      take: 500,
    });
    return { lore };
  });

  /**
   * Public asset blob — streams an asset's bytes without auth, scoped
   * to the tenant in the URL. Visibility-gated: only assets marked
   * `public` are served. Cards' embedded asset references (frame art,
   * card art) need to point at this endpoint when the asset itself has
   * been promoted to public.
   *
   * Why per-tenant: the same asset id namespace lives across all
   * tenants, so the URL must carry the tenant slug to scope the lookup.
   * It also lets us serve from a tenant-branded domain in the future
   * without changing client URLs.
   */
  fastify.get("/api/public/:tenantSlug/assets/:assetId/blob", async (request, reply) => {
    const params = z
      .object({ tenantSlug: z.string().min(1).max(80), assetId: z.string().min(1) })
      .parse(request.params);
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const asset = await fastify.prisma.asset.findFirst({
      where: {
        id: params.assetId,
        tenantId: tenant.id,
        visibility: "public",
      },
    });
    if (!asset) return reply.code(404).send({ error: "not_found" });

    try {
      const stream = await fastify.storage.getObject(
        asset.storageKey,
      );
      reply.header("Content-Type", asset.mimeType);
      reply.header("Cache-Control", "public, max-age=86400");
      reply.header("Content-Length", String(asset.fileSize));
      return reply.send(stream);
    } catch {
      return reply.code(404).send({ error: "blob_missing" });
    }
  });

  /**
   * Public rulesets. Surfaces the project's gameplay rulesets so a
   * future "How to play" page on the public site can render the phase
   * structure, win conditions, and player setup without requiring auth.
   * Filtered to status="active".
   */
  fastify.get("/api/public/:tenantSlug/rulesets", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const rulesets = await fastify.prisma.ruleset.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        status: "active",
      },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return { rulesets };
  });

  /**
   * Ability catalog — approved abilities only. The public site can
   * render a "Mechanics & abilities" page, and a deckbuilder can use
   * the trigger / cost / text fields for tooltips.
   */
  fastify.get("/api/public/:tenantSlug/abilities", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const abilities = await fastify.prisma.ability.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        ...(q.kind ? { kind: q.kind } : {}),
        status: "approved",
      },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return { abilities };
  });

  /** Keyword glossary. Mirrors factions — approved only. */
  fastify.get("/api/public/:tenantSlug/keywords", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
    const keywords = await fastify.prisma.keyword.findMany({
      where: {
        tenantId: tenant.id,
        ...(q.projectId ? { projectId: q.projectId } : {}),
        status: "approved",
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return { keywords };
  });

  /**
   * Platform-level landing page.
   *
   * Special-case the platform tenant (configured via PLATFORM_TENANT_SLUG)
   * so the public root host can render an editable CMS-driven landing
   * page. Platform admins sign into this tenant the same way as any
   * other tenant; the landing page is just one of its CMS pages.
   *
   * Returns 404 when the tenant doesn't exist or has no published
   * landing page yet — the frontend falls back to its bundled default
   * marketing copy in that case.
   */
  fastify.get("/api/public/platform/landing", async (request, reply) => {
    const { loadEnv } = await import("@/env");
    const env = loadEnv();
    const tenant = await fastify.prisma.tenant.findUnique({
      where: { slug: env.PLATFORM_TENANT_SLUG },
      select: { id: true, name: true, slug: true, brandingJson: true },
    });
    if (!tenant) return reply.code(404).send({ error: "no_platform_tenant" });

    // Pick the first published site for the platform tenant. We don't
    // require a specific kind so platform admins are free to label
    // their site however they like.
    const site = await fastify.prisma.cmsSite.findFirst({
      where: { tenantId: tenant.id, status: "published" },
      orderBy: { createdAt: "asc" },
    });
    if (!site) {
      return reply.code(404).send({ error: "no_published_site" });
    }

    // The home page is whichever published page has slug "home" (or "")
    // — same convention as tenant landing pages.
    const page = await fastify.prisma.cmsPage.findFirst({
      where: {
        tenantId: tenant.id,
        siteId: site.id,
        slug: { in: ["home", ""] },
        status: "published",
        visibility: { in: ["public", "public_after_release", "archived_public"] },
      },
      select: {
        id: true,
        slug: true,
        title: true,
        seoDescription: true,
        publishedJson: true,
        publishedAt: true,
      },
    });
    if (!page) {
      return reply.code(404).send({ error: "no_home_page" });
    }

    return {
      tenant: { slug: tenant.slug, name: tenant.name, brandingJson: tenant.brandingJson },
      site: {
        id: site.id,
        slug: site.slug,
        name: site.name,
        kind: site.kind,
        themeJson: site.themeJson,
      },
      page,
    };
  });

  // -------- CMS public reads (sec 14.2 + 36.5) ----------------------------
  //
  // The CMS public API mirrors the authoring API but only exposes
  // PUBLISHED content (`publishedJson`, not `contentJson`). Visibility
  // is enforced server-side: drafts, internal-only, and preview-only
  // pages return 404. Hidden-but-linkable pages resolve when fetched
  // by exact slug but are kept out of the page list.

  const PUBLIC_VISIBILITY = new Set([
    "public",
    "public_after_release",
    "archived_public",
  ]);
  const LINKABLE_VISIBILITY = new Set([
    ...PUBLIC_VISIBILITY,
    "hidden_but_linkable",
  ]);

  /**
   * Resolve the active public site for a tenant. Optional `?siteSlug`
   * disambiguates when a tenant has multiple sites (studio + game per
   * project). Without a slug, we return the first published "studio"
   * site, falling back to any published site, falling back to any site.
   */
  async function resolvePublicSite(
    tenantId: string,
    siteSlug: string | undefined,
  ) {
    if (siteSlug) {
      return fastify.prisma.cmsSite.findFirst({
        where: { tenantId, slug: siteSlug },
      });
    }
    const studio = await fastify.prisma.cmsSite.findFirst({
      where: { tenantId, kind: "studio", status: "published" },
      orderBy: { createdAt: "asc" },
    });
    if (studio) return studio;
    const anyPublished = await fastify.prisma.cmsSite.findFirst({
      where: { tenantId, status: "published" },
      orderBy: { createdAt: "asc" },
    });
    if (anyPublished) return anyPublished;
    return fastify.prisma.cmsSite.findFirst({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Site index — returns the public-visible page list for a tenant's
   * site, plus header/footer navigation menus. Used by the public site
   * shell to render its frame on every route.
   */
  fastify.get("/api/public/:tenantSlug/cms/site", async (request, reply) => {
    const params = tenantParam.parse(request.params);
    const q = request.query as Record<string, string>;
    const tenant = await fastify.prisma.tenant.findFirst({
      where: { slug: params.tenantSlug },
      select: { id: true, name: true, slug: true, brandingJson: true },
    });
    if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

    const site = await resolvePublicSite(tenant.id, q.siteSlug);
    if (!site) return reply.code(404).send({ error: "site_not_found" });

    const pages = await fastify.prisma.cmsPage.findMany({
      where: {
        tenantId: tenant.id,
        siteId: site.id,
        status: "published",
        visibility: { in: Array.from(PUBLIC_VISIBILITY) },
      },
      orderBy: [{ slug: "asc" }],
      select: {
        id: true,
        slug: true,
        title: true,
        seoDescription: true,
        publishedAt: true,
      },
    });

    const navigations = await fastify.prisma.cmsNavigation.findMany({
      where: { tenantId: tenant.id, siteId: site.id },
      orderBy: { placement: "asc" },
    });

    return {
      tenant: { name: tenant.name, slug: tenant.slug, brandingJson: tenant.brandingJson },
      site: {
        id: site.id,
        slug: site.slug,
        name: site.name,
        kind: site.kind,
        description: site.description,
        themeJson: site.themeJson,
        settingsJson: site.settingsJson,
      },
      pages,
      navigations,
    };
  });

  /**
   * Public form descriptor — used by the form renderer to draw inputs.
   * Only "active" forms are exposed; "draft" or "archived" return 404
   * to avoid leaking schemas the studio isn't ready to publish yet.
   */
  fastify.get(
    "/api/public/:tenantSlug/cms/forms/:formSlug",
    async (request, reply) => {
      const params = z
        .object({
          tenantSlug: z.string().min(1).max(80),
          formSlug: z.string().min(1).max(80),
        })
        .parse(request.params);
      const tenant = await fastify.prisma.tenant.findFirst({
        where: { slug: params.tenantSlug },
        select: { id: true },
      });
      if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
      const form = await fastify.prisma.cmsForm.findFirst({
        where: {
          tenantId: tenant.id,
          slug: params.formSlug,
          status: "active",
        },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          fieldsJson: true,
          settingsJson: true,
        },
      });
      if (!form) return reply.code(404).send({ error: "not_found" });
      // Strip server-internal settings — visitors don't need to know
      // the email recipients or webhook URL.
      const settings = (form.settingsJson ?? {}) as Record<string, unknown>;
      return {
        form: {
          ...form,
          settingsJson: {
            successMessage: settings.successMessage,
            requireConsent: settings.requireConsent,
            consentLabel: settings.consentLabel,
          },
        },
      };
    },
  );

  /**
   * Submit a form. Returns 201 + minimal echo on success. Server
   * validates required fields and basic kind constraints; we don't
   * trust the client to enforce them.
   *
   * Anti-abuse v0:
   *   • Rate-limited to settings.rateLimitPerHour per IP per form
   *     (default 30/hour)
   *   • Honeypot field "_hp" — if present, silently swallow.
   * Captcha and signed nonces come later.
   */
  fastify.post(
    "/api/public/:tenantSlug/cms/forms/:formSlug/submit",
    async (request, reply) => {
      const params = z
        .object({
          tenantSlug: z.string().min(1).max(80),
          formSlug: z.string().min(1).max(80),
        })
        .parse(request.params);
      const tenant = await fastify.prisma.tenant.findFirst({
        where: { slug: params.tenantSlug },
        select: { id: true },
      });
      if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });
      const form = await fastify.prisma.cmsForm.findFirst({
        where: {
          tenantId: tenant.id,
          slug: params.formSlug,
          status: "active",
        },
      });
      if (!form) return reply.code(404).send({ error: "not_found" });

      const rawBody = (request.body ?? {}) as Record<string, unknown>;

      // Honeypot — bots often fill every field including hidden ones.
      // We respond with the same 201 the happy path would, but never
      // persist.
      if (rawBody._hp) {
        return reply.code(201).send({ ok: true });
      }

      // Rate limit by IP within the last hour.
      const settings = (form.settingsJson ?? {}) as {
        rateLimitPerHour?: number;
      };
      const cap =
        typeof settings.rateLimitPerHour === "number" &&
        settings.rateLimitPerHour > 0
          ? settings.rateLimitPerHour
          : 30;
      const ip = request.ip;
      const recentCount = await fastify.prisma.cmsFormSubmission.count({
        where: {
          formId: form.id,
          ip,
          createdAt: { gt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recentCount >= cap) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      // Pull current field schema and validate the payload against it.
      const fields = (
        form.fieldsJson as { fields?: Array<Record<string, unknown>> }
      )?.fields ?? [];

      const payload: Record<string, unknown> = {};
      const errors: Array<{ field: string; reason: string }> = [];

      for (const f of fields) {
        const name = String(f.name ?? "");
        const kind = String(f.kind ?? "text");
        const required = Boolean(f.required);
        const value = rawBody[name];

        if (required && (value === undefined || value === "")) {
          errors.push({ field: name, reason: "required" });
          continue;
        }
        if (value === undefined || value === "") continue;

        switch (kind) {
          case "email":
            if (typeof value !== "string" || !/.+@.+\..+/.test(value)) {
              errors.push({ field: name, reason: "invalid_email" });
            } else {
              payload[name] = value.toLowerCase();
            }
            break;
          case "number":
            if (typeof value !== "number" && typeof value !== "string") {
              errors.push({ field: name, reason: "not_number" });
            } else {
              const n = Number(value);
              if (Number.isNaN(n)) {
                errors.push({ field: name, reason: "not_number" });
              } else {
                payload[name] = n;
              }
            }
            break;
          case "checkbox":
            payload[name] = Boolean(value);
            break;
          case "multiselect":
            if (!Array.isArray(value)) {
              errors.push({ field: name, reason: "not_array" });
            } else {
              payload[name] = value.map((x) => String(x)).slice(0, 50);
            }
            break;
          default:
            // text, longtext, url, phone, date, select — store as string
            payload[name] = String(value).slice(0, 5000);
            break;
        }
      }

      if (errors.length > 0) {
        return reply.code(400).send({ error: "validation_failed", errors });
      }

      const submission = await fastify.prisma.cmsFormSubmission.create({
        data: {
          tenantId: tenant.id,
          formId: form.id,
          payloadJson: payload as unknown as import("@prisma/client").Prisma.InputJsonValue,
          ip,
          userAgent: request.headers["user-agent"] ?? null,
          referrer:
            (request.headers.referer as string | undefined) ?? null,
        },
        select: { id: true, createdAt: true },
      });

      return reply.code(201).send({
        ok: true,
        submissionId: submission.id,
        successMessage:
          (form.settingsJson as { successMessage?: string })
            ?.successMessage ?? "Thanks — we got your message.",
      });
    },
  );

  /**
   * Single published page by slug. The empty slug resolves the site
   * root (home page).
   */
  fastify.get(
    "/api/public/:tenantSlug/cms/pages/:pageSlug",
    async (request, reply) => {
      const params = z
        .object({
          tenantSlug: z.string().min(1).max(80),
          pageSlug: z.string().max(120),
        })
        .parse(request.params);
      const q = request.query as Record<string, string>;
      const tenant = await fastify.prisma.tenant.findFirst({
        where: { slug: params.tenantSlug },
        select: {
          id: true,
          slug: true,
          name: true,
          brandingJson: true,
          defaultLocale: true,
          supportedLocalesJson: true,
        },
      });
      if (!tenant) return reply.code(404).send({ error: "tenant_not_found" });

      const site = await resolvePublicSite(tenant.id, q.siteSlug);
      if (!site) return reply.code(404).send({ error: "site_not_found" });

      const slug = params.pageSlug === "" ? "home" : params.pageSlug;
      const page = await fastify.prisma.cmsPage.findFirst({
        where: {
          tenantId: tenant.id,
          siteId: site.id,
          slug,
          status: "published",
          visibility: { in: Array.from(LINKABLE_VISIBILITY) },
        },
        select: {
          id: true,
          slug: true,
          title: true,
          seoDescription: true,
          seoJson: true,
          publishedJson: true,
          translationsJson: true,
          publishedAt: true,
        },
      });
      if (!page) return reply.code(404).send({ error: "not_found" });

      // Locale resolution: query string (?lang=de) > Accept-Language
      // header > tenant default. We only honour locales the tenant
      // supports — anything else falls back to the default so we
      // never serve unset content.
      const supported = (tenant.supportedLocalesJson as string[] | null) ?? [
        tenant.defaultLocale,
      ];
      const requested = (q.lang ?? "").toLowerCase().split("-")[0] || "";
      const accept =
        ((request.headers["accept-language"] as string) || "")
          .split(",")[0]
          ?.trim()
          .toLowerCase()
          .split("-")[0] ?? "";
      const supportedShort = new Set(
        supported.map((s) => s.toLowerCase().split("-")[0]),
      );
      const locale =
        (requested && supportedShort.has(requested) && requested) ||
        (accept && supportedShort.has(accept) && accept) ||
        tenant.defaultLocale;

      // Apply translation overrides for the resolved locale.
      const translations = (page.translationsJson as Record<
        string,
        Record<string, unknown>
      > | null) ?? {};
      const override =
        translations[locale] ?? translations[locale.split("-")[0]] ?? null;
      const localized = override
        ? {
            ...page,
            title: typeof override.title === "string" ? override.title : page.title,
            seoDescription:
              typeof override.seoDescription === "string"
                ? override.seoDescription
                : page.seoDescription,
            publishedJson:
              override.publishedJson != null
                ? override.publishedJson
                : page.publishedJson,
          }
        : page;

      return {
        tenant: {
          slug: tenant.slug,
          name: tenant.name,
          brandingJson: tenant.brandingJson,
          defaultLocale: tenant.defaultLocale,
          supportedLocales: supported,
        },
        site: {
          id: site.id,
          slug: site.slug,
          name: site.name,
          kind: site.kind,
          themeJson: site.themeJson,
        },
        page: localized,
        locale,
      };
    },
  );
}

/**
 * Strip cards down to the fields that are safe to expose publicly. We
 * deliberately drop tenantId, internal status workflow, validation
 * artefacts, etc. — the public API should not be a backdoor into the
 * authoring workspace.
 */
function toPublicCard(card: {
  id: string;
  slug: string;
  name: string;
  cardTypeId: string;
  projectId: string;
  setId: string | null;
  collectorNumber: number | null;
  rarity: string | null;
  dataJson: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    cardTypeId: card.cardTypeId,
    projectId: card.projectId,
    setId: card.setId,
    collectorNumber: card.collectorNumber,
    rarity: card.rarity,
    dataJson: card.dataJson,
    status: card.status,
    updatedAt: card.updatedAt,
  };
}
