/**
 * CMS view — public-site authoring surface (sec 14).
 *
 * Two-pane layout:
 *   • Left rail — list of CMS sites for the active tenant, plus a
 *     "create site" button. Studio sites surface first, then game sites.
 *   • Main pane — for the selected site: tabs for Pages, Navigation,
 *     Theme. The Pages tab is the heart of the editor and the only
 *     one wired in this v0; Navigation and Theme are stubs for the
 *     next pass.
 *
 * Page editor philosophy:
 *   We're going for a *block list*, not a freeform drag-and-drop
 *   canvas. Each page is `{ blocks: Block[] }`. A block has a `type`
 *   ("heading" | "paragraph" | "image" | "card_gallery" …) and a
 *   `props` bag. A small registry maps each type to:
 *     • a label
 *     • an `editor` component (renders form fields against props)
 *     • a `preview` component (rough WYSIWYG)
 *   Adding a new block type means registering one entry. This keeps
 *   the v0 honest about the spec's "core stays small, plugins extend"
 *   shape (sec 34) while still giving the user something useful.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  assetBlobUrl,
  CmsBlock,
  CmsContent,
  CmsForm,
  CmsFormField,
  CmsFormFieldKind,
  CmsFormSubmission,
  CmsNavItem,
  CmsNavigation,
  CmsNavPlacement,
  CmsPage,
  CmsPageSummary,
  CmsPageTranslation,
  CmsSite,
  CmsSiteKind,
  createCmsForm,
  createCmsNavigation,
  createCmsPage,
  createCmsSite,
  deleteCmsForm,
  deleteCmsFormSubmission,
  deleteCmsNavigation,
  deleteCmsPage,
  deleteCmsSite,
  downloadCmsFormSubmissionsCsv,
  getAsset,
  getCmsPage,
  getCmsSite,
  listCmsForms,
  listCmsFormSubmissions,
  listCmsPages,
  listCmsSites,
  publishCmsPage,
  unpublishCmsPage,
  updateCmsForm,
  updateCmsNavigation,
  updateCmsPage,
  updateCmsSite,
} from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import { useAssetPicker } from "@/components/AssetPicker";
import {
  SpriteCellPicker,
  type SpriteRef,
} from "@/components/SpriteCellPicker";
import { useContextMenu } from "@/components/ContextMenu";
import { useDesigner } from "@/store/designerStore";
import { BlockCMS } from "@/components/cms/BlockCMS";
import {
  EMPTY_CMS_DATA,
  type BlockCmsTheme,
  type CmsData as BlockCmsData,
} from "@/components/cms/cms-types";

// ---------------------------------------------------------------------------
// Block registry
// ---------------------------------------------------------------------------

interface BlockSpec {
  type: string;
  label: string;
  description: string;
  defaultProps: Record<string, unknown>;
  Editor: React.FC<{
    props: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
  }>;
  Preview: React.FC<{ props: Record<string, unknown> }>;
}

const BLOCK_REGISTRY: BlockSpec[] = [
  {
    type: "heading",
    label: "Heading",
    description: "Section title (H1–H4).",
    defaultProps: { text: "Heading", level: 1 },
    Editor: HeadingEditor,
    Preview: HeadingPreview,
  },
  {
    type: "paragraph",
    label: "Paragraph",
    description: "A block of body copy.",
    defaultProps: {
      text: "Tell players about this card game…",
    },
    Editor: ParagraphEditor,
    Preview: ParagraphPreview,
  },
  {
    type: "image",
    label: "Image",
    description: "Picture from a public URL.",
    defaultProps: { src: "", alt: "", caption: "" },
    Editor: ImageEditor,
    Preview: ImagePreview,
  },
  {
    type: "asset_image",
    label: "Asset image",
    description:
      "Pick an image from this tenant's asset library. Spritesheets let you pick a single cell.",
    defaultProps: { assetId: "", alt: "", caption: "", sprite: null },
    Editor: AssetImageEditor,
    Preview: AssetImagePreview,
  },
  {
    type: "card_gallery",
    label: "Card gallery",
    description:
      "Live grid of approved cards from this tenant. Filters by faction / set / search.",
    defaultProps: { factionSlug: "", setCode: "", limit: 12 },
    Editor: CardGalleryEditor,
    Preview: CardGalleryPreview,
  },
  {
    type: "button",
    label: "Button",
    description: "A call-to-action linking somewhere.",
    defaultProps: { label: "Read the rules", href: "/rules" },
    Editor: ButtonEditor,
    Preview: ButtonPreview,
  },
  {
    type: "divider",
    label: "Divider",
    description: "A horizontal rule.",
    defaultProps: {},
    Editor: () => <p className="text-xs text-ink-500">No options.</p>,
    Preview: () => <hr className="my-3 border-ink-700" />,
  },
  {
    type: "form",
    label: "Form",
    description: "Embed a form by slug. Visitors submit, you collect.",
    defaultProps: { formSlug: "" },
    Editor: FormBlockEditor,
    Preview: FormBlockPreview,
  },
  {
    type: "hero",
    label: "Hero",
    description: "Big headline + subhead + optional CTA at the top of a page.",
    defaultProps: {
      eyebrow: "",
      heading: "Welcome to your studio",
      subheading: "Tell visitors what you're building.",
      ctaLabel: "Browse cards",
      ctaHref: "/cards",
      align: "center",
    },
    Editor: HeroEditor,
    Preview: HeroPreview,
  },
  {
    type: "columns",
    label: "Columns",
    description: "Two-or-three column layout — short feature blurbs.",
    defaultProps: {
      columns: [
        { heading: "Build", body: "Design cards with a layered editor." },
        { heading: "Publish", body: "Spin up a branded site in minutes." },
        { heading: "Ship", body: "Print-ready PDF + Tabletop exports." },
      ],
    },
    Editor: ColumnsEditor,
    Preview: ColumnsPreview,
  },
  {
    type: "tabs",
    label: "Tabs",
    description: "Tabbed content — labels at the top, body below.",
    defaultProps: {
      tabs: [
        { label: "Overview", body: "What this is about." },
        { label: "Details", body: "More information." },
      ],
    },
    Editor: TabsEditor,
    Preview: TabsPreview,
  },
  {
    type: "accordion",
    label: "Accordion / FAQ",
    description: "Collapsible Q&A list. Click a row to expand.",
    defaultProps: {
      items: [
        { q: "What is TCGStudio?", a: "A studio-in-a-box for card games." },
        { q: "Is it free?", a: "There's a free creator tier." },
      ],
    },
    Editor: AccordionEditor,
    Preview: AccordionPreview,
  },
  {
    type: "video",
    label: "Video",
    description: "Embed a YouTube, Vimeo, or direct mp4 link.",
    defaultProps: { url: "", caption: "" },
    Editor: VideoEditor,
    Preview: VideoPreview,
  },
];

const blockSpec = (type: string) =>
  BLOCK_REGISTRY.find((b) => b.type === type) ?? null;

// ---------------------------------------------------------------------------
// Top-level view
// ---------------------------------------------------------------------------

export function CmsView() {
  const activeProjectId = useDesigner((s) => s.activeProjectId);
  // Host level drives WHICH site the CMS view manages. At each level
  // there's exactly one site:
  //   - platform → the platform tenant's site (the one with no
  //     projectId, owned by the platform tenant). This is what
  //     visitors see at tcgstudio.local.
  //   - tenant   → the tenant's site (no projectId).
  //   - project  → the project's site (projectId === activeProjectId).
  // We never show a list of sites to switch between — there's only one
  // for the current scope, so the rail is hidden and we just open it.
  const level = useDesigner((s) => s.hostContext?.level ?? "tenant");
  const [sites, setSites] = useState<CmsSite[] | null>(null);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load the site list once per tenant.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listCmsSites();
        if (!alive) return;
        setSites(list);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Narrow the loaded sites to the one matching the current host
  // scope. Platform + tenant levels both look for "tenant-wide"
  // (no projectId) sites; the underlying tenant is different because
  // each level uses its own X-Tenant header. Project level matches
  // the active project. We never bleed a project's site into the
  // tenant CMS view or vice versa.
  const scopedSite = useMemo<CmsSite | null>(() => {
    if (!sites || sites.length === 0) return null;
    if (level === "project") {
      return sites.find((s) => s.projectId === activeProjectId) ?? null;
    }
    // platform + tenant: a single tenant-wide site
    return sites.find((s) => !s.projectId) ?? null;
  }, [sites, level, activeProjectId]);

  // Keep the active id in sync with the scoped site. This effect runs
  // when the host switches (tenant ↔ project) so we don't get stuck
  // pointing at a site from the previous scope.
  useEffect(() => {
    if (scopedSite && scopedSite.id !== activeSiteId) {
      setActiveSiteId(scopedSite.id);
    } else if (!scopedSite && activeSiteId) {
      setActiveSiteId(null);
    }
  }, [scopedSite, activeSiteId]);

  async function refreshSites() {
    const list = await listCmsSites();
    setSites(list);
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 p-6 text-sm text-danger-400">
        {error}
      </div>
    );
  }
  if (!sites) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 p-6 text-sm text-ink-400">
        Loading public site…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden bg-ink-950">
      <div className="flex-1 overflow-hidden">
        {activeSiteId ? (
          <SiteEditor
            siteId={activeSiteId}
            onSiteChanged={refreshSites}
            onSiteDeleted={async () => {
              await refreshSites();
              setActiveSiteId(null);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            <div className="max-w-md text-center">
              <p className="mb-3 text-base text-ink-200">No public site yet.</p>
              <p className="text-ink-400">
                Create a Studio site to share your tenant publicly, or a Game
                site for a single project.
              </p>
              <p className="mt-4 text-[11px] text-ink-500">
                Want a quick start? Use Seed default pages to spin up a Studio
                site with home + login pages already in place.
              </p>
              <SeedDefaultsButton onSeeded={refreshSites} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One-click backfill of the default CMS scaffolding (studio site +
 * home + __login + __members pages). Tenants created before the
 * auto-seed migration can run this to catch up. Idempotent — calling
 * it again on a fully-seeded tenant just no-ops.
 */
