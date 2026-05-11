/**
 * CMS scaffolding helper.
 *
 * Every tenant ships with a public site out of the box (sec 14):
 *
 *   • A `studio` CmsSite on the tenant's slug.
 *   • A `home` page — the public landing.
 *   • A `__login` page — the white-labeled login screen hero used
 *     when the tenant has the members area enabled.
 *   • A `__members` page — the post-login welcome banner.
 *
 * `ensureDefaultCmsContent` is idempotent: it inspects what already
 * exists and only creates what's missing. Called from the tenant
 * create route AND exposed at `POST /api/v1/cms/seed-defaults` so an
 * already-existing tenant can backfill if they were created before
 * this hook landed.
 *
 * The default content is intentionally light — a hero, a paragraph,
 * a CTA. Tenants will replace the copy through the page builder.
 * The point is "your public site is on, here's a starting page" not
 * "we picked your marketing voice."
 */

import type { PrismaClient, Prisma } from "@prisma/client";

interface SeedResult {
  siteId: string;
  created: { home: boolean; login: boolean; members: boolean };
}

interface SeedOptions {
  siteName?: string;
  /** Optional branding info captured from the registration wizard.
   *  When present, baked into the seeded landing-page hero so the
   *  user's first public page actually reflects their brand instead
   *  of a generic "Welcome." placeholder. */
  productName?: string;
  tagline?: string;
  /** When set, the seeded site is project-scoped (kind = "game") and
   *  attached to this project. Used by the project-create flow so each
   *  game ships with its own public site + landing + login. Without
   *  it, we fall back to the tenant-level studio site. */
  projectId?: string;
  /** Project slug — used as the site slug when seeding a project site
   *  (so it can live at `<project>-<tenant>.<root>` cleanly). */
  projectSlug?: string;
}

export async function ensureDefaultCmsContent(
  prisma: PrismaClient,
  tenantId: string,
  options: SeedOptions = {},
): Promise<SeedResult> {
  // Project-scoped seeding takes a different shape than tenant-scoped
  // — we create a "game" site rather than the tenant's "studio" site,
  // and use the project's slug so the URL path is unique within the
  // tenant. Falls through to the tenant flow when projectId is unset.
  const isProjectScope = Boolean(options.projectId && options.projectSlug);
  const siteKind = isProjectScope ? "game" : "studio";

  // Re-use the matching site if one already exists; otherwise
  // create one. The composite uniqueness on (tenantId, slug) means
  // we have to pick a slug that won't collide with the tenant's
  // studio site — for project sites we use the project slug.
  let site = await prisma.cmsSite.findFirst({
    where: isProjectScope
      ? { tenantId, projectId: options.projectId, kind: siteKind }
      : { tenantId, kind: siteKind, projectId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true },
  });
  if (!site) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, name: true },
    });
    site = await prisma.cmsSite.create({
      data: {
        tenantId,
        ...(isProjectScope ? { projectId: options.projectId } : {}),
        kind: siteKind,
        name:
          options.siteName ??
          (isProjectScope ? "Game site" : tenant?.name ?? "Studio site"),
        slug: isProjectScope
          ? `${options.projectSlug}-site`
          : tenant?.slug ?? "studio",
        description: isProjectScope
          ? "Public site for this game."
          : "Public site for this workspace.",
        status: "published",
      },
      select: { id: true, slug: true },
    });
  }

  const result: SeedResult = {
    siteId: site.id,
    created: { home: false, login: false, members: false },
  };

  // Look up which slugs already exist so the helper stays idempotent.
  const existing = await prisma.cmsPage.findMany({
    where: {
      tenantId,
      siteId: site.id,
      slug: { in: ["home", "__login", "__members"] },
    },
    select: { slug: true },
  });
  const have = new Set(existing.map((p) => p.slug));

  // Build the hero content using the wizard inputs when available so
  // the very first thing the user sees on their public site is their
  // own brand, not a "Welcome." placeholder.
  const homeContent = buildHomeContent({
    productName: options.productName ?? options.siteName,
    tagline: options.tagline,
  });
  const loginContent = buildLoginContent({
    productName: options.productName ?? options.siteName,
  });

  if (!have.has("home")) {
    await prisma.cmsPage.create({
      data: {
        tenantId,
        siteId: site.id,
        slug: "home",
        title: options.productName ? `Welcome to ${options.productName}` : "Welcome",
        seoDescription:
          options.tagline ??
          "The public home page for this workspace. Edit through the CMS.",
        contentJson: homeContent as unknown as Prisma.InputJsonValue,
        publishedJson: homeContent as unknown as Prisma.InputJsonValue,
        status: "published",
        visibility: "public",
        publishedAt: new Date(),
      },
    });
    result.created.home = true;
  }
  if (!have.has("__login")) {
    await prisma.cmsPage.create({
      data: {
        tenantId,
        siteId: site.id,
        slug: "__login",
        title: "Sign in",
        seoDescription:
          "Hero panel rendered alongside the members login form.",
        contentJson: loginContent as unknown as Prisma.InputJsonValue,
        publishedJson: loginContent as unknown as Prisma.InputJsonValue,
        status: "published",
        visibility: "hidden",
        publishedAt: new Date(),
      },
    });
    result.created.login = true;
  }
  if (!have.has("__members")) {
    await prisma.cmsPage.create({
      data: {
        tenantId,
        siteId: site.id,
        slug: "__members",
        title: "Members area",
        seoDescription: "Welcome banner shown on the members landing.",
        contentJson: MEMBERS_CONTENT as unknown as Prisma.InputJsonValue,
        publishedJson: MEMBERS_CONTENT as unknown as Prisma.InputJsonValue,
        status: "published",
        visibility: "hidden",
        publishedAt: new Date(),
      },
    });
    result.created.members = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Default block content — native BlockCMS schema.
//
// The page builder (apps/designer/src/components/cms/BlockCMS.tsx) consumes
// `CmsData` with a flat `{ id, type, content, children?, metadata? }` tree.
// Earlier seeds emitted a legacy `{ type: "hero", props: { ... } }` shape
// from a different prototype — the in-app migrator can't always translate
// those (e.g. "hero" has no native counterpart) and replaces them with the
// "Legacy block couldn't be migrated automatically" placeholder.
//
// To avoid that, the factory functions below emit the native shape directly,
// using only types the builder + renderer support natively: heading,
// paragraph, features, button, divider, image, etc.
// ---------------------------------------------------------------------------

/**
 * Container shape persisted on `CmsPage.contentJson`. Matches `CmsData` from
 * `apps/designer/src/components/cms/cms-types.ts` — see that file for the
 * authoritative type definitions. Re-stated here so the API doesn't import
 * frontend modules.
 */
interface CmsBlock {
  id: string;
  type: string;
  content: string;
  children?: CmsBlock[];
  metadata?: Record<string, unknown>;
}
interface CmsData {
  blocks: CmsBlock[];
  globalHtml: string;
  globalCss: string;
  globalJs: string;
}

function wrap(blocks: CmsBlock[]): CmsData {
  return { blocks, globalHtml: "", globalCss: "", globalJs: "" };
}

function buildHomeContent(input: { productName?: string; tagline?: string }): CmsData {
  const name = (input.productName?.trim() || "TCGStudio");
  // ── Hero ────────────────────────────────────────────────────────────
  const hero: CmsBlock[] = [
    {
      id: "home-eyebrow",
      type: "paragraph",
      content: "Build the game · Publish the world · Own the brand",
      metadata: { textColor: "var(--accent-500)", customClass: "eyebrow" },
    },
    {
      id: "home-h1",
      type: "heading",
      content: "The studio-in-a-box for designing custom trading card games.",
    },
    {
      id: "home-lede",
      type: "paragraph",
      content:
        `Design the cards. Build the rules. Publish the public site. Export the product. ${name} is a multi-tenant, white-label creation suite for card-game studios — from a solo creator with a notebook to a publisher running multiple franchises.`,
    },
    {
      id: "home-cta-primary",
      type: "button",
      content: "Create your studio →|primary|/signup",
    },
  ];

  // ── "Who it's for" — 4-column value props ──────────────────────────
  // BLOCK_CONFIGS only ships 2- and 3-column presets, but the renderer
  // lays out whatever children we hand it. We use `columns` with 4
  // `column` children to mirror the original 4-up grid.
  const audiences: Array<{ icon: string; title: string; body: string }> = [
    {
      icon: "🃏",
      title: "For solo creators",
      body: "Drag, drop, design. Card type templates with variants, schemas, and live preview — no code required.",
    },
    {
      icon: "🎨",
      title: "For studios",
      body: "Team roles, approval workflow, asset library, print-ready exports, branded public site, full revision history.",
    },
    {
      icon: "📦",
      title: "For publishers",
      body: "Multi-project management, multiple brands, custom domains, white-label dashboards, dedicated marketplaces.",
    },
    {
      icon: "⚙️",
      title: "For developers",
      body: "Plugin SDK, REST + GraphQL APIs, webhooks, JSON / CSV / XLSX import-export. Extend anything; rewrite nothing.",
    },
  ];
  const whoItsFor: CmsBlock[] = [
    {
      id: "whos-eyebrow",
      type: "paragraph",
      content: "Who it's for",
      metadata: { textColor: "var(--accent-500)", customClass: "eyebrow" },
    },
    {
      id: "whos-heading",
      type: "heading",
      content: "One platform, every kind of card-game maker.",
    },
    {
      id: "whos-columns",
      type: "columns",
      // `columns` content stores the column count (string). 4-wide on
      // desktop, the renderer collapses on narrower viewports.
      content: "4",
      metadata: { padding: "0", margin: "0", columns: 4 },
      children: audiences.map((a, i) => ({
        id: `whos-col-${i}`,
        type: "column",
        content: "",
        metadata: { padding: "4" },
        children: [
          {
            id: `whos-col-${i}-icon`,
            type: "heading",
            content: a.icon,
          },
          {
            id: `whos-col-${i}-title`,
            type: "heading",
            content: a.title,
          },
          {
            id: `whos-col-${i}-body`,
            type: "paragraph",
            content: a.body,
          },
        ],
      })),
    },
  ];

  // ── "What's inside" — 2-column pillars with bullet lists ──────────
  const pillars: Array<{ title: string; points: string[] }> = [
    {
      title: "Card design",
      points: [
        "Card-type templates with layer trees, zones, and variants",
        "Schema-based card data with validation",
        "Multi-faction frames, 9-slice panels, sprite splitter",
        "Live preview against any card",
      ],
    },
    {
      title: "Game systems",
      points: [
        "Custom phases, priority, win conditions per project",
        "Keyword glossary with reminder text",
        "Visual ability graph editor",
        "Custom board layouts and zones",
      ],
    },
    {
      title: "Publishing",
      points: [
        "Built-in CMS with drag-and-drop blocks",
        "Public card gallery with search and filters",
        "Forms (playtest signup, contact, newsletter)",
        "Custom domains with auto TLS",
      ],
    },
    {
      title: "Production",
      points: [
        "PDF print sheets with bleed + crop marks",
        "Pack generators and rarity rules",
        "Project-wide validation",
        "JSON / CSV / XLSX / Cockatrice / TTS exports",
      ],
    },
  ];
  const whatsInside: CmsBlock[] = [
    {
      id: "inside-divider",
      type: "divider",
      content: "",
    },
    {
      id: "inside-eyebrow",
      type: "paragraph",
      content: "What's inside",
      metadata: { textColor: "var(--accent-500)", customClass: "eyebrow" },
    },
    {
      id: "inside-heading",
      type: "heading",
      content: "From notebook scribble to printable product.",
    },
    {
      id: "inside-columns",
      type: "columns",
      content: "2",
      metadata: { padding: "0", margin: "0", columns: 2 },
      children: pillars.map((p, i) => ({
        id: `pillar-${i}`,
        type: "column",
        content: "",
        metadata: { padding: "4" },
        children: [
          {
            id: `pillar-${i}-title`,
            type: "heading",
            content: p.title,
          },
          {
            id: `pillar-${i}-list`,
            type: "list",
            // `list` content is newline-separated items.
            content: p.points.join("\n"),
          },
        ],
      })),
    },
  ];

  // ── Closing CTA ─────────────────────────────────────────────────────
  const closing: CmsBlock[] = [
    {
      id: "cta-divider",
      type: "divider",
      content: "",
    },
    {
      id: "cta-heading",
      type: "heading",
      content: "Pick a tenant slug. Start designing.",
    },
    {
      id: "cta-blurb",
      type: "paragraph",
      content:
        `Signing up auto-creates a workspace on its own subdomain — rename it, brand it, attach a custom domain, and invite collaborators. ${name} stays out of the way.`,
    },
    {
      id: "cta-button",
      type: "button",
      content: "Create your studio →|primary|/signup",
    },
  ];

  return wrap([...hero, ...whoItsFor, ...whatsInside, ...closing]);
}

function buildLoginContent(input: { productName?: string }): CmsData {
  const name = input.productName?.trim();
  return wrap([
    {
      id: "login-heading",
      type: "heading",
      content: name ? `Sign in to ${name}.` : "Sign in to continue.",
    },
    {
      id: "login-blurb",
      type: "paragraph",
      content:
        "Track your decks, leave feedback on cards, and join playtests. New here? Use the Create account tab.",
    },
  ]);
}

const MEMBERS_CONTENT: CmsData = wrap([
  {
    id: "members-heading",
    type: "heading",
    content: "Welcome back.",
  },
  {
    id: "members-blurb",
    type: "paragraph",
    content:
      "This is your members space. The studio publishes news, decks, and playtest signups here.",
  },
]);