function SeedDefaultsButton({ onSeeded }: { onSeeded: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const lib = await import("@/lib/api");
      await lib.request("/api/v1/cms/seed-defaults", { method: "POST" });
      setDone(true);
      await onSeeded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "seed failed");
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <p className="mt-3 text-[11px] text-emerald-300">
        ✓ Default pages created. Reloading the site list…
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-40"
      >
        {busy ? "Seeding…" : "Seed default pages"}
      </button>
      {error && <p className="text-[11px] text-danger-400">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left rail — site list + create
// ---------------------------------------------------------------------------

function SiteRail({
  sites,
  activeSiteId,
  onSelect,
  onCreated,
  defaultProjectId,
}: {
  sites: CmsSite[];
  activeSiteId: string | null;
  onSelect: (id: string) => void;
  onCreated: (s: CmsSite) => void;
  defaultProjectId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
        <h2 className="text-xs uppercase tracking-wider text-ink-400">
          Public sites
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
        >
          New
        </button>
      </header>
      <div className="flex-1 overflow-y-auto py-2">
        {sites.length === 0 && (
          <p className="px-3 py-2 text-xs text-ink-500">
            Nothing here yet. Create a site to get started.
          </p>
        )}
        <ul className="space-y-0.5">
          {sites.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={[
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm",
                  activeSiteId === s.id
                    ? "bg-accent-500/10 text-accent-200"
                    : "text-ink-200 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="flex items-center gap-2">
                  <SiteKindChip kind={s.kind} />
                  <span className="truncate">{s.name}</span>
                </span>
                <span className="truncate text-[11px] text-ink-500">/{s.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {creating && (
        <CreateSiteModal
          defaultProjectId={defaultProjectId}
          onClose={() => setCreating(false)}
          onCreated={(s) => {
            setCreating(false);
            onCreated(s);
          }}
        />
      )}
    </aside>
  );
}

function SiteKindChip({ kind }: { kind: CmsSiteKind }) {
  const palette: Record<string, string> = {
    studio: "bg-accent-500/20 text-accent-200",
    game: "bg-emerald-500/20 text-emerald-300",
    gallery: "bg-sky-500/20 text-sky-300",
    rules: "bg-amber-500/20 text-amber-300",
    lore: "bg-fuchsia-500/20 text-fuchsia-300",
    event: "bg-rose-500/20 text-rose-300",
  };
  return (
    <span
      className={[
        "rounded px-1.5 py-px text-[10px] uppercase tracking-wider",
        palette[kind] ?? "bg-ink-700 text-ink-300",
      ].join(" ")}
    >
      {kind}
    </span>
  );
}

function CreateSiteModal({
  defaultProjectId,
  onClose,
  onCreated,
}: {
  defaultProjectId: string | null;
  onClose: () => void;
  onCreated: (s: CmsSite) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [kind, setKind] = useState<CmsSiteKind>("studio");
  const [scopeToProject, setScopeToProject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Auto-derive slug from name unless user has typed in slug already.
  const [slugTouched, setSlugTouched] = useState(false);
  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60),
    );
  }, [name, slugTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !slug) return;
    setBusy(true);
    setErr(null);
    try {
      const site = await createCmsSite({
        name,
        slug,
        kind,
        projectId:
          scopeToProject && defaultProjectId ? defaultProjectId : undefined,
      });
      onCreated(site);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[420px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">
          New public site
        </h3>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Arcforge Card Foundry"
            required
            className={INPUT}
          />
        </Field>
        <Field label="URL slug">
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="arcforge"
            required
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            className={INPUT}
          />
        </Field>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as CmsSiteKind)}
            className={INPUT}
          >
            <option value="studio">Studio site (the tenant umbrella)</option>
            <option value="game">Game site (one project)</option>
            <option value="gallery">Card gallery</option>
            <option value="rules">Rules portal</option>
            <option value="lore">Lore portal</option>
            <option value="event">Event / tournament</option>
          </select>
        </Field>
        {defaultProjectId && (
          <label className="mb-3 flex items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              checked={scopeToProject}
              onChange={(e) => setScopeToProject(e.target.checked)}
            />
            Scope this site to the active project
          </label>
        )}
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name || !slug}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create site"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site editor — tabs + per-tab content
// ---------------------------------------------------------------------------

type SiteTab = "pages" | "navigation" | "forms" | "theme";

function SiteEditor({
  siteId,
  onSiteChanged,
  onSiteDeleted,
}: {
  siteId: string;
  onSiteChanged: () => Promise<void>;
  onSiteDeleted: () => Promise<void>;
}) {
  const [site, setSite] = useState<CmsSite | null>(null);
  const [pages, setPages] = useState<CmsPageSummary[]>([]);
  const [navigations, setNavigations] = useState<CmsNavigation[]>([]);
  const [tab, setTab] = useState<SiteTab>("pages");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await getCmsSite(siteId);
      if (!alive) return;
      setSite(r.site);
      setPages(r.site.pages);
      setNavigations(r.site.navigations);
      // Deliberately do NOT auto-select the first page. Entering the CMS
      // should land on the page list so the operator picks intentionally
      // — auto-jumping into the editor felt like the CMS was hiding the
      // structure from them. Click a tile to open the editor.
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, refreshKey]);

  async function refreshPages() {
    const list = await listCmsPages({ siteId });
    setPages(list);
    // Drop the active selection if the page was deleted — back to the
    // page list. Don't auto-pick another one; same rationale as above.
    if (activePageId && list.every((p) => p.id !== activePageId)) {
      setActivePageId(null);
    }
  }

  if (!site) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading…
      </div>
    );
  }

  // Fullscreen page-editor mode: when the user has clicked into a
  // page, the BlockCMS builder takes the entire viewport. We hide
  // SiteHeader, the tab bar, and the page-list aside — every pixel
  // is the editor surface. A slim toolbar at the top exposes "←
  // Pages" so the user can step back to the page list, plus the
  // current page title for context. This keeps the authoring view
  // focused without losing navigation entirely.
  const editingPage = tab === "pages" && activePageId
    ? pages.find((p) => p.id === activePageId) ?? null
    : null;

  if (editingPage) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex h-10 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-3">
          <button
            type="button"
            onClick={() => setActivePageId(null)}
            className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-xs text-ink-200 hover:bg-ink-700"
            title="Back to page list"
          >
            <span aria-hidden>←</span>
            <span>Pages</span>
          </button>
          <span className="text-[11px] uppercase tracking-wider text-ink-500">
            {site.name}
          </span>
          <span className="text-ink-700">·</span>
          <span className="truncate text-sm font-medium text-ink-100">
            {editingPage.title}
          </span>
          <span className="truncate font-mono text-[11px] text-ink-500">
            /{editingPage.slug || "(home)"}
          </span>
          <span className="ml-auto">
            <PageStatusChip status={editingPage.status} />
          </span>
        </header>
        <div className="flex-1 overflow-hidden">
          <PageEditor
            pageId={activePageId!}
            site={site}
            onChanged={refreshPages}
            onDeleted={async () => {
              await refreshPages();
              setActivePageId(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SiteHeader
        site={site}
        onChanged={async () => {
          setRefreshKey((k) => k + 1);
          await onSiteChanged();
        }}
        onDeleted={onSiteDeleted}
      />
      <nav className="flex border-b border-ink-800 bg-ink-900 px-4">
        <Tab active={tab === "pages"} onClick={() => setTab("pages")}>
          Pages ({pages.length})
        </Tab>
        <Tab active={tab === "navigation"} onClick={() => setTab("navigation")}>
          Navigation ({navigations.length})
        </Tab>
        <Tab active={tab === "forms"} onClick={() => setTab("forms")}>
          Forms
        </Tab>
        <Tab active={tab === "theme"} onClick={() => setTab("theme")}>
          Theme
        </Tab>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "pages" && (
          <PagesTab
            siteId={site.id}
            site={site}
            pages={pages}
            activePageId={activePageId}
            onSelectPage={setActivePageId}
            onPagesChanged={refreshPages}
          />
        )}
        {tab === "navigation" && (
          <NavigationTab
            siteId={site.id}
            pages={pages}
            navigations={navigations}
            onChanged={async () => {
              setRefreshKey((k) => k + 1);
            }}
          />
        )}
        {tab === "forms" && <FormsTab siteId={site.id} />}
        {tab === "theme" && <ThemeTab site={site} />}
      </div>
    </div>
  );
}

function SiteHeader({
  site,
  onChanged,
  onDeleted,
}: {
  site: CmsSite;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(site.name);
  const [description, setDescription] = useState(site.description);
  useEffect(() => {
    setName(site.name);
    setDescription(site.description);
  }, [site.id, site.name, site.description]);

  async function save() {
    await updateCmsSite(site.id, { name, description });
    setEditing(false);
    await onChanged();
  }

  async function togglePublished() {
    await updateCmsSite(site.id, {
      status: site.status === "published" ? "draft" : "published",
    });
    await onChanged();
  }

  async function destroy() {
    if (!confirm(`Delete site "${site.name}"? This cannot be undone.`)) return;
    await deleteCmsSite(site.id);
    await onDeleted();
  }

  return (
    <header className="flex items-start justify-between gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3">
      <div className="flex-1">
        {!editing ? (
          <>
            <div className="flex items-center gap-2">
              <SiteKindChip kind={site.kind} />
              <h1 className="text-lg font-medium text-ink-100">{site.name}</h1>
              <span
                className={[
                  "rounded px-1.5 py-px text-[10px] uppercase tracking-wider",
                  site.status === "published"
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-ink-700 text-ink-300",
                ].join(" ")}
              >
                {site.status}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-ink-400">
              {site.description || "No description yet."}
            </p>
          </>
        ) : (
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className={INPUT}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex gap-2">
          {!editing ? (
            <>
              <button
                type="button"
                onClick={togglePublished}
                className={[
                  "rounded border px-3 py-1 text-xs font-medium",
                  site.status === "published"
                    ? "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700"
                    : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
                ].join(" ")}
              >
                {site.status === "published" ? "Unpublish site" : "Publish site"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={destroy}
                className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={save}
                className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "border-b-2 px-3 py-2 text-xs uppercase tracking-wider transition-colors",
        active
          ? "border-accent-500 text-accent-300"
          : "border-transparent text-ink-400 hover:text-ink-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pages tab — page list + page editor
// ---------------------------------------------------------------------------

function PagesTab({
  siteId,
  site,
  pages,
  activePageId,
  onSelectPage,
  onPagesChanged,
}: {
  siteId: string;
  /** Parent site — used to thread `themeJson` into the page builder
   *  so the preview matches the live theme. */
  site: CmsSite;
  pages: CmsPageSummary[];
  activePageId: string | null;
  onSelectPage: (id: string | null) => void;
  onPagesChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-ink-400">
            Pages
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
          >
            New
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {pages.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-500">
              No pages yet — create one to get started.
            </li>
          )}
          {pages.map((p) => (
            <PageListItem
              key={p.id}
              page={p}
              active={activePageId === p.id}
              onSelect={() => onSelectPage(p.id)}
              onPagesChanged={onPagesChanged}
            />
          ))}
        </ul>
      </aside>
      <div className="flex-1 overflow-hidden">
        {activePageId ? (
          <PageEditor
            pageId={activePageId}
            site={site}
            onChanged={onPagesChanged}
            onDeleted={async () => {
              await onPagesChanged();
              onSelectPage(null);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            Select a page or create one.
          </div>
        )}
      </div>
      {creating && (
        <CreatePageModal
          siteId={siteId}
          onClose={() => setCreating(false)}
          onCreated={async (p) => {
            setCreating(false);
            await onPagesChanged();
            onSelectPage(p.id);
          }}
        />
      )}
    </div>
  );
}

/**
 * Single row in the CMS page list. Lifted into its own component so
 * each row can host its own `useContextMenu` hook (hooks can't run
 * inside a `.map` callback).
 */
function PageListItem({
  page,
  active,
  onSelect,
  onPagesChanged,
}: {
  page: CmsPageSummary;
  active: boolean;
  onSelect: () => void;
  onPagesChanged: () => Promise<void>;
}) {
  const ctx = useContextMenu(() => [
    { label: "Open", onSelect },
    {
      label: "Copy public URL",
      onSelect: () => {
        // Build the visitor-facing URL from the current host. We don't
        // know the tenant slug from here without piping it down; the
        // current host carries it, so reuse window.location.host.
        const url = `${window.location.protocol}//${window.location.host}/p/${page.slug || "home"}`;
        void navigator.clipboard.writeText(url);
      },
    },
    { separator: true },
    {
      label: page.status === "published" ? "Unpublish" : "Publish",
      onSelect: async () => {
        const lib = await import("@/lib/api");
        if (page.status === "published") {
          await lib.unpublishCmsPage(page.id);
        } else {
          await lib.publishCmsPage(page.id);
        }
        await onPagesChanged();
      },
    },
    { separator: true },
    {
      label: "Delete page",
      onSelect: async () => {
        if (!confirm(`Delete page "${page.title}"?`)) return;
        const lib = await import("@/lib/api");
        await lib.deleteCmsPage(page.id);
        await onPagesChanged();
      },
      danger: true,
    },
  ]);

  return (
    <li onContextMenu={ctx.onContextMenu}>
      <button
        type="button"
        onClick={onSelect}
        className={[
          "flex w-full flex-col px-3 py-2 text-left text-sm",
          active
            ? "bg-accent-500/10 text-accent-200"
            : "text-ink-200 hover:bg-ink-800",
        ].join(" ")}
      >
        <span className="flex items-center gap-2 truncate">
          <span className="truncate">{page.title || "(untitled)"}</span>
          <PageStatusChip status={page.status} />
        </span>
        <span className="truncate text-[11px] text-ink-500">
          /{page.slug || "(home)"}
        </span>
      </button>
      {ctx.element}
    </li>
  );
}

function PageStatusChip({ status }: { status: string }) {
  const palette: Record<string, string> = {
    draft: "bg-ink-700 text-ink-300",
    in_review: "bg-amber-500/20 text-amber-300",
    approved: "bg-sky-500/20 text-sky-300",
    scheduled: "bg-fuchsia-500/20 text-fuchsia-300",
    published: "bg-emerald-500/20 text-emerald-300",
    unpublished: "bg-ink-700 text-ink-400",
    archived: "bg-ink-700 text-ink-500",
  };
  return (
    <span
      className={[
        "rounded px-1 py-px text-[9px] uppercase tracking-wider",
        palette[status] ?? "bg-ink-700 text-ink-300",
      ].join(" ")}
    >
      {status}
    </span>
  );
}

function CreatePageModal({
  siteId,
  onClose,
  onCreated,
}: {
  siteId: string;
  onClose: () => void;
  onCreated: (p: CmsPage) => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60),
    );
  }, [title, slugTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const page = await createCmsPage({
        siteId,
        title,
        slug,
        contentJson: { blocks: [] },
      });
      onCreated(page);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[420px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">New page</h3>
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className={INPUT}
          />
        </Field>
        <Field
          label="URL slug"
          hint='Use "home" for the site root.'
        >
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            className={INPUT}
          />
        </Field>
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !title || !slug}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create page"}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Adapt whatever lives in `contentJson` into the BlockCMS native
 * shape. Two cases:
 *
 *   • New shape — `{ blocks: [{id, type, content, children?, metadata?}],
 *     globalHtml/Css/Js }`. Pass through.
 *   • Legacy shape — `{ blocks: [{id, type, props}] }`. Migrate each
 *     block into the new shape by extracting `props` into the new
 *     `content` string format BlockCMS expects.
 *
 * Detection: any `globalHtml/Css/Js` key OR a `content` field on the
 * first block means new shape. `props` on the first block means
 * legacy.
 *
 * Migration is best-effort. We try the most-likely legacy prop names
 * for each block type (text/title/body/url/src/alt/items/rows). Block
 * types BlockCMS doesn't know about turn into a paragraph stub so
 * the user can see what was there and decide how to rebuild it.
 */
function pageContentToBlockCms(content: CmsContent): BlockCmsData {
  const raw = content as unknown as Record<string, unknown>;
  const blocks = (raw.blocks as unknown[]) ?? [];

  const hasGlobals =
    typeof raw.globalHtml === "string" ||
    typeof raw.globalCss === "string" ||
    typeof raw.globalJs === "string";
  const first = (blocks[0] as unknown as Record<string, unknown>) ?? null;
  const looksNew =
    hasGlobals || (first != null && typeof first.content === "string");

  if (looksNew) {
    return {
      blocks: blocks as BlockCmsData["blocks"],
      globalHtml: typeof raw.globalHtml === "string" ? raw.globalHtml : "",
      globalCss: typeof raw.globalCss === "string" ? raw.globalCss : "",
      globalJs: typeof raw.globalJs === "string" ? raw.globalJs : "",
    };
  }

  // Legacy → new. Walk each block through the migration map.
  return {
    blocks: blocks.map(migrateLegacyBlock) as BlockCmsData["blocks"],
    globalHtml: "",
    globalCss: "",
    globalJs: "",
  };
}

/**
 * Convert one legacy `{ id, type, props, children? }` block into a
 * BlockCMS `{ id, type, content, children?, metadata? }` block.
 *
 * Per-type prop names are a best guess at the existing schema's
 * conventions. Unknown block types fall through to a paragraph that
 * tells the user the block was legacy so they can rebuild it without
 * losing context about what was on the page.
 */
function migrateLegacyBlock(raw: unknown): {
  id: string;
  type: string;
  content: string;
  children?: ReturnType<typeof migrateLegacyBlock>[];
  metadata?: Record<string, unknown>;
} {
  const b = (raw ?? {}) as Record<string, unknown>;
  const id =
    typeof b.id === "string" && b.id
      ? b.id
      : `b-${Math.random().toString(36).slice(2, 11)}`;
  const type = typeof b.type === "string" ? b.type : "paragraph";
  const props = (b.props as Record<string, unknown>) ?? {};
  const childrenRaw = Array.isArray(b.children) ? (b.children as unknown[]) : null;
  const children = childrenRaw?.map(migrateLegacyBlock);

  // Helper — try a sequence of prop names, return the first string.
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = props[k];
      if (typeof v === "string" && v.length > 0) return v;
      if (typeof v === "number") return String(v);
    }
    return "";
  };
  const pickArray = (...keys: string[]): unknown[] => {
    for (const k of keys) {
      const v = props[k];
      if (Array.isArray(v)) return v;
    }
    return [];
  };

  switch (type) {
    case "heading":
      return { id, type, content: pick("text", "title", "value") };
    case "paragraph":
      return { id, type, content: pick("text", "body", "value", "content") };
    case "image": {
      const src = pick("src", "url", "asset", "href");
      const alt = pick("alt", "altText");
      return {
        id,
        type,
        content: src,
        metadata: alt ? { altText: alt } : undefined,
      };
    }
    case "code":
      return { id, type, content: pick("code", "value", "text", "body") };
    case "list": {
      const items = pickArray("items", "values");
      const text = items.length
        ? items
            .map((it) =>
              typeof it === "string"
                ? it
                : typeof (it as Record<string, unknown>).text === "string"
                  ? ((it as Record<string, unknown>).text as string)
                  : "",
            )
            .filter(Boolean)
            .join("\n")
        : pick("text", "body");
      return { id, type, content: text };
    }
    case "quote": {
      const text = pick("text", "body", "quote");
      const author = pick("author", "attribution", "cite");
      return { id, type, content: author ? `${text}|${author}` : text };
    }
    case "video":
      return { id, type, content: pick("url", "src", "embed") };
    case "button": {
      const label = pick("label", "text");
      const style = pick("style", "variant") || "primary";
      const url = pick("url", "href", "link");
      return { id, type, content: `${label}|${style}|${url}` };
    }
    case "divider":
      return { id, type, content: "" };
    case "gallery": {
      const items = pickArray("images", "items");
      const text = items
        .map((it) =>
          typeof it === "string"
            ? it
            : typeof (it as Record<string, unknown>).src === "string"
              ? ((it as Record<string, unknown>).src as string)
              : "",
        )
        .filter(Boolean)
        .join("\n");
      return { id, type, content: text };
    }
    case "table": {
      const rows = pickArray("rows");
      const text = rows
        .map((row) =>
          Array.isArray(row)
            ? row.map((c) => String(c)).join(" | ")
            : "",
        )
        .filter(Boolean)
        .join("\n");
      return { id, type, content: text };
    }
    case "accordion": {
      const items = pickArray("items");
      const text = items
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          const q = typeof o.q === "string" ? o.q : typeof o.title === "string" ? o.title : "";
          const a =
            typeof o.a === "string"
              ? o.a
              : typeof o.body === "string"
                ? o.body
                : typeof o.answer === "string"
                  ? o.answer
                  : "";
          return q || a ? `${q}|${a}` : "";
        })
        .filter(Boolean)
        .join("\n\n");
      return { id, type, content: text };
    }
    case "features": {
      const items = pickArray("items", "features");
      const text = items
        .map((it) => {
          const o = (it ?? {}) as Record<string, unknown>;
          const title = typeof o.title === "string" ? o.title : "";
          const desc =
            typeof o.description === "string"
              ? o.description
              : typeof o.body === "string"
                ? o.body
                : "";
          return title || desc ? `${title}|${desc}` : "";
        })
        .filter(Boolean)
        .join("\n");
      return { id, type, content: text };
    }
    case "columns":
    case "column":
      // Layout containers — keep children, drop props.
      return { id, type, content: "", children };
    default:
      // Unknown legacy block — surface as a paragraph so the user knows
      // it existed and can decide how to rebuild it. Better than silently
      // losing the block.
      return {
        id,
        type: "paragraph",
        content: `[Legacy block "${type}" couldn't be migrated automatically — please rebuild this section.]`,
      };
  }
}

/**
 * Map the site's `themeJson` (stored under `ThemeTokens` by the
 * site theme editor) into the BlockCMS theme prop. We pull the
 * fields BlockCMS knows about and let it apply them as CSS
 * variables on its wrapper.
 */
function siteThemeForBlockCms(site: CmsSite): BlockCmsTheme {
  const t = (site.themeJson ?? {}) as Record<string, unknown>;
  return {
    accent: typeof t.accent === "string" ? t.accent : undefined,
    surface: typeof t.surface === "string" ? t.surface : undefined,
    text: typeof t.text === "string" ? t.text : undefined,
    headingFont: typeof t.headingFont === "string" ? t.headingFont : undefined,
    bodyFont: typeof t.bodyFont === "string" ? t.bodyFont : undefined,
    radius: typeof t.radius === "number" ? t.radius : undefined,
  };
}

function PageEditor({
  pageId,
  site,
  onChanged,
  onDeleted,
}: {
  pageId: string;
  /** Used to read `themeJson` and pipe it into BlockCMS so the
   *  preview reflects the live theme. */
  site: CmsSite;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [page, setPage] = useState<CmsPage | null>(null);
  // `content` holds whatever was on the wire. We treat it as opaque
  // JSON — the BlockCMS builder knows its own shape, and stores its
  // CmsData ({ blocks, globalHtml, globalCss, globalJs }) back into
  // contentJson on save. Legacy pages that were authored with the
  // old `{ blocks: [{ id, type, props }] }` shape will load into the
  // builder with an empty page; their old content is preserved on
  // disk until the next save overwrites it.
  const [content, setContent] = useState<CmsContent>({ blocks: [] });
  const [title, setTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [translationsOpen, setTranslationsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await getCmsPage(pageId);
      if (!alive) return;
      setPage(p);
      setContent(p.contentJson ?? { blocks: [] });
      setTitle(p.title);
      setSeoDescription(p.seoDescription);
      setDirty(false);
    })();
    return () => {
      alive = false;
    };
  }, [pageId]);

  function markDirty<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await updateCmsPage(pageId, {
        title,
        seoDescription,
        contentJson: content,
      });
      setPage(updated);
      setDirty(false);
      await onChanged();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (dirty) await save();
    setBusy(true);
    setErr(null);
    try {
      const updated = await publishCmsPage(pageId);
      setPage(updated);
      await onChanged();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    setBusy(true);
    try {
      const updated = await unpublishCmsPage(pageId);
      setPage(updated);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!confirm(`Delete page "${title}"?`)) return;
    await deleteCmsPage(pageId);
    await onDeleted();
  }

  /** Insert a new block of `type` at `index` (default: end). Used by
   *  both the palette click action and the drag-from-palette drop. */
  function insertBlock(type: string, index?: number) {
    const spec = blockSpec(type);
    if (!spec) return;
    const block: CmsBlock = {
      id: `b_${Math.random().toString(36).slice(2, 10)}`,
      type,
      props: { ...spec.defaultProps },
    };
    const blocks = [...content.blocks];
    const at = index === undefined ? blocks.length : Math.max(0, Math.min(index, blocks.length));
    blocks.splice(at, 0, block);
    setContent({ blocks });
    setDirty(true);
  }

  /** Move an existing block to `toIndex`, accounting for its current
   *  position. Used by drag-to-reorder. */
  function moveBlockTo(id: string, toIndex: number) {
    const from = content.blocks.findIndex((b) => b.id === id);
    if (from < 0) return;
    const blocks = [...content.blocks];
    const [moved] = blocks.splice(from, 1);
    // After the splice, indices >= from shifted left by one. If the
    // user dropped past the original position, decrement by one to
    // compensate.
    const adjusted = toIndex > from ? toIndex - 1 : toIndex;
    const at = Math.max(0, Math.min(adjusted, blocks.length));
    blocks.splice(at, 0, moved);
    setContent({ blocks });
    setDirty(true);
  }

  function updateBlock(id: string, props: Record<string, unknown>) {
    setContent({
      blocks: content.blocks.map((b) => (b.id === id ? { ...b, props } : b)),
    });
    setDirty(true);
  }

  function removeBlock(id: string) {
    setContent({ blocks: content.blocks.filter((b) => b.id !== id) });
    setDirty(true);
  }

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading page…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div className="flex-1 space-y-2">
          <input
            value={title}
            onChange={(e) => markDirty(setTitle)(e.target.value)}
            placeholder="Page title"
            className={[INPUT, "text-base font-medium text-ink-100"].join(" ")}
          />
          <input
            value={seoDescription}
            onChange={(e) => markDirty(setSeoDescription)(e.target.value)}
            placeholder="SEO description (shown in search results)"
            className={INPUT}
          />
          <p className="text-[11px] text-ink-500">
            URL: <span className="text-ink-300">/{page.slug || "(home)"}</span>
            {" · "}
            <PageStatusChip status={page.status} />
            {page.publishedAt && (
              <>
                {" · published "}
                {new Date(page.publishedAt).toLocaleString()}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              Save
            </button>
            {page.status === "published" ? (
              <button
                type="button"
                onClick={unpublish}
                disabled={busy}
                className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
              >
                Unpublish
              </button>
            ) : (
              <button
                type="button"
                onClick={publish}
                disabled={busy}
                className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
              >
                Publish
              </button>
            )}
            <button
              type="button"
              onClick={() => setTranslationsOpen(true)}
              disabled={busy}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
              title="Add per-language overrides for this page"
            >
              Translations…
            </button>
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20"
            >
              Delete
            </button>
          </div>
          {err && (
            <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
              {err}
            </p>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <BlockCMS
          // `key` forces a clean remount when the user switches pages —
          // BlockCMS's internal undo state resets and we don't accidentally
          // bleed the previous page's history into the new page.
          key={pageId}
          initialData={pageContentToBlockCms(content)}
          theme={siteThemeForBlockCms(site)}
          onDataChange={(next) => {
            // Stamp the BlockCMS-native shape directly into contentJson.
            // The public renderer needs to handle this shape going forward;
            // until then, published pages re-render correctly when the page
            // is republished from the new builder.
            setContent(next as unknown as CmsContent);
            setDirty(true);
          }}
        />
      </div>
      {translationsOpen && (
        <TranslationsModal
          page={page}
          onClose={() => setTranslationsOpen(false)}
          onSaved={(updated) => {
            setPage(updated);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-page translation editor (sec 47)
// ---------------------------------------------------------------------------
//
// Lets a tenant editor add per-locale overrides on top of the
// canonical page. The user picks a locale from the tenant's supported
// list (or types a custom IETF tag) and edits Title + SEO description
// for that locale. Body content overrides are also stored — when the
// user has translated a page they can opt to override the published
// block tree per-locale; for now we keep a JSON textarea as an escape
// hatch but expect most tenants will only translate metadata.
//
// The data shape matches the API: `translationsJson` is a record keyed
// by locale tag. Fields are all optional; missing fields fall back to
// the canonical page when the public renderer resolves the locale.

function TranslationsModal({
  page,
  onClose,
  onSaved,
}: {
  page: CmsPage;
  onClose: () => void;
  onSaved: (page: CmsPage) => void;
}) {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const tenant = tenants.find((t) => t.slug === activeSlug) ?? null;
  const supported = useMemo<string[]>(() => {
    const fromTenant = (tenant?.supportedLocalesJson as string[] | undefined) ?? [];
    const def = tenant?.defaultLocale ?? "en";
    const all = new Set<string>([def, ...fromTenant]);
    // Always include any locales already present on the page so the
    // user can edit them even if the tenant later trimmed support.
    for (const k of Object.keys(page.translationsJson ?? {})) all.add(k);
    return Array.from(all);
  }, [tenant, page.translationsJson]);

  const defaultLocale = tenant?.defaultLocale ?? "en";
  const editableLocales = supported.filter((l) => l !== defaultLocale);

  const [activeLocale, setActiveLocale] = useState<string>(
    editableLocales[0] ?? "",
  );
  const [translations, setTranslations] = useState<
    Record<string, CmsPageTranslation>
  >(() => ({ ...(page.translationsJson ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customLocale, setCustomLocale] = useState("");

  function patchActive(patch: Partial<CmsPageTranslation>) {
    if (!activeLocale) return;
    setTranslations((t) => ({
      ...t,
      [activeLocale]: { ...(t[activeLocale] ?? {}), ...patch },
    }));
  }

  function removeActive() {
    if (!activeLocale) return;
    if (!confirm(`Remove all overrides for ${activeLocale}?`)) return;
    setTranslations((t) => {
      const next = { ...t };
      delete next[activeLocale];
      return next;
    });
    setActiveLocale("");
  }

  function addCustom() {
    const tag = customLocale.trim();
    if (!tag) return;
    setTranslations((t) => ({
      ...t,
      [tag]: t[tag] ?? {},
    }));
    setActiveLocale(tag);
    setCustomLocale("");
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const updated = await updateCmsPage(page.id, {
        translationsJson: translations,
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const current: CmsPageTranslation = activeLocale
    ? translations[activeLocale] ?? {}
    : {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="flex h-[80vh] w-[760px] max-w-full flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-ink-100">
              Translations — {page.title || page.slug || "(untitled)"}
            </h2>
            <p className="text-[11px] text-ink-500">
              Override the canonical page per locale. Empty fields fall back to
              the default.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
          >
            Close
          </button>
        </header>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 overflow-y-auto border-r border-ink-800 bg-ink-950 p-3 text-xs">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              Locales
            </p>
            <div className="space-y-1">
              <div
                className="flex items-center justify-between rounded border border-ink-800 bg-ink-900 px-2 py-1 text-ink-400"
                title="Canonical content lives on the page itself"
              >
                <span>{defaultLocale}</span>
                <span className="text-[10px] uppercase">default</span>
              </div>
              {editableLocales.map((tag) => {
                const has = translations[tag];
                const isActive = tag === activeLocale;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveLocale(tag)}
                    className={[
                      "flex w-full items-center justify-between rounded border px-2 py-1 text-left",
                      isActive
                        ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
                        : "border-ink-800 bg-ink-900 text-ink-200 hover:bg-ink-800",
                    ].join(" ")}
                  >
                    <span>{tag}</span>
                    {has && <span className="text-[10px] text-emerald-400">●</span>}
                  </button>
                );
              })}
              {Object.keys(translations)
                .filter((t) => !supported.includes(t) && t !== defaultLocale)
                .map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveLocale(tag)}
                    className={[
                      "flex w-full items-center justify-between rounded border px-2 py-1 text-left",
                      tag === activeLocale
                        ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
                        : "border-amber-500/30 bg-ink-900 text-ink-200 hover:bg-ink-800",
                    ].join(" ")}
                    title="Locale not in tenant supported list"
                  >
                    <span>{tag}</span>
                    <span className="text-[10px] text-amber-400">!</span>
                  </button>
                ))}
            </div>
            <p className="mt-3 text-[10px] uppercase tracking-wider text-ink-500">
              Add locale
            </p>
            <div className="mt-1 flex gap-1">
              <input
                value={customLocale}
                onChange={(e) => setCustomLocale(e.target.value)}
                placeholder="e.g. pt-BR"
                className="flex-1 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-xs text-ink-100"
              />
              <button
                type="button"
                onClick={addCustom}
                disabled={!customLocale.trim()}
                className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </aside>
          <main className="flex-1 overflow-y-auto p-4 text-xs text-ink-300">
            {!activeLocale ? (
              <p className="text-ink-500">
                Pick a locale on the left to edit overrides, or add a new one.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-ink-100">
                    Overrides for {activeLocale}
                  </h3>
                  <button
                    type="button"
                    onClick={removeActive}
                    className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20"
                  >
                    Remove locale
                  </button>
                </div>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-ink-500">
                    Title
                  </span>
                  <input
                    value={current.title ?? ""}
                    onChange={(e) =>
                      patchActive({ title: e.target.value || undefined })
                    }
                    placeholder={page.title}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] uppercase tracking-wider text-ink-500">
                    SEO description
                  </span>
                  <textarea
                    value={current.seoDescription ?? ""}
                    onChange={(e) =>
                      patchActive({ seoDescription: e.target.value || undefined })
                    }
                    placeholder={page.seoDescription}
                    rows={3}
                    className="mt-1 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
                  />
                </label>
                <details className="rounded border border-ink-800 bg-ink-950 p-2">
                  <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-ink-500">
                    Body content override (advanced)
                  </summary>
                  <p className="mt-2 text-[11px] text-ink-500">
                    Optional. JSON of the form{" "}
                    <code className="text-ink-300">{"{ blocks: [...] }"}</code>.
                    Leave empty to fall back to the canonical body.
                  </p>
                  <textarea
                    value={
                      current.publishedJson
                        ? JSON.stringify(current.publishedJson, null, 2)
                        : ""
                    }
                    onChange={(e) => {
                      const txt = e.target.value;
                      if (!txt.trim()) {
                        patchActive({ publishedJson: undefined });
                        return;
                      }
                      try {
                        const parsed = JSON.parse(txt) as CmsContent;
                        patchActive({ publishedJson: parsed });
                        setErr(null);
                      } catch {
                        // Don't write back; surface a soft warning.
                        setErr(
                          `Body JSON for ${activeLocale} is invalid — keeping previous value.`,
                        );
                      }
                    }}
                    rows={8}
                    spellCheck={false}
                    className="mt-2 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-[11px] text-ink-100"
                    placeholder='{ "blocks": [] }'
                  />
                </details>
              </div>
            )}
          </main>
        </div>
        <footer className="flex items-center justify-between border-t border-ink-800 px-4 py-3">
          <p className="text-[11px] text-ink-500">
            Saved as <code>translationsJson</code> on the page.
          </p>
          <div className="flex items-center gap-2">
            {err && (
              <span className="text-[11px] text-danger-400">{err}</span>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag-and-drop block canvas
// ---------------------------------------------------------------------------
//
// HTML5 native drag-and-drop. Two drag sources:
//   • The palette tiles (right rail) — dataTransfer carries
//     `type=cms-block-new` plus the block type slug. Dropping inserts
//     a fresh block at the computed insertion index.
//   • The block rows themselves — dataTransfer carries
//     `type=cms-block-move` plus the block id. Dropping reorders.
//
// The canvas listens on dragover and computes the insertion index by
// finding the first block whose vertical midpoint is below the mouse
// (or `length` if the mouse is past every block). A horizontal accent
// bar renders at that position to preview where the drop will land.
//
// We use a custom MIME prefix so unrelated drags (e.g. a desktop
// image dropped onto the page) don't accidentally hit our drop
// handler. If no recognised payload is in dataTransfer we ignore
// the drop entirely.

const DT_NEW = "application/x-tcgs-cms-block-new";
const DT_MOVE = "application/x-tcgs-cms-block-move";

function BlockCanvas({
  blocks,
  onInsertNew,
  onMoveExisting,
  onRemove,
  onChange,
}: {
  blocks: CmsBlock[];
  onInsertNew: (type: string, index: number) => void;
  onMoveExisting: (id: string, toIndex: number) => void;
  onRemove: (id: string) => void;
  onChange: (id: string, props: Record<string, unknown>) => void;
}) {
  // Stored insertion index — null when no drag is active. We drive
  // the visual indicator (and the drop target) from this.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    // Only react to drags carrying our custom MIME types — otherwise
    // the browser would treat any random drag as a drop target.
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes(DT_NEW) && !types.includes(DT_MOVE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes(DT_NEW) ? "copy" : "move";

    // Compute insertion index from mouse Y vs each block's bounding
    // box midpoint. We read DOM coordinates because the block list
    // can scroll within the main pane and we want to land at the
    // visual gap between rows, not the literal array index.
    const list = e.currentTarget.querySelector('[data-block-list="true"]');
    if (!list) {
      setInsertAt(0);
      return;
    }
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-block-row="true"]'));
    let idx = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    setInsertAt(idx);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear when the drag truly leaves the canvas, not when it
    // moves between child rows. relatedTarget being inside currentTarget
    // means we're still inside.
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setInsertAt(null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const target = insertAt ?? blocks.length;
    setInsertAt(null);
    setDraggingId(null);

    const newType = e.dataTransfer.getData(DT_NEW);
    if (newType) {
      onInsertNew(newType, target);
      return;
    }
    const moveId = e.dataTransfer.getData(DT_MOVE);
    if (moveId) {
      onMoveExisting(moveId, target);
      return;
    }
  }

  return (
    <div onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {blocks.length === 0 && (
        <div
          className={[
            "rounded-lg border-2 border-dashed p-12 text-center transition-colors",
            insertAt !== null
              ? "border-accent-500 bg-accent-500/5 text-accent-300"
              : "border-ink-700 text-ink-500",
          ].join(" ")}
        >
          <p className="text-sm">
            Drag a block from the palette, or click one to add to the end.
          </p>
        </div>
      )}
      <div data-block-list="true" className="space-y-3">
        {blocks.map((b, i) => (
          <Fragment key={b.id}>
            <DropIndicator visible={insertAt === i} />
            <BlockRow
              block={b}
              isDragging={draggingId === b.id}
              onDragStart={() => setDraggingId(b.id)}
              onDragEnd={() => {
                setDraggingId(null);
                setInsertAt(null);
              }}
              onRemove={() => onRemove(b.id)}
              onChange={(p) => onChange(b.id, p)}
            />
          </Fragment>
        ))}
        <DropIndicator visible={insertAt === blocks.length && blocks.length > 0} />
      </div>
    </div>
  );
}

/** A horizontal bar shown between blocks during a drag to indicate
 *  where the dropped block will land. */
function DropIndicator({ visible }: { visible: boolean }) {
  return (
    <div
      className={[
        "transition-all",
        visible ? "h-1.5 my-1 rounded-full bg-accent-500/80" : "h-0",
      ].join(" ")}
      aria-hidden="true"
    />
  );
}

function BlockRow({
  block,
  isDragging,
  onDragStart,
  onDragEnd,
  onRemove,
  onChange,
}: {
  block: CmsBlock;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onRemove: () => void;
  onChange: (props: Record<string, unknown>) => void;
}) {
  const spec = blockSpec(block.type);
  const props = block.props ?? {};
  const [expanded, setExpanded] = useState(true);

  const ctx = useContextMenu(() => [
    {
      label: expanded ? "Collapse" : "Expand",
      onSelect: () => setExpanded(!expanded),
    },
    { separator: true },
    {
      label: "Delete block",
      onSelect: onRemove,
      danger: true,
      shortcut: "Del",
    },
  ]);

  return (
    <div
      data-block-row="true"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DT_MOVE, block.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onContextMenu={ctx.onContextMenu}
      className={[
        "rounded-lg border bg-ink-900 transition-opacity",
        isDragging ? "border-accent-500/50 opacity-40" : "border-ink-800",
      ].join(" ")}
    >
      <header className="flex items-center justify-between border-b border-ink-800 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span
            className="cursor-grab select-none text-ink-500 hover:text-ink-200 active:cursor-grabbing"
            title="Drag to reorder"
            aria-hidden="true"
          >
            ⋮⋮
          </span>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-ink-300 hover:text-ink-100"
          >
            <span
              className={[
                "transition-transform",
                expanded ? "rotate-90" : "",
              ].join(" ")}
            >
              ▸
            </span>
            <span className="font-medium">{spec?.label ?? block.type}</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-danger-400 hover:bg-danger-500/15"
            title="Delete block"
          >
            ×
          </button>
        </div>
      </header>
      {expanded && (
        <div className="grid grid-cols-2 gap-3 p-3">
          <div className="rounded border border-ink-800 bg-ink-950 p-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              Preview
            </p>
            {spec ? (
              (() => {
                const Preview = spec.Preview;
                return <Preview props={props} />;
              })()
            ) : (
              <p className="text-xs text-ink-500">
                Unknown block type {block.type}.
              </p>
            )}
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              Properties
            </p>
            {spec ? (
              (() => {
                const Editor = spec.Editor;
                return <Editor props={props} onChange={onChange} />;
              })()
            ) : (
              <p className="text-xs text-ink-500">No editor for this block.</p>
            )}
          </div>
        </div>
      )}
      {ctx.element}
    </div>
  );
}

function BlockPalette({
  onAddAtEnd,
}: {
  onAddAtEnd: (type: string) => void;
}) {
  return (
    <div className="overflow-y-auto p-3">
      <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
        Drag a block onto the page
      </p>
      <div className="grid grid-cols-2 gap-2">
        {BLOCK_REGISTRY.map((b) => (
          <button
            key={b.type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DT_NEW, b.type);
              e.dataTransfer.effectAllowed = "copy";
              // A subtle ghost — the default is a screenshot of the
              // tile, which is fine but blurs at small sizes. Could
              // replace with a custom drag image later.
            }}
            // Click as a fallback for users who'd rather just add to
            // the end without dragging.
            onClick={() => onAddAtEnd(b.type)}
            className="flex cursor-grab select-none flex-col gap-0.5 rounded border border-ink-700 bg-ink-800 p-2 text-left text-xs text-ink-200 hover:border-accent-500/40 hover:bg-accent-500/10 active:cursor-grabbing"
            title={`Drag to insert · click to add at end · ${b.description}`}
          >
            <span className="font-medium text-ink-100">{b.label}</span>
            <span className="line-clamp-2 text-[10px] text-ink-400">
              {b.description}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[10px] text-ink-500">
        Tip: drag any block in the page by its <span aria-hidden="true">⋮⋮</span>{" "}
        handle to reorder.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block editors / previews
// ---------------------------------------------------------------------------

function HeadingEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const text = String(props.text ?? "");
  const level = Number(props.level ?? 1);
  return (
    <div className="space-y-2">
      <input
        value={text}
        onChange={(e) => onChange({ ...props, text: e.target.value })}
        className={INPUT}
      />
      <select
        value={level}
        onChange={(e) => onChange({ ...props, level: Number(e.target.value) })}
        className={INPUT}
      >
        <option value={1}>H1 — page title</option>
        <option value={2}>H2 — section</option>
        <option value={3}>H3 — subsection</option>
        <option value={4}>H4 — minor heading</option>
      </select>
    </div>
  );
}

function HeadingPreview({ props }: { props: Record<string, unknown> }) {
  const text = String(props.text ?? "Heading");
  const level = Number(props.level ?? 1);
  const cls = useMemo(
    () =>
      ({
        1: "text-2xl font-semibold text-ink-50",
        2: "text-xl font-semibold text-ink-100",
        3: "text-lg font-medium text-ink-100",
        4: "text-base font-medium text-ink-200",
      }[level as 1 | 2 | 3 | 4] ?? "text-base text-ink-100"),
    [level],
  );
  return <div className={cls}>{text}</div>;
}

function ParagraphEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <textarea
      value={String(props.text ?? "")}
      onChange={(e) => onChange({ ...props, text: e.target.value })}
      rows={5}
      className={INPUT}
    />
  );
}

function ParagraphPreview({ props }: { props: Record<string, unknown> }) {
  return (
    <p className="whitespace-pre-wrap text-sm text-ink-200">
      {String(props.text ?? "")}
    </p>
  );
}

function ImageEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.src ?? "")}
        onChange={(e) => onChange({ ...props, src: e.target.value })}
        placeholder="https://example.com/image.png"
        className={INPUT}
      />
      <input
        value={String(props.alt ?? "")}
        onChange={(e) => onChange({ ...props, alt: e.target.value })}
        placeholder="Alt text (for accessibility)"
        className={INPUT}
      />
      <input
        value={String(props.caption ?? "")}
        onChange={(e) => onChange({ ...props, caption: e.target.value })}
        placeholder="Caption (optional)"
        className={INPUT}
      />
    </div>
  );
}

function ImagePreview({ props }: { props: Record<string, unknown> }) {
  const src = String(props.src ?? "");
  if (!src) {
    return (
      <div className="flex h-24 items-center justify-center rounded border border-dashed border-ink-700 text-xs text-ink-500">
        No image source set
      </div>
    );
  }
  return (
    <figure className="space-y-1">
      <img
        src={src}
        alt={String(props.alt ?? "")}
        className="max-h-48 rounded object-contain"
      />
      {props.caption ? (
        <figcaption className="text-[11px] text-ink-500">
          {String(props.caption)}
        </figcaption>
      ) : null}
    </figure>
  );
}

function AssetImageEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const assetId = String(props.assetId ?? "");
  const sprite = (props.sprite ?? null) as SpriteRef | null;
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [pickingCell, setPickingCell] = useState(false);
  const picker = useAssetPicker((picked) => {
    // Picking a new asset clears any previous sprite ref — the cell
    // coordinates are tied to the prior sheet.
    onChange({ ...props, assetId: picked.id, sprite: null });
    setAsset(picked);
  });

  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setAsset(null);
      return;
    }
    setLoading(true);
    getAsset(assetId)
      .then((a) => {
        if (alive) setAsset(a);
      })
      .catch(() => {
        if (alive) setAsset(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [assetId]);

  // Detect spritesheets so we can offer the cell picker.
  const isSheet = useMemo(() => {
    if (!asset) return false;
    const sheet = (asset.metadataJson as { sheet?: unknown } | null)?.sheet;
    return Boolean(sheet);
  }, [asset]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={picker.open}
        className="w-full rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-left text-xs text-ink-200 hover:border-accent-500/40 hover:bg-accent-500/10"
      >
        {assetId
          ? loading
            ? "Loading…"
            : asset
            ? `Picked: ${asset.name}`
            : "Picked: (asset missing)"
          : "Pick an asset…"}
      </button>

      {isSheet && (
        <div className="rounded border border-ink-700 bg-ink-900/40 p-2">
          <p className="mb-1 text-[11px] text-ink-400">
            This asset is a spritesheet. Pick a single cell or use the whole
            sheet.
          </p>
          {sprite ? (
            <p className="font-mono text-[11px] text-accent-300">
              Cell ({sprite.col}, {sprite.row}) · {sprite.w}×{sprite.h} px
            </p>
          ) : (
            <p className="text-[11px] text-ink-500">Using whole sheet.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPickingCell(true)}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25"
            >
              {sprite ? "Change cell" : "Pick a cell"}
            </button>
            {sprite && (
              <button
                type="button"
                onClick={() => onChange({ ...props, sprite: null })}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
              >
                Use whole sheet
              </button>
            )}
          </div>
        </div>
      )}

      {asset && asset.visibility !== "public" && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
          This asset's visibility is "{asset.visibility}". Public visitors
          will see a 404 unless you change it to "public" in the Assets view.
        </p>
      )}

      <input
        value={String(props.alt ?? "")}
        onChange={(e) => onChange({ ...props, alt: e.target.value })}
        placeholder="Alt text"
        className={INPUT}
      />
      <input
        value={String(props.caption ?? "")}
        onChange={(e) => onChange({ ...props, caption: e.target.value })}
        placeholder="Caption (optional)"
        className={INPUT}
      />

      {picker.element}
      <SpriteCellPicker
        asset={asset}
        open={pickingCell}
        onClose={() => setPickingCell(false)}
        onPick={(ref) => {
          onChange({ ...props, sprite: ref });
        }}
      />
    </div>
  );
}

function AssetImagePreview({ props }: { props: Record<string, unknown> }) {
  const assetId = String(props.assetId ?? "");
  const sprite = (props.sprite ?? null) as SpriteRef | null;
  // The authoring preview can use the authenticated blob URL — same as the
  // designer's other asset previews. Public render uses the public URL.
  const src = assetId ? assetBlobUrl(assetId) : "";
  if (!src) {
    return (
      <div className="flex h-24 items-center justify-center rounded border border-dashed border-ink-700 text-xs text-ink-500">
        No asset picked yet
      </div>
    );
  }
  // Sprite refs render as a div with background-image positioned to
  // show only the cell — keeps the source asset URL stable while the
  // browser handles the crop.
  if (sprite) {
    return (
      <figure className="space-y-1">
        <div
          role="img"
          aria-label={String(props.alt ?? "")}
          style={{
            width: sprite.w,
            height: sprite.h,
            backgroundImage: `url(${src})`,
            backgroundPosition: `-${sprite.x}px -${sprite.y}px`,
            backgroundRepeat: "no-repeat",
            imageRendering: "pixelated",
          }}
          className="rounded"
        />
        {props.caption ? (
          <figcaption className="text-[11px] text-ink-500">
            {String(props.caption)}
          </figcaption>
        ) : null}
      </figure>
    );
  }
  return (
    <figure className="space-y-1">
      <img
        src={src}
        alt={String(props.alt ?? "")}
        className="max-h-48 rounded object-contain"
      />
      {props.caption ? (
        <figcaption className="text-[11px] text-ink-500">
          {String(props.caption)}
        </figcaption>
      ) : null}
    </figure>
  );
}

function CardGalleryEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.factionSlug ?? "")}
        onChange={(e) => onChange({ ...props, factionSlug: e.target.value })}
        placeholder='Filter by faction slug (or "" for all)'
        className={INPUT}
      />
      <input
        value={String(props.setCode ?? "")}
        onChange={(e) => onChange({ ...props, setCode: e.target.value })}
        placeholder='Filter by set code (or "" for all)'
        className={INPUT}
      />
      <input
        type="number"
        min={1}
        max={60}
        value={Number(props.limit ?? 12)}
        onChange={(e) => onChange({ ...props, limit: Number(e.target.value) })}
        className={INPUT}
      />
      <p className="text-[11px] text-ink-500">
        Renders live from the public card API at view time.
      </p>
    </div>
  );
}

function CardGalleryPreview({ props }: { props: Record<string, unknown> }) {
  const f = String(props.factionSlug ?? "");
  const s = String(props.setCode ?? "");
  const limit = Number(props.limit ?? 12);
  return (
    <div className="rounded border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
      <p className="font-medium text-ink-100">Card gallery</p>
      <p className="text-ink-500">
        Up to {limit} cards
        {f ? ` · faction "${f}"` : ""}
        {s ? ` · set "${s}"` : ""}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {Array.from({ length: Math.min(6, limit) }).map((_, i) => (
          <div
            key={i}
            className="aspect-[5/7] rounded bg-ink-800"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

function ButtonEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.label ?? "")}
        onChange={(e) => onChange({ ...props, label: e.target.value })}
        placeholder="Button label"
        className={INPUT}
      />
      <input
        value={String(props.href ?? "")}
        onChange={(e) => onChange({ ...props, href: e.target.value })}
        placeholder="/rules or https://…"
        className={INPUT}
      />
    </div>
  );
}

function ButtonPreview({ props }: { props: Record<string, unknown> }) {
  return (
    <span className="inline-block rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs text-accent-300">
      {String(props.label ?? "Button")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Navigation editor (sec 14.14)
// ---------------------------------------------------------------------------
//
// Each menu lives at one placement (header/footer/sidebar/...). The
// editor is a flat list — no tree nesting in v0; nested menus can come
// when we have a real UI need. Items can be:
//   • page    → links to a CmsPage by slug
//   • url     → external URL
//   • gallery → canonical /cards index on the public site
//   • section → label-only, used as a visual divider in long menus

const PLACEMENTS: { value: CmsNavPlacement; label: string }[] = [
  { value: "header", label: "Header" },
  { value: "footer", label: "Footer" },
  { value: "mobile", label: "Mobile menu" },
  { value: "sidebar", label: "Sidebar" },
  { value: "rules", label: "Rules sidebar" },
  { value: "lore", label: "Lore sidebar" },
  { value: "custom", label: "Custom" },
];

function NavigationTab({
  siteId,
  pages,
  navigations,
  onChanged,
}: {
  siteId: string;
  pages: CmsPageSummary[];
  navigations: CmsNavigation[];
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    navigations[0]?.id ?? null,
  );

  // Keep activeId in sync as the upstream list changes (e.g. after create).
  useEffect(() => {
    if (!activeId && navigations[0]) setActiveId(navigations[0].id);
    if (activeId && !navigations.some((n) => n.id === activeId)) {
      setActiveId(navigations[0]?.id ?? null);
    }
  }, [navigations, activeId]);

  const usedPlacements = new Set(navigations.map((n) => n.placement));
  const activeNav = navigations.find((n) => n.id === activeId);

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex h-full w-56 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-ink-400">
            Menus
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
            disabled={usedPlacements.size === PLACEMENTS.length}
            title={
              usedPlacements.size === PLACEMENTS.length
                ? "All placements already configured"
                : undefined
            }
          >
            New
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {navigations.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-500">
              No menus yet.
            </li>
          )}
          {navigations.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setActiveId(n.id)}
                className={[
                  "flex w-full flex-col px-3 py-2 text-left text-sm",
                  activeId === n.id
                    ? "bg-accent-500/10 text-accent-200"
                    : "text-ink-200 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="truncate">{n.name}</span>
                <span className="text-[11px] text-ink-500">
                  {placementLabel(n.placement)} ·{" "}
                  {(n.itemsJson?.items ?? []).length} item
                  {(n.itemsJson?.items ?? []).length === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex-1 overflow-hidden">
        {activeNav ? (
          <NavigationEditor
            key={activeNav.id}
            navigation={activeNav}
            pages={pages}
            onChanged={onChanged}
            onDeleted={async () => {
              await onChanged();
              setActiveId(null);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            <div className="max-w-sm text-center">
              <p className="mb-2 text-ink-200">No menu selected.</p>
              <p className="text-ink-500">
                Create a menu and add page links, external URLs, or the live
                card gallery.
              </p>
            </div>
          </div>
        )}
      </div>
      {creating && (
        <CreateNavigationModal
          siteId={siteId}
          usedPlacements={usedPlacements}
          onClose={() => setCreating(false)}
          onCreated={async (n) => {
            setCreating(false);
            await onChanged();
            setActiveId(n.id);
          }}
        />
      )}
    </div>
  );
}

function placementLabel(p: CmsNavPlacement): string {
  return PLACEMENTS.find((x) => x.value === p)?.label ?? p;
}

function CreateNavigationModal({
  siteId,
  usedPlacements,
  onClose,
  onCreated,
}: {
  siteId: string;
  usedPlacements: Set<CmsNavPlacement>;
  onClose: () => void;
  onCreated: (n: CmsNavigation) => void;
}) {
  const available = PLACEMENTS.filter((p) => !usedPlacements.has(p.value));
  const [placement, setPlacement] = useState<CmsNavPlacement>(
    available[0]?.value ?? "header",
  );
  const [name, setName] = useState(
    available[0] ? `${available[0].label} menu` : "Menu",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const nav = await createCmsNavigation({
        siteId,
        placement,
        name,
        itemsJson: { items: [] },
      });
      onCreated(nav);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[420px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">New menu</h3>
        <Field label="Placement">
          <select
            value={placement}
            onChange={(e) => {
              const v = e.target.value as CmsNavPlacement;
              setPlacement(v);
              setName(
                `${PLACEMENTS.find((p) => p.value === v)?.label ?? v} menu`,
              );
            }}
            className={INPUT}
          >
            {available.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name (admin label)">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={INPUT}
          />
        </Field>
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !available.length}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create menu"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NavigationEditor({
  navigation,
  pages,
  onChanged,
  onDeleted,
}: {
  navigation: CmsNavigation;
  pages: CmsPageSummary[];
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [name, setName] = useState(navigation.name);
  const [items, setItems] = useState<CmsNavItem[]>(
    navigation.itemsJson?.items ?? [],
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function addItem(kind: CmsNavItem["kind"]) {
    const base: CmsNavItem = {
      id: `nav_${Math.random().toString(36).slice(2, 10)}`,
      label:
        kind === "page"
          ? "Page link"
          : kind === "url"
          ? "External link"
          : kind === "gallery"
          ? "Cards"
          : "Section",
      kind,
    };
    if (kind === "page") base.slug = pages[0]?.slug ?? "";
    if (kind === "url") base.target = "https://";
    setItems([...items, base]);
    setDirty(true);
  }

  function updateItem(id: string, patch: Partial<CmsNavItem>) {
    setItems(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    setDirty(true);
  }

  function removeItem(id: string) {
    setItems(items.filter((it) => it.id !== id));
    setDirty(true);
  }

  function move(id: string, dir: -1 | 1) {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= items.length) return;
    const arr = [...items];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setItems(arr);
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await updateCmsNavigation(navigation.id, {
        name,
        itemsJson: { items },
      });
      setDirty(false);
      await onChanged();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!confirm(`Delete menu "${navigation.name}"?`)) return;
    await deleteCmsNavigation(navigation.id);
    await onDeleted();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div className="flex-1 space-y-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className={[INPUT, "text-base font-medium text-ink-100"].join(" ")}
          />
          <p className="text-[11px] text-ink-500">
            Placement:{" "}
            <span className="text-ink-300">
              {placementLabel(navigation.placement)}
            </span>
            {" · "}
            {items.length} item{items.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={destroy}
              className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20"
            >
              Delete
            </button>
          </div>
          {err && (
            <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
              {err}
            </p>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="text-sm text-ink-500">
              No items yet. Use the right panel to add the first one.
            </p>
          ) : (
            <ol className="space-y-2">
              {items.map((it, i) => (
                <li key={it.id}>
                  <NavItemRow
                    item={it}
                    pages={pages}
                    onChange={(patch) => updateItem(it.id, patch)}
                    onRemove={() => removeItem(it.id)}
                    onUp={i > 0 ? () => move(it.id, -1) : undefined}
                    onDown={
                      i < items.length - 1 ? () => move(it.id, 1) : undefined
                    }
                  />
                </li>
              ))}
            </ol>
          )}
        </main>
        <aside className="w-56 shrink-0 border-l border-ink-800 bg-ink-900 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
            Add an item
          </p>
          <div className="space-y-2">
            <AddItemButton
              label="Page link"
              hint="Link to a CMS page on this site."
              onClick={() => addItem("page")}
              disabled={pages.length === 0}
            />
            <AddItemButton
              label="External URL"
              hint="An off-site link (opens in a new tab)."
              onClick={() => addItem("url")}
            />
            <AddItemButton
              label="Card gallery"
              hint="Sends visitors to /cards."
              onClick={() => addItem("gallery")}
            />
            <AddItemButton
              label="Section header"
              hint="Visual divider — no link."
              onClick={() => addItem("section")}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function NavItemRow({
  item,
  pages,
  onChange,
  onRemove,
  onUp,
  onDown,
}: {
  item: CmsNavItem;
  pages: CmsPageSummary[];
  onChange: (patch: Partial<CmsNavItem>) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  return (
    <div className="rounded border border-ink-800 bg-ink-900 p-3">
      <div className="flex items-start gap-3">
        <span
          className={[
            "rounded px-1.5 py-px text-[10px] uppercase tracking-wider",
            item.kind === "page"
              ? "bg-accent-500/20 text-accent-200"
              : item.kind === "url"
              ? "bg-sky-500/20 text-sky-300"
              : item.kind === "gallery"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-ink-700 text-ink-300",
          ].join(" ")}
        >
          {item.kind}
        </span>
        <div className="flex-1 space-y-2">
          <input
            value={item.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder="Label shown to visitors"
            className={INPUT}
          />
          {item.kind === "page" && (
            <select
              value={item.slug ?? ""}
              onChange={(e) => onChange({ slug: e.target.value })}
              className={INPUT}
            >
              {pages.length === 0 && <option value="">No pages</option>}
              {pages.map((p) => (
                <option key={p.id} value={p.slug}>
                  {p.title} (/{p.slug || "(home)"})
                </option>
              ))}
            </select>
          )}
          {item.kind === "url" && (
            <input
              value={item.target ?? ""}
              onChange={(e) => onChange({ target: e.target.value })}
              placeholder="https://example.com"
              className={INPUT}
            />
          )}
          {item.kind === "gallery" && (
            <p className="text-[11px] text-ink-500">
              Links to the public card gallery at /cards. No options.
            </p>
          )}
          {item.kind === "section" && (
            <p className="text-[11px] text-ink-500">
              No link — used as a visual section header inside the menu.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onUp && (
            <button
              type="button"
              onClick={onUp}
              className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              title="Move up"
            >
              ↑
            </button>
          )}
          {onDown && (
            <button
              type="button"
              onClick={onDown}
              className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              title="Move down"
            >
              ↓
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-danger-400 hover:bg-danger-500/15"
            title="Remove item"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function AddItemButton({
  label,
  hint,
  onClick,
  disabled,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full flex-col gap-0.5 rounded border border-ink-700 bg-ink-800 p-2 text-left text-xs text-ink-200 hover:border-accent-500/40 hover:bg-accent-500/10 disabled:opacity-40 disabled:hover:border-ink-700 disabled:hover:bg-ink-800"
      title={hint}
    >
      <span className="font-medium text-ink-100">{label}</span>
      <span className="text-[10px] text-ink-400">{hint}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Form block — page-level embed
// ---------------------------------------------------------------------------

function FormBlockEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.formSlug ?? "")}
        onChange={(e) => onChange({ ...props, formSlug: e.target.value })}
        placeholder="Form slug (e.g. playtest-signup)"
        className={INPUT}
      />
      <p className="text-[11px] text-ink-500">
        Manage forms in the Forms tab. Only "active" forms render publicly.
      </p>
    </div>
  );
}

function FormBlockPreview({ props }: { props: Record<string, unknown> }) {
  const slug = String(props.formSlug ?? "");
  return (
    <div className="rounded border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
      <p className="font-medium text-ink-100">Form embed</p>
      <p className="text-ink-500">
        {slug ? `Slug: ${slug}` : "No form selected yet."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms tab — builder + submissions viewer (sec 14.15)
// ---------------------------------------------------------------------------

const FIELD_KIND_LABELS: Record<CmsFormFieldKind, string> = {
  text: "Short text",
  longtext: "Long text",
  email: "Email",
  number: "Number",
  checkbox: "Checkbox",
  select: "Single-choice",
  multiselect: "Multi-choice",
  url: "URL",
  phone: "Phone",
  date: "Date",
};

function FormsTab({ siteId }: { siteId: string }) {
  const [forms, setForms] = useState<CmsForm[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    listCmsForms({ siteId })
      .then((list) => {
        if (!alive) return;
        setForms(list);
        if (list.length > 0 && !activeId) setActiveId(list[0].id);
      })
      .catch(() => {
        if (alive) setForms([]);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, refreshKey]);

  async function refresh() {
    setRefreshKey((k) => k + 1);
  }

  if (!forms) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading forms…
      </div>
    );
  }

  const active = forms.find((f) => f.id === activeId) ?? null;

  return (
    <div className="flex h-full overflow-hidden">
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2">
          <span className="text-xs uppercase tracking-wider text-ink-400">
            Forms
          </span>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-0.5 text-[11px] text-accent-300 hover:bg-accent-500/25"
          >
            New
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto py-1">
          {forms.length === 0 && (
            <li className="px-3 py-2 text-xs text-ink-500">
              No forms yet. Create one to capture playtest signups, contact
              messages, etc.
            </li>
          )}
          {forms.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => setActiveId(f.id)}
                className={[
                  "flex w-full flex-col px-3 py-2 text-left text-sm",
                  activeId === f.id
                    ? "bg-accent-500/10 text-accent-200"
                    : "text-ink-200 hover:bg-ink-800",
                ].join(" ")}
              >
                <span className="flex items-center gap-2 truncate">
                  <span className="truncate">{f.name}</span>
                  <FormStatusChip status={f.status} />
                </span>
                <span className="truncate text-[11px] text-ink-500">
                  /{f.slug}
                  {typeof f.submissionCount === "number" && (
                    <> · {f.submissionCount} submission{f.submissionCount === 1 ? "" : "s"}</>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex-1 overflow-hidden">
        {active ? (
          <FormEditor
            key={active.id}
            form={active}
            onChanged={refresh}
            onDeleted={async () => {
              await refresh();
              setActiveId(null);
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            <div className="max-w-sm text-center">
              <p className="mb-2 text-ink-200">No form selected.</p>
              <p className="text-ink-500">
                Create a form to start collecting submissions on your public
                site.
              </p>
            </div>
          </div>
        )}
      </div>
      {creating && (
        <CreateFormModal
          siteId={siteId}
          onClose={() => setCreating(false)}
          onCreated={async (f) => {
            setCreating(false);
            await refresh();
            setActiveId(f.id);
          }}
        />
      )}
    </div>
  );
}

function FormStatusChip({ status }: { status: string }) {
  const palette: Record<string, string> = {
    draft: "bg-ink-700 text-ink-300",
    active: "bg-emerald-500/20 text-emerald-300",
    archived: "bg-ink-700 text-ink-500",
  };
  return (
    <span
      className={[
        "rounded px-1 py-px text-[9px] uppercase tracking-wider",
        palette[status] ?? "bg-ink-700 text-ink-300",
      ].join(" ")}
    >
      {status}
    </span>
  );
}

function CreateFormModal({
  siteId,
  onClose,
  onCreated,
}: {
  siteId: string;
  onClose: () => void;
  onCreated: (f: CmsForm) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60),
    );
  }, [name, slugTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const form = await createCmsForm({
        siteId,
        slug,
        name,
        fieldsJson: {
          fields: [
            {
              id: `f_${Math.random().toString(36).slice(2, 8)}`,
              name: "name",
              label: "Your name",
              kind: "text",
              required: true,
            },
            {
              id: `f_${Math.random().toString(36).slice(2, 8)}`,
              name: "email",
              label: "Email",
              kind: "email",
              required: true,
            },
            {
              id: `f_${Math.random().toString(36).slice(2, 8)}`,
              name: "message",
              label: "Message",
              kind: "longtext",
            },
          ],
        },
        settingsJson: {
          successMessage: "Thanks — we got your message.",
        },
      });
      onCreated(form);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[420px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">New form</h3>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playtest signup"
            required
            className={INPUT}
          />
        </Field>
        <Field label="Slug" hint="Used in the public URL. Letters, numbers, dashes.">
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            required
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            className={INPUT}
          />
        </Field>
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <p className="mb-3 text-[11px] text-ink-500">
          We'll seed the form with name + email + message fields. You can
          customize them after creation.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name || !slug}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create form"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FormEditor({
  form,
  onChanged,
  onDeleted,
}: {
  form: CmsForm;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"build" | "settings" | "submissions">(
    "build",
  );
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [fields, setFields] = useState<CmsFormField[]>(
    form.fieldsJson?.fields ?? [],
  );
  const [settings, setSettings] = useState(form.settingsJson ?? {});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(form.name);
    setDescription(form.description);
    setFields(form.fieldsJson?.fields ?? []);
    setSettings(form.settingsJson ?? {});
    setDirty(false);
  }, [form.id]);

  function markDirty() {
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await updateCmsForm(form.id, {
        name,
        description,
        fieldsJson: { fields },
        settingsJson: settings,
      });
      setDirty(false);
      await onChanged();
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus() {
    setBusy(true);
    try {
      await updateCmsForm(form.id, {
        status: form.status === "active" ? "draft" : "active",
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (
      !confirm(
        `Delete form "${form.name}"? All submissions will be deleted too.`,
      )
    )
      return;
    await deleteCmsForm(form.id);
    await onDeleted();
  }

  function addField(kind: CmsFormFieldKind) {
    const f: CmsFormField = {
      id: `f_${Math.random().toString(36).slice(2, 10)}`,
      name: `field_${fields.length + 1}`,
      label: "New field",
      kind,
    };
    setFields([...fields, f]);
    markDirty();
  }

  function patchField(id: string, patch: Partial<CmsFormField>) {
    setFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    markDirty();
  }

  function removeField(id: string) {
    setFields(fields.filter((f) => f.id !== id));
    markDirty();
  }

  function moveField(id: string, dir: -1 | 1) {
    const idx = fields.findIndex((f) => f.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= fields.length) return;
    const arr = [...fields];
    [arr[idx], arr[next]] = [arr[next], arr[idx]];
    setFields(arr);
    markDirty();
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-start gap-3 border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div className="flex-1 space-y-2">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
            className={[INPUT, "text-base font-medium text-ink-100"].join(" ")}
          />
          <input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            placeholder="Internal notes about this form (not shown publicly)"
            className={INPUT}
          />
          <p className="text-[11px] text-ink-500">
            Slug: <span className="text-ink-300">/{form.slug}</span>
            {" · "}
            <FormStatusChip status={form.status} />
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={toggleStatus}
              disabled={busy}
              className={[
                "rounded border px-3 py-1 text-xs font-medium",
                form.status === "active"
                  ? "border-ink-700 bg-ink-800 text-ink-200 hover:bg-ink-700"
                  : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
              ].join(" ")}
            >
              {form.status === "active" ? "Deactivate" : "Activate"}
            </button>
            <button
              type="button"
              onClick={destroy}
              disabled={busy}
              className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1 text-xs text-danger-400 hover:bg-danger-500/20"
            >
              Delete
            </button>
          </div>
          {err && (
            <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
              {err}
            </p>
          )}
        </div>
      </header>
      <nav className="flex border-b border-ink-800 bg-ink-900 px-4">
        <Tab active={tab === "build"} onClick={() => setTab("build")}>
          Build ({fields.length})
        </Tab>
        <Tab active={tab === "settings"} onClick={() => setTab("settings")}>
          Settings
        </Tab>
        <Tab
          active={tab === "submissions"}
          onClick={() => setTab("submissions")}
        >
          Submissions
        </Tab>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === "build" && (
          <FormBuilder
            fields={fields}
            onAdd={addField}
            onPatch={patchField}
            onRemove={removeField}
            onMove={moveField}
          />
        )}
        {tab === "settings" && (
          <FormSettingsEditor
            settings={settings}
            onChange={(next) => {
              setSettings(next);
              markDirty();
            }}
          />
        )}
        {tab === "submissions" && <FormSubmissionsViewer form={form} />}
      </div>
    </div>
  );
}

function FormBuilder({
  fields,
  onAdd,
  onPatch,
  onRemove,
  onMove,
}: {
  fields: CmsFormField[];
  onAdd: (kind: CmsFormFieldKind) => void;
  onPatch: (id: string, patch: Partial<CmsFormField>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  return (
    <div className="grid h-full grid-cols-[1fr_220px] overflow-hidden">
      <main className="overflow-y-auto p-4">
        {fields.length === 0 ? (
          <p className="text-sm text-ink-500">
            No fields yet. Pick a field kind on the right to get started.
          </p>
        ) : (
          <ol className="space-y-2">
            {fields.map((f, i) => (
              <li key={f.id}>
                <FieldRow
                  field={f}
                  onPatch={(p) => onPatch(f.id, p)}
                  onRemove={() => onRemove(f.id)}
                  onUp={i > 0 ? () => onMove(f.id, -1) : undefined}
                  onDown={
                    i < fields.length - 1 ? () => onMove(f.id, 1) : undefined
                  }
                />
              </li>
            ))}
          </ol>
        )}
      </main>
      <aside className="overflow-y-auto border-l border-ink-800 bg-ink-900 p-3">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
          Add a field
        </p>
        <div className="grid gap-2">
          {(Object.keys(FIELD_KIND_LABELS) as CmsFormFieldKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAdd(k)}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1.5 text-left text-xs text-ink-200 hover:border-accent-500/40 hover:bg-accent-500/10"
            >
              {FIELD_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

function FieldRow({
  field,
  onPatch,
  onRemove,
  onUp,
  onDown,
}: {
  field: CmsFormField;
  onPatch: (p: Partial<CmsFormField>) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const needsOptions =
    field.kind === "select" || field.kind === "multiselect";
  return (
    <div className="rounded border border-ink-800 bg-ink-900 p-3">
      <div className="flex items-start gap-3">
        <span className="rounded bg-accent-500/20 px-1.5 py-px text-[10px] uppercase tracking-wider text-accent-200">
          {FIELD_KIND_LABELS[field.kind]}
        </span>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <input
            value={field.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            placeholder="Label shown to visitors"
            className={INPUT}
          />
          <input
            value={field.name}
            onChange={(e) =>
              onPatch({
                name: e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9_]/g, "_"),
              })
            }
            placeholder="field_name (snake_case)"
            className={INPUT}
          />
          <input
            value={field.placeholder ?? ""}
            onChange={(e) => onPatch({ placeholder: e.target.value })}
            placeholder="Placeholder (optional)"
            className={INPUT}
          />
          <input
            value={field.helpText ?? ""}
            onChange={(e) => onPatch({ helpText: e.target.value })}
            placeholder="Help text (optional)"
            className={INPUT}
          />
          {needsOptions && (
            <textarea
              value={(field.options ?? [])
                .map((o) => `${o.value}|${o.label}`)
                .join("\n")}
              onChange={(e) => {
                const lines = e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean);
                onPatch({
                  options: lines.map((l) => {
                    const [value, label] = l.split("|");
                    return {
                      value: value.trim(),
                      label: (label ?? value).trim(),
                    };
                  }),
                });
              }}
              placeholder={`One option per line. Use "value|label" for separate display.`}
              rows={3}
              className={[INPUT, "col-span-2"].join(" ")}
            />
          )}
          <label className="col-span-2 flex items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              onChange={(e) => onPatch({ required: e.target.checked })}
            />
            Required
          </label>
        </div>
        <div className="flex items-center gap-1">
          {onUp && (
            <button
              type="button"
              onClick={onUp}
              className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              title="Move up"
            >
              ↑
            </button>
          )}
          {onDown && (
            <button
              type="button"
              onClick={onDown}
              className="rounded px-1.5 py-0.5 text-ink-500 hover:bg-ink-800 hover:text-ink-200"
              title="Move down"
            >
              ↓
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="rounded px-1.5 py-0.5 text-danger-400 hover:bg-danger-500/15"
            title="Remove field"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function FormSettingsEditor({
  settings,
  onChange,
}: {
  settings: CmsForm["settingsJson"];
  onChange: (next: CmsForm["settingsJson"]) => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-xl space-y-3">
        <Field label="Success message" hint="Shown to visitors after submitting.">
          <input
            value={settings.successMessage ?? ""}
            onChange={(e) =>
              onChange({ ...settings, successMessage: e.target.value })
            }
            className={INPUT}
          />
        </Field>
        <Field
          label="Email recipients"
          hint="One email address per line. Each gets a copy of every submission. (Delivery hooks ship in a follow-up.)"
        >
          <textarea
            value={(settings.emailRecipients ?? []).join("\n")}
            onChange={(e) =>
              onChange({
                ...settings,
                emailRecipients: e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            rows={3}
            className={INPUT}
          />
        </Field>
        <Field label="Webhook URL" hint="Optional — POSTs the submission JSON to this URL.">
          <input
            value={settings.webhookUrl ?? ""}
            onChange={(e) =>
              onChange({ ...settings, webhookUrl: e.target.value || undefined })
            }
            placeholder="https://example.com/webhooks/cms"
            className={INPUT}
          />
        </Field>
        <Field
          label="Rate limit (per IP per hour)"
          hint="Defaults to 30. Lower = stricter; bots get 429s faster."
        >
          <input
            type="number"
            min={1}
            max={10000}
            value={settings.rateLimitPerHour ?? 30}
            onChange={(e) =>
              onChange({
                ...settings,
                rateLimitPerHour: Number(e.target.value) || 30,
              })
            }
            className={INPUT}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-ink-300">
          <input
            type="checkbox"
            checked={Boolean(settings.requireConsent)}
            onChange={(e) =>
              onChange({ ...settings, requireConsent: e.target.checked })
            }
          />
          Require explicit consent before submission
        </label>
        {settings.requireConsent && (
          <Field label="Consent label">
            <input
              value={settings.consentLabel ?? ""}
              onChange={(e) =>
                onChange({ ...settings, consentLabel: e.target.value })
              }
              placeholder="I agree to the terms and privacy policy"
              className={INPUT}
            />
          </Field>
        )}
      </div>
    </div>
  );
}

function FormSubmissionsViewer({ form }: { form: CmsForm }) {
  const [submissions, setSubmissions] = useState<CmsFormSubmission[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listCmsFormSubmissions(form.id, { limit: 200 })
      .then((s) => {
        if (alive) setSubmissions(s);
      })
      .catch(() => {
        if (alive) setSubmissions([]);
      });
    return () => {
      alive = false;
    };
  }, [form.id]);

  async function exportCsv() {
    setBusy(true);
    try {
      await downloadCmsFormSubmissionsCsv(
        form.id,
        `${form.slug}-submissions.csv`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(id: string) {
    if (!confirm("Delete this submission?")) return;
    await deleteCmsFormSubmission(id);
    setSubmissions((submissions ?? []).filter((s) => s.id !== id));
  }

  if (!submissions) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading submissions…
      </div>
    );
  }

  const fields = form.fieldsJson?.fields ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-2">
        <p className="text-xs text-ink-400">
          {submissions.length} submission{submissions.length === 1 ? "" : "s"}
          {submissions.length === 200 && " (showing latest 200)"}
        </p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={busy || submissions.length === 0}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-200 hover:bg-ink-700 disabled:opacity-50"
        >
          {busy ? "Exporting…" : "Export CSV"}
        </button>
      </header>
      <div className="flex-1 overflow-auto">
        {submissions.length === 0 ? (
          <p className="p-4 text-sm text-ink-500">
            No submissions yet. Once visitors submit your form, they'll show
            up here.
          </p>
        ) : (
          <table className="min-w-full table-fixed text-xs">
            <thead className="sticky top-0 bg-ink-900 text-ink-400">
              <tr>
                <th className="border-b border-ink-800 px-3 py-2 text-left font-medium">
                  Submitted
                </th>
                {fields.map((f) => (
                  <th
                    key={f.id}
                    className="border-b border-ink-800 px-3 py-2 text-left font-medium"
                  >
                    {f.label}
                  </th>
                ))}
                <th className="border-b border-ink-800 px-3 py-2 text-left font-medium">
                  IP
                </th>
                <th className="border-b border-ink-800 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="text-ink-200 hover:bg-ink-900/50">
                  <td className="border-b border-ink-800 px-3 py-2 align-top text-ink-400">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                  {fields.map((f) => (
                    <td
                      key={f.id}
                      className="border-b border-ink-800 px-3 py-2 align-top"
                    >
                      <span className="line-clamp-3 break-words">
                        {formatPayloadValue(s.payloadJson?.[f.name])}
                      </span>
                    </td>
                  ))}
                  <td className="border-b border-ink-800 px-3 py-2 align-top text-ink-500">
                    {s.ip ?? "—"}
                  </td>
                  <td className="border-b border-ink-800 px-3 py-2 align-top">
                    <button
                      type="button"
                      onClick={() => deleteOne(s.id)}
                      className="rounded px-1.5 py-0.5 text-danger-400 hover:bg-danger-500/15"
                      title="Delete submission"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "✓" : "—";
  return String(v);
}

// ---------------------------------------------------------------------------
// Additional block editors / previews (sec 14.5)
// ---------------------------------------------------------------------------

function HeroEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.eyebrow ?? "")}
        onChange={(e) => onChange({ ...props, eyebrow: e.target.value })}
        placeholder="Eyebrow (small caps above heading)"
        className={INPUT}
      />
      <input
        value={String(props.heading ?? "")}
        onChange={(e) => onChange({ ...props, heading: e.target.value })}
        placeholder="Heading"
        className={INPUT}
      />
      <textarea
        value={String(props.subheading ?? "")}
        onChange={(e) => onChange({ ...props, subheading: e.target.value })}
        placeholder="Subheading"
        rows={2}
        className={INPUT}
      />
      <input
        value={String(props.ctaLabel ?? "")}
        onChange={(e) => onChange({ ...props, ctaLabel: e.target.value })}
        placeholder='CTA button label (leave empty to hide)'
        className={INPUT}
      />
      <input
        value={String(props.ctaHref ?? "")}
        onChange={(e) => onChange({ ...props, ctaHref: e.target.value })}
        placeholder="CTA URL"
        className={INPUT}
      />
      <select
        value={String(props.align ?? "center")}
        onChange={(e) => onChange({ ...props, align: e.target.value })}
        className={INPUT}
      >
        <option value="left">Left aligned</option>
        <option value="center">Center aligned</option>
      </select>
    </div>
  );
}

function HeroPreview({ props }: { props: Record<string, unknown> }) {
  const align = props.align === "left" ? "text-left" : "text-center";
  return (
    <div className={`rounded border border-ink-700 bg-ink-900 p-4 ${align}`}>
      {props.eyebrow && (
        <p className="text-[10px] uppercase tracking-widest text-accent-300">
          {String(props.eyebrow)}
        </p>
      )}
      <p className="mt-1 text-lg font-semibold text-ink-100">
        {String(props.heading ?? "Heading")}
      </p>
      {props.subheading && (
        <p className="mt-1 text-xs text-ink-400">{String(props.subheading)}</p>
      )}
      {props.ctaLabel && (
        <span className="mt-2 inline-block rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] text-accent-300">
          {String(props.ctaLabel)}
        </span>
      )}
    </div>
  );
}

interface ColumnEntry {
  heading: string;
  body: string;
}
function ColumnsEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const cols = (props.columns as ColumnEntry[] | undefined) ?? [];
  function update(i: number, patch: Partial<ColumnEntry>) {
    onChange({
      ...props,
      columns: cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)),
    });
  }
  function add() {
    onChange({ ...props, columns: [...cols, { heading: "", body: "" }] });
  }
  function remove(i: number) {
    onChange({ ...props, columns: cols.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="space-y-2">
      {cols.map((c, i) => (
        <div key={i} className="rounded border border-ink-800 p-2">
          <input
            value={c.heading}
            onChange={(e) => update(i, { heading: e.target.value })}
            placeholder="Heading"
            className={INPUT}
          />
          <textarea
            value={c.body}
            onChange={(e) => update(i, { body: e.target.value })}
            placeholder="Body"
            rows={2}
            className={`${INPUT} mt-1`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 text-[11px] text-danger-400 hover:underline"
          >
            Remove column
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={cols.length >= 6}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
      >
        + Add column
      </button>
    </div>
  );
}

function ColumnsPreview({ props }: { props: Record<string, unknown> }) {
  const cols = (props.columns as ColumnEntry[] | undefined) ?? [];
  return (
    <div
      className={`grid gap-2`}
      style={{
        gridTemplateColumns: `repeat(${Math.min(Math.max(cols.length, 1), 4)}, minmax(0, 1fr))`,
      }}
    >
      {cols.map((c, i) => (
        <div key={i} className="rounded border border-ink-800 bg-ink-900 p-2">
          <p className="text-xs font-medium text-ink-100">
            {c.heading || "Column"}
          </p>
          {c.body && (
            <p className="mt-1 text-[11px] text-ink-400">{c.body}</p>
          )}
        </div>
      ))}
    </div>
  );
}

interface TabEntry {
  label: string;
  body: string;
}
function TabsEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const tabs = (props.tabs as TabEntry[] | undefined) ?? [];
  function update(i: number, patch: Partial<TabEntry>) {
    onChange({
      ...props,
      tabs: tabs.map((t, idx) => (idx === i ? { ...t, ...patch } : t)),
    });
  }
  function add() {
    onChange({ ...props, tabs: [...tabs, { label: "Tab", body: "" }] });
  }
  function remove(i: number) {
    onChange({ ...props, tabs: tabs.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="space-y-2">
      {tabs.map((t, i) => (
        <div key={i} className="rounded border border-ink-800 p-2">
          <input
            value={t.label}
            onChange={(e) => update(i, { label: e.target.value })}
            placeholder="Tab label"
            className={INPUT}
          />
          <textarea
            value={t.body}
            onChange={(e) => update(i, { body: e.target.value })}
            placeholder="Tab body"
            rows={3}
            className={`${INPUT} mt-1`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 text-[11px] text-danger-400 hover:underline"
          >
            Remove tab
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        disabled={tabs.length >= 8}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
      >
        + Add tab
      </button>
    </div>
  );
}

function TabsPreview({ props }: { props: Record<string, unknown> }) {
  const tabs = (props.tabs as TabEntry[] | undefined) ?? [];
  const [active, setActive] = useState(0);
  if (tabs.length === 0) {
    return (
      <div className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
        No tabs.
      </div>
    );
  }
  return (
    <div className="rounded border border-ink-700 bg-ink-900">
      <div className="flex border-b border-ink-800">
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={[
              "border-b-2 px-3 py-1.5 text-[11px]",
              i === active
                ? "border-accent-500 text-accent-300"
                : "border-transparent text-ink-400 hover:text-ink-200",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="whitespace-pre-wrap p-3 text-xs text-ink-300">
        {tabs[active]?.body}
      </p>
    </div>
  );
}

interface AccordionEntry {
  q: string;
  a: string;
}
function AccordionEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const items = (props.items as AccordionEntry[] | undefined) ?? [];
  function update(i: number, patch: Partial<AccordionEntry>) {
    onChange({
      ...props,
      items: items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    });
  }
  function add() {
    onChange({ ...props, items: [...items, { q: "", a: "" }] });
  }
  function remove(i: number) {
    onChange({ ...props, items: items.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="rounded border border-ink-800 p-2">
          <input
            value={it.q}
            onChange={(e) => update(i, { q: e.target.value })}
            placeholder="Question"
            className={INPUT}
          />
          <textarea
            value={it.a}
            onChange={(e) => update(i, { a: e.target.value })}
            placeholder="Answer"
            rows={3}
            className={`${INPUT} mt-1`}
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 text-[11px] text-danger-400 hover:underline"
          >
            Remove item
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25"
      >
        + Add Q&amp;A
      </button>
    </div>
  );
}

function AccordionPreview({ props }: { props: Record<string, unknown> }) {
  const items = (props.items as AccordionEntry[] | undefined) ?? [];
  return (
    <div className="space-y-1">
      {items.map((it, i) => (
        <details key={i} className="rounded border border-ink-800 bg-ink-900 p-2">
          <summary className="cursor-pointer text-xs font-medium text-ink-100">
            {it.q || "Question"}
          </summary>
          <p className="mt-1 text-[11px] text-ink-400">{it.a}</p>
        </details>
      ))}
    </div>
  );
}

function VideoEditor({
  props,
  onChange,
}: {
  props: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        value={String(props.url ?? "")}
        onChange={(e) => onChange({ ...props, url: e.target.value })}
        placeholder="YouTube URL, Vimeo URL, or direct .mp4 link"
        className={INPUT}
      />
      <input
        value={String(props.caption ?? "")}
        onChange={(e) => onChange({ ...props, caption: e.target.value })}
        placeholder="Caption (optional)"
        className={INPUT}
      />
    </div>
  );
}

function VideoPreview({ props }: { props: Record<string, unknown> }) {
  const url = String(props.url ?? "");
  if (!url) {
    return (
      <div className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
        No video URL set.
      </div>
    );
  }
  return (
    <div className="rounded border border-ink-700 bg-ink-900 p-3 text-xs text-ink-300">
      <p className="font-medium text-ink-100">Video</p>
      <p className="truncate text-ink-500">{url}</p>
    </div>
  );
}

/**
 * Visual theme editor for a CMS site (sec 14.4).
 *
 * Theme tokens drive the look of the visitor-facing public site:
 *   • accent      — primary accent color (CTAs, links)
 *   • surface     — main page background
 *   • text        — body text color
 *   • headingFont — Google Fonts family for headings ("Inter", "Lora", etc)
 *   • bodyFont    — Google Fonts family for body
 *   • density     — "compact" | "comfortable" | "spacious"
 *   • radius      — corner radius scale: 0 (sharp) | 6 (default) | 12 (round)
 *
 * We persist these under `site.themeJson`. The renderer reads them at
 * page-render time and emits CSS custom properties on the page root,
 * which the rest of the public CSS picks up via `var(--cms-accent)` etc.
 *
 * The editor includes a live preview pane that mirrors the public
 * site's hero look, so changes are immediately visible without
 * republishing.
 */
interface ThemeTokens {
  accent: string;
  surface: string;
  text: string;
  headingFont: string;
  bodyFont: string;
  density: "compact" | "comfortable" | "spacious";
  radius: number;
}

const THEME_DEFAULTS: ThemeTokens = {
  accent: "#6366f1",
  surface: "#0a0c10",
  text: "#e6e7ea",
  headingFont: "Inter",
  bodyFont: "Inter",
  density: "comfortable",
  radius: 6,
};

const FONT_CHOICES = [
  "Inter",
  "Lora",
  "Roboto",
  "Roboto Slab",
  "Source Serif Pro",
  "Cinzel",
  "Cormorant Garamond",
  "Space Grotesk",
  "JetBrains Mono",
];

function ThemeTab({ site }: { site: CmsSite }) {
  const initial = useMemo(() => mergeTheme(site.themeJson), [site.themeJson]);
  const [theme, setTheme] = useState<ThemeTokens>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(theme) !== JSON.stringify(initial);

  function patch<K extends keyof ThemeTokens>(key: K, value: ThemeTokens[K]) {
    setTheme((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateCmsSite(site.id, { themeJson: theme as unknown as Record<string, unknown> });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setTheme(THEME_DEFAULTS);
  }

  return (
    <div className="grid h-full grid-cols-[360px_1fr] overflow-hidden">
      {/* ----- Left: controls ----- */}
      <aside className="overflow-y-auto border-r border-ink-800 bg-ink-900 p-4">
        <header className="mb-3">
          <h3 className="text-sm font-medium text-ink-100">Theme</h3>
          <p className="text-[11px] text-ink-500">
            Tokens drive every public page on this site. Save to publish
            them to visitors.
          </p>
        </header>

        <Section title="Colors">
          <ColorField
            label="Accent"
            value={theme.accent}
            onChange={(v) => patch("accent", v)}
            hint="Buttons, links, callouts."
          />
          <ColorField
            label="Surface"
            value={theme.surface}
            onChange={(v) => patch("surface", v)}
            hint="Page background."
          />
          <ColorField
            label="Text"
            value={theme.text}
            onChange={(v) => patch("text", v)}
            hint="Body copy."
          />
        </Section>

        <Section title="Typography">
          <Field label="Heading font">
            <select
              value={theme.headingFont}
              onChange={(e) => patch("headingFont", e.target.value)}
              className={INPUT}
            >
              {FONT_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Body font">
            <select
              value={theme.bodyFont}
              onChange={(e) => patch("bodyFont", e.target.value)}
              className={INPUT}
            >
              {FONT_CHOICES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Layout">
          <Field label="Density">
            <select
              value={theme.density}
              onChange={(e) =>
                patch("density", e.target.value as ThemeTokens["density"])
              }
              className={INPUT}
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </Field>
          <Field
            label={`Corner radius — ${theme.radius}px`}
            hint="0 = sharp · 12 = pillowy."
          >
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={theme.radius}
              onChange={(e) => patch("radius", Number(e.target.value))}
              className="block w-full"
            />
          </Field>
        </Section>

        {error && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save theme"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-700"
          >
            Reset to defaults
          </button>
          {saved && (
            <span className="self-center text-[11px] text-emerald-300">
              Saved.
            </span>
          )}
        </div>
      </aside>

      {/* ----- Right: live preview ----- */}
      <main className="overflow-y-auto bg-ink-950 p-6">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-500">
          Preview
        </p>
        <ThemePreview theme={theme} />
      </main>
    </div>
  );
}

function ThemePreview({ theme }: { theme: ThemeTokens }) {
  const padding =
    theme.density === "compact"
      ? "py-12 px-6"
      : theme.density === "spacious"
      ? "py-24 px-10"
      : "py-16 px-8";
  return (
    <div
      className="rounded border border-ink-800 shadow-xl"
      style={{
        background: theme.surface,
        color: theme.text,
        fontFamily: `'${theme.bodyFont}', system-ui, sans-serif`,
        borderRadius: theme.radius * 1.5,
      }}
    >
      <div className={`text-center ${padding}`}>
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: theme.accent }}
        >
          Studio · Sample page
        </p>
        <h1
          className="mt-3 text-4xl font-bold leading-tight"
          style={{ fontFamily: `'${theme.headingFont}', serif` }}
        >
          Forge cards. Tell stories.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base opacity-80">
          A taste of how the public site renders with the current theme
          tokens. Save to push these to visitors.
        </p>
        <a
          href="#"
          onClick={(e) => e.preventDefault()}
          className="mt-6 inline-block px-5 py-2.5 text-sm font-semibold"
          style={{
            background: theme.accent,
            color: pickContrastText(theme.accent),
            borderRadius: theme.radius,
          }}
        >
          View card collection
        </a>
        <div
          className="mx-auto mt-10 grid max-w-3xl grid-cols-3 gap-3 text-left"
          style={{ borderRadius: theme.radius }}
        >
          {["Cards", "Rules", "Lore"].map((t) => (
            <div
              key={t}
              className="border p-4"
              style={{
                borderColor: theme.accent + "33",
                background: "rgba(255,255,255,0.03)",
                borderRadius: theme.radius,
              }}
            >
              <p
                className="text-sm font-semibold"
                style={{ fontFamily: `'${theme.headingFont}', serif` }}
              >
                {t}
              </p>
              <p className="mt-1 text-xs opacity-70">
                A sample column rendered in the body font.
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Theme helpers                                                          */
/* ---------------------------------------------------------------------- */

function mergeTheme(json: unknown): ThemeTokens {
  if (!json || typeof json !== "object") return THEME_DEFAULTS;
  const j = json as Partial<ThemeTokens>;
  return {
    accent: typeof j.accent === "string" ? j.accent : THEME_DEFAULTS.accent,
    surface: typeof j.surface === "string" ? j.surface : THEME_DEFAULTS.surface,
    text: typeof j.text === "string" ? j.text : THEME_DEFAULTS.text,
    headingFont:
      typeof j.headingFont === "string" ? j.headingFont : THEME_DEFAULTS.headingFont,
    bodyFont:
      typeof j.bodyFont === "string" ? j.bodyFont : THEME_DEFAULTS.bodyFont,
    density:
      j.density === "compact" || j.density === "spacious"
        ? j.density
        : THEME_DEFAULTS.density,
    radius: typeof j.radius === "number" ? j.radius : THEME_DEFAULTS.radius,
  };
}

/** Pick black or white text based on the background's luminance, so
 *  buttons stay readable regardless of accent choice. */
function pickContrastText(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return "#ffffff";
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? "#0a0c10" : "#ffffff";
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-ink-400">{title}</p>
      {children}
    </section>
  );
}

function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-[11px] uppercase tracking-wider text-ink-400">
        <span>{label}</span>
        {hint && <span className="text-[10px] normal-case text-ink-500">{hint}</span>}
      </span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT} flex-1 font-mono`}
        />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentation helpers
// ---------------------------------------------------------------------------

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}
