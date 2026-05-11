import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPublicCard,
  fetchPublicCards,
  fetchPublicFactions,
  fetchPublicSets,
  publicAssetUrl,
} from "@/public/publicApi";
import type { CardTypeTemplate } from "@/types";
import type { Card, Faction } from "@/lib/apiTypes";
import { CardRender } from "@/components/CardRender";
import {
  fetchPublicCmsForm,
  fetchPublicCmsPage,
  fetchPublicCmsSite,
  submitPublicCmsForm,
  type CmsBlock,
  type CmsFormField,
  type PublicCmsForm,
  type PublicCmsPageResponse,
  type PublicCmsSiteResponse,
} from "@/lib/api";

/**
 * Public read-only card gallery (sec 15).
 *
 * Mounts pre-auth: anyone visiting `/public/:tenantSlug` lands here, no
 * login required. The gallery hits the public API endpoints to render a
 * tenant's released cards with the same SVG renderer the designer uses.
 *
 * Routes:
 *   /public/:tenantSlug                     → grid + filters
 *   /public/:tenantSlug/cards/:cardSlug    → card detail
 *
 * URL state is owned by the browser (history.pushState). We parse on
 * mount + on every popstate. For the small number of states the gallery
 * has, a tiny route-by-pathname switcher is plenty — no need for a full
 * router dependency.
 */
type PublicRoute =
  | { kind: "home" }
  | { kind: "grid" }
  | { kind: "card"; slug: string }
  | { kind: "page"; slug: string };

/**
 * Public tenant site. Mounts in two contexts:
 *
 *   • Path mode (`pathPrefix="/public/<tenant>"`): visitors land via
 *     `/public/<tenant>` on any host. Path-based routing — works on
 *     localhost and dev URLs that don't have host-based tenant
 *     resolution.
 *
 *   • Host mode (`pathPrefix=""`): visitors land at the tenant's
 *     subdomain root (`<tenant>.tcgstudio.local/`). The tenant slug
 *     comes from the host parser, paths are bare ("/", "/cards/...",
 *     "/p/...").
 *
 * The internal routes are the same shape in both modes; only the
 * URL prefix differs. Pass `""` for host mode and the existing
 * `/public/<slug>` for path mode.
 */
export function PublicGallery({
  tenantSlug,
  pathPrefix,
}: {
  tenantSlug: string;
  pathPrefix?: string;
}) {
  const prefix = pathPrefix ?? `/public/${tenantSlug}`;
  const [route, setRoute] = useState<PublicRoute>(parseRoute(prefix));

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(prefix));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [prefix]);

  const navigate = useCallback(
    (next: PublicRoute) => {
      const base = prefix || "";
      const path =
        next.kind === "home"
          ? base || "/"
          : next.kind === "grid"
          ? `${base}/cards`
          : next.kind === "card"
          ? `${base}/cards/${encodeURIComponent(next.slug)}`
          : `${base}/p/${encodeURIComponent(next.slug)}`;
      window.history.pushState({}, "", path);
      setRoute(next);
      window.scrollTo({ top: 0 });
    },
    [prefix],
  );

  if (route.kind === "card") {
    return <PublicCardDetail tenantSlug={tenantSlug} cardSlug={route.slug} navigate={navigate} />;
  }
  if (route.kind === "page") {
    return <PublicCmsPageView tenantSlug={tenantSlug} pageSlug={route.slug} navigate={navigate} />;
  }
  if (route.kind === "home") {
    return <PublicHome tenantSlug={tenantSlug} navigate={navigate} />;
  }
  return <PublicCardGrid tenantSlug={tenantSlug} navigate={navigate} />;
}

function parseRoute(prefix: string): PublicRoute {
  const path = window.location.pathname;
  const stripped = path.replace(prefix, "").replace(/\/$/, "");
  const cardMatch = stripped.match(/^\/cards\/([^/]+)/);
  if (cardMatch) return { kind: "card", slug: decodeURIComponent(cardMatch[1]) };
  const pageMatch = stripped.match(/^\/p\/([^/]+)/);
  if (pageMatch) return { kind: "page", slug: decodeURIComponent(pageMatch[1]) };
  if (stripped === "/cards") return { kind: "grid" };
  return { kind: "home" };
}

/* ====================================================================== */
/* Grid                                                                    */
/* ====================================================================== */

function PublicCardGrid({
  tenantSlug,
  navigate,
}: {
  tenantSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [tenantName, setTenantName] = useState<string>(tenantSlug);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [sets, setSets] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [search, setSearch] = useState("");
  const [factionFilter, setFactionFilter] = useState<string>("");
  const [setFilter, setSetFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchPublicCards(tenantSlug),
      fetchPublicSets(tenantSlug).catch(() => ({ sets: [] })),
      fetchPublicFactions(tenantSlug).catch(() => ({ factions: [] })),
    ])
      .then(([cardsRes, setsRes, factionsRes]) => {
        if (cancelled) return;
        // The public API casts dataJson to unknown; cast back here so
        // CardRender (which reads dataJson via Record<string, unknown>)
        // can use the shape directly.
        setCards(cardsRes.cards as unknown as Card[]);
        setTenantName(cardsRes.tenant.name);
        setSets(setsRes.sets);
        setFactions(factionsRes.factions);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  // Apply filters client-side. The public API supports server-side
  // filters but the gallery's responsive UX wants instant feedback as
  // the user types — fetching once and filtering in-memory is the best
  // tradeoff for the small datasets this view ships.
  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (setFilter && c.setId !== setFilter) return false;
      if (factionFilter) {
        const f = (c.dataJson as Record<string, unknown> | null)?.faction;
        const fs = (c.dataJson as Record<string, unknown> | null)?.factions;
        const matchesMono = typeof f === "string" && f === factionFilter;
        const matchesMulti =
          Array.isArray(fs) && (fs as unknown[]).some((s) => s === factionFilter);
        if (!matchesMono && !matchesMulti) return false;
      }
      if (q) {
        if (
          !c.name.toLowerCase().includes(q) &&
          !c.slug.toLowerCase().includes(q) &&
          !JSON.stringify(c.dataJson ?? {}).toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [cards, search, setFilter, factionFilter]);

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <PublicHeader tenantName={tenantName} subtitle="Card gallery" />
      <div className="mx-auto max-w-7xl px-6 py-6">
        {error ? (
          <div className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        ) : (
          <>
            <header className="mb-5 flex flex-wrap items-end gap-3">
              <div className="flex-1">
                <h1 className="text-xl font-semibold text-ink-50">Cards</h1>
                <p className="mt-1 text-xs text-ink-400">
                  {cards === null
                    ? "Loading…"
                    : `${filtered.length} of ${cards.length} card${cards.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-9 w-56 rounded border border-ink-700 bg-ink-900 px-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
              />
              <select
                value={setFilter}
                onChange={(e) => setSetFilter(e.target.value)}
                className="h-9 rounded border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100"
              >
                <option value="">All sets</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
              <select
                value={factionFilter}
                onChange={(e) => setFactionFilter(e.target.value)}
                className="h-9 rounded border border-ink-700 bg-ink-900 px-2 text-sm text-ink-100"
              >
                <option value="">All factions</option>
                {factions.map((f) => (
                  <option key={f.id} value={f.slug}>
                    {f.name}
                  </option>
                ))}
              </select>
            </header>

            {cards === null ? (
              <p className="py-10 text-center text-sm text-ink-500">Loading cards…</p>
            ) : filtered.length === 0 ? (
              <p className="rounded border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-500">
                {cards.length === 0
                  ? "No published cards yet — come back soon."
                  : "No cards match the current filters."}
              </p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
                {filtered.map((c) => (
                  <li
                    key={c.id}
                    className="group cursor-pointer rounded-lg border border-ink-700 bg-ink-900 p-3 transition-colors hover:border-accent-500/40"
                    onClick={() => navigate({ kind: "card", slug: c.slug })}
                  >
                    <div className="flex flex-col items-center gap-2">
                      <PublicCardThumb tenantSlug={tenantSlug} card={c} />
                      <div className="w-full">
                        <p className="truncate text-sm font-medium text-ink-50" title={c.name}>
                          {c.name}
                        </p>
                        <p className="truncate font-mono text-[10px] text-ink-500">
                          {c.rarity ?? "—"}
                          {c.collectorNumber ? ` · #${c.collectorNumber}` : ""}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <PublicFooter />
    </div>
  );
}

/* ====================================================================== */
/* Card detail                                                             */
/* ====================================================================== */

function PublicCardDetail({
  tenantSlug,
  cardSlug,
  navigate,
}: {
  tenantSlug: string;
  cardSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchPublicCard>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void fetchPublicCard(tenantSlug, cardSlug)
      .then((r) => !cancelled && setData(r))
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, cardSlug]);

  const tenantName = "Public gallery";

  if (error) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100">
        <PublicHeader tenantName={tenantName} subtitle="Card not found" />
        <div className="mx-auto max-w-3xl px-6 py-10 text-center">
          <p className="text-sm text-danger-500">{error}</p>
          <button
            type="button"
            onClick={() => navigate({ kind: "grid" })}
            className="mt-4 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
          >
            ← Back to gallery
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100">
        <PublicHeader tenantName={tenantName} subtitle="Loading…" />
      </div>
    );
  }

  const template = parseTemplateContent(data.template?.contentJson);
  const dataJson = (data.card.dataJson as Record<string, unknown> | null) ?? {};

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <PublicHeader tenantName={tenantName} subtitle={data.card.name} />
      <div className="mx-auto grid max-w-5xl grid-cols-[auto_1fr] gap-8 px-6 py-8">
        <div className="flex justify-center">
          {template ? (
            <CardRender
              template={template}
              data={dataJson}
              width={400}
              resolveAssetId={(id) => publicAssetUrl(tenantSlug, id)}
            />
          ) : (
            <div className="flex h-[560px] w-[400px] items-center justify-center rounded border border-dashed border-ink-700 text-sm text-ink-500">
              No template available
            </div>
          )}
        </div>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => navigate({ kind: "grid" })}
            className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100"
          >
            ← Back to gallery
          </button>
          <h1 className="text-2xl font-semibold text-ink-50">{data.card.name}</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
            {data.card.rarity && (
              <span className="rounded bg-ink-800 px-2 py-0.5 font-mono uppercase tracking-wider text-ink-300">
                {data.card.rarity}
              </span>
            )}
            {data.card.collectorNumber != null && (
              <span className="font-mono text-ink-500">#{data.card.collectorNumber}</span>
            )}
            {data.cardType?.name && <span>· {data.cardType.name}</span>}
          </div>

          <dl className="space-y-2 rounded border border-ink-700 bg-ink-900 p-4 text-xs">
            {Object.entries(dataJson).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] gap-3">
                <dt className="text-[10px] uppercase tracking-wider text-ink-500">{k}</dt>
                <dd className="text-ink-200">
                  {typeof v === "string"
                    ? v
                    : Array.isArray(v)
                    ? (v as unknown[]).join(", ")
                    : v == null
                    ? "—"
                    : JSON.stringify(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}

/* ====================================================================== */
/* Bits                                                                    */
/* ====================================================================== */

/** Inline thumbnail card render — used in the grid. */
function PublicCardThumb({ tenantSlug: _tenantSlug, card }: { tenantSlug: string; card: Card }) {
  // The grid doesn't (yet) lazily fetch each card's full template. To
  // keep the listing snappy we render a simple preview tile — a colored
  // box keyed off rarity. A future enhancement: have the cards listing
  // endpoint embed a small thumbnail URL or pre-rendered tile.
  return (
    <div className="aspect-[5/7] w-full rounded border border-ink-700 bg-ink-950 p-2 text-center">
      <div className="flex h-full w-full flex-col items-center justify-center rounded bg-gradient-to-br from-accent-500/10 to-ink-900 p-2">
        <p className="text-xs font-semibold text-accent-300">{card.name}</p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{card.rarity ?? ""}</p>
      </div>
    </div>
  );
}

function PublicHeader({ tenantName, subtitle }: { tenantName: string; subtitle: string }) {
  return (
    <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ink-500">{tenantName}</p>
          <h1 className="text-lg font-semibold text-ink-50">{subtitle}</h1>
        </div>
        <p className="text-[11px] text-ink-500">Powered by TCGStudio</p>
      </div>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="mt-10 border-t border-ink-700 px-6 py-6 text-center text-[11px] text-ink-500">
      Card data and artwork © their respective rights holders.
    </footer>
  );
}

/**
 * Coerce the template's `contentJson` (typed as `unknown` from the
 * public API for safety) into the `CardTypeTemplate` shape the renderer
 * expects. Returns null when the blob is missing or wrong shape.
 */
function parseTemplateContent(content: unknown): CardTypeTemplate | null {
  if (!content || typeof content !== "object") return null;
  const c = content as CardTypeTemplate;
  if (!Array.isArray(c.layers) || !c.size || !c.size.width) return null;
  return c;
}

/* ====================================================================== */
/* CMS-driven home page                                                    */
/* ====================================================================== */

/**
 * Tenant home — surfaces a CMS site if one is published, falling back
 * to the legacy gallery grid. We try /cms/site first; a 404 there means
 * "no public CMS site" and we redirect to the grid.
 *
 * If the CMS site has a published page with slug "home", we render it.
 * Otherwise we render a list of available pages so visitors can pick one.
 */
function PublicHome({
  tenantSlug,
  navigate,
}: {
  tenantSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  const [site, setSite] = useState<PublicCmsSiteResponse | null>(null);
  const [home, setHome] = useState<PublicCmsPageResponse | null>(null);
  const [resolving, setResolving] = useState(true);
  const [hasCms, setHasCms] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await fetchPublicCmsSite(tenantSlug);
        if (!alive) return;
        setSite(s);
        setHasCms(true);
        try {
          const lang = new URLSearchParams(window.location.search).get("lang") ?? undefined;
          const homePage = await fetchPublicCmsPage(
            tenantSlug,
            "home",
            undefined,
            lang ?? undefined,
          );
          if (!alive) return;
          setHome(homePage);
        } catch {
          /* no home page — fall through to page list */
        }
      } catch {
        /* no CMS site — fall back to gallery grid */
        setHasCms(false);
      } finally {
        if (alive) setResolving(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  if (resolving) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-300">
        <div className="mx-auto max-w-7xl px-6 py-10 text-sm text-ink-500">
          Loading…
        </div>
      </div>
    );
  }

  // No CMS site at all — every tenant deserves a real landing, not a
  // bare card grid. Show a branded welcome that surfaces the tenant
  // name, links to their cards, and (for owners) points at /admin
  // where they can set up a proper CMS-driven site.
  if (!hasCms) {
    return <TenantDefaultLanding tenantSlug={tenantSlug} navigate={navigate} />;
  }

  const tenantName = site?.tenant.name ?? tenantSlug;
  const siteName = site?.site.name ?? "Public site";

  // We have a CMS site AND a home page — render the home page. The
  // header reuses the CMS site name so branding stays consistent.
  if (home) {
    return (
      <PublicSiteShell
        tenantSlug={tenantSlug}
        tenantName={tenantName}
        siteName={siteName}
        site={site}
        navigate={navigate}
        locale={home.locale}
        supportedLocales={home.tenant.supportedLocales}
      >
        <article className="mx-auto max-w-3xl px-6 py-10">
          <h1 className="mb-6 text-3xl font-semibold text-ink-50">
            {home.page.title}
          </h1>
          <CmsBlocksRenderer blocks={home.page.publishedJson?.blocks ?? []} tenantSlug={tenantSlug} />
        </article>
      </PublicSiteShell>
    );
  }

  // CMS site but no home page — list available pages so visitors aren't
  // stuck at an empty front door.
  return (
    <PublicSiteShell
      tenantSlug={tenantSlug}
      tenantName={tenantName}
      siteName={siteName}
      site={site}
      navigate={navigate}
    >
      <section className="mx-auto max-w-3xl px-6 py-10">
        <p className="mb-3 text-sm text-ink-400">
          Welcome — pick a page to get started.
        </p>
        <ul className="space-y-2">
          {(site?.pages ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate({ kind: "page", slug: p.slug })}
                className="w-full rounded border border-ink-700 bg-ink-900 px-4 py-3 text-left hover:border-accent-500/40 hover:bg-accent-500/5"
              >
                <p className="font-medium text-ink-100">{p.title}</p>
                {p.seoDescription && (
                  <p className="mt-1 text-[12px] text-ink-400">
                    {p.seoDescription}
                  </p>
                )}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => navigate({ kind: "grid" })}
              className="w-full rounded border border-ink-700 bg-ink-900 px-4 py-3 text-left hover:border-accent-500/40 hover:bg-accent-500/5"
            >
              <p className="font-medium text-ink-100">Browse all cards</p>
              <p className="mt-1 text-[12px] text-ink-400">
                Search and filter the public card database.
              </p>
            </button>
          </li>
        </ul>
      </section>
    </PublicSiteShell>
  );
}

function PublicCmsPageView({
  tenantSlug,
  pageSlug,
  navigate,
}: {
  tenantSlug: string;
  pageSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  const [page, setPage] = useState<PublicCmsPageResponse | null>(null);
  const [site, setSite] = useState<PublicCmsSiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const lang = new URLSearchParams(window.location.search).get("lang") ?? undefined;
        const [p, s] = await Promise.all([
          fetchPublicCmsPage(tenantSlug, pageSlug, undefined, lang ?? undefined),
          fetchPublicCmsSite(tenantSlug).catch(() => null),
        ]);
        if (!alive) return;
        setPage(p);
        setSite(s);
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug, pageSlug]);

  if (error) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-300">
        <PublicHeader tenantName={tenantSlug} subtitle="Page not found" />
        <div className="mx-auto max-w-3xl px-6 py-10">
          <p className="text-sm text-danger-400">{error}</p>
          <button
            type="button"
            onClick={() => navigate({ kind: "home" })}
            className="mt-4 rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs text-ink-200 hover:bg-ink-800"
          >
            ← Back to home
          </button>
        </div>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-300">
        <PublicHeader tenantName={tenantSlug} subtitle="Loading…" />
      </div>
    );
  }
  return (
    <PublicSiteShell
      tenantSlug={tenantSlug}
      tenantName={page.tenant.name}
      siteName={site?.site.name ?? page.site.name}
      site={site}
      navigate={navigate}
      locale={page.locale}
      supportedLocales={page.tenant.supportedLocales}
    >
      <article className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-6 text-3xl font-semibold text-ink-50">
          {page.page.title}
        </h1>
        <CmsBlocksRenderer
          blocks={page.page.publishedJson?.blocks ?? []}
          tenantSlug={tenantSlug}
        />
      </article>
    </PublicSiteShell>
  );
}

function PublicSiteShell({
  tenantSlug,
  tenantName,
  siteName,
  site,
  navigate,
  children,
  /** When the page hands us tenant locale info, the shell renders a
   *  language switcher in the header. Optional — gallery / card-detail
   *  pages don't have this and just skip it. */
  locale,
  supportedLocales,
}: {
  tenantSlug: string;
  tenantName: string;
  siteName: string;
  site: PublicCmsSiteResponse | null;
  navigate: (n: PublicRoute) => void;
  children: React.ReactNode;
  locale?: string;
  supportedLocales?: string[];
}) {
  const headerNav = site?.navigations.find((n) => n.placement === "header");
  return (
    <div className="min-h-screen bg-ink-950 text-ink-200">
      <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <button
            type="button"
            onClick={() => navigate({ kind: "home" })}
            className="text-left"
          >
            <p className="text-[10px] uppercase tracking-widest text-ink-500">
              {tenantName}
            </p>
            <h1 className="text-lg font-semibold text-ink-50">{siteName}</h1>
          </button>
          <nav className="flex items-center gap-4 text-xs text-ink-300">
            {headerNav?.itemsJson.items.map((item) => (
              <NavLinkButton
                key={item.id}
                item={item}
                tenantSlug={tenantSlug}
                navigate={navigate}
              />
            ))}
            <button
              type="button"
              onClick={() => navigate({ kind: "grid" })}
              className="hover:text-ink-100"
            >
              Cards
            </button>
            {supportedLocales && supportedLocales.length > 1 && (
              <LanguageSwitcher
                locale={locale}
                supportedLocales={supportedLocales}
              />
            )}
          </nav>
        </div>
      </header>
      {children}
      <PublicFooter />
    </div>
  );
}

/**
 * Tiny `<select>` that swaps the page's locale by re-loading with a
 * `?lang=` query param. We intentionally skip SPA in-place re-fetches
 * here — full page reload is fine for a language change, plays nicely
 * with browser caches, and keeps the URL shareable (a French visitor
 * sending the URL to a friend gets the same French content).
 */
function LanguageSwitcher({
  locale,
  supportedLocales,
}: {
  locale?: string;
  supportedLocales: string[];
}) {
  const current = locale ?? supportedLocales[0];
  function pick(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    window.location.href = url.toString();
  }
  return (
    <select
      value={current}
      onChange={(e) => pick(e.target.value)}
      title="Language"
      className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-800"
    >
      {supportedLocales.map((tag) => (
        <option key={tag} value={tag}>
          {tag}
        </option>
      ))}
    </select>
  );
}

function NavLinkButton({
  item,
  tenantSlug,
  navigate,
}: {
  item: { id: string; label: string; kind: string; target?: string; slug?: string };
  tenantSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  if (item.kind === "url" && item.target) {
    return (
      <a
        href={item.target}
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink-100"
      >
        {item.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        if (item.kind === "gallery") navigate({ kind: "grid" });
        else if (item.kind === "page" && item.slug)
          navigate({ kind: "page", slug: item.slug });
      }}
      className="hover:text-ink-100"
      title={`Tenant: ${tenantSlug}`}
    >
      {item.label}
    </button>
  );
}

/**
 * Walk a CMS block tree and render each block. Unknown block types are
 * shown as a small placeholder so editors can spot them without breaking
 * the page.
 */
function CmsBlocksRenderer({
  blocks,
  tenantSlug,
}: {
  blocks: CmsBlock[];
  tenantSlug: string;
}) {
  return (
    <div className="space-y-5">
      {blocks.map((b) => (
        <CmsBlockRenderer key={b.id} block={b} tenantSlug={tenantSlug} />
      ))}
    </div>
  );
}

function CmsBlockRenderer({
  block,
  tenantSlug,
}: {
  block: CmsBlock;
  tenantSlug: string;
}) {
  const props = block.props ?? {};
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(props.level ?? 1), 1), 4);
      const text = String(props.text ?? "");
      const cls =
        level === 1
          ? "text-3xl font-semibold text-ink-50"
          : level === 2
          ? "text-2xl font-semibold text-ink-100"
          : level === 3
          ? "text-xl font-medium text-ink-100"
          : "text-lg font-medium text-ink-200";
      // Render as a div with role="heading" to avoid TS gymnastics around
      // dynamic JSX tag names; visual hierarchy is still preserved via cls.
      return (
        <div role="heading" aria-level={level} className={cls}>
          {text}
        </div>
      );
    }
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink-200">
          {String(props.text ?? "")}
        </p>
      );
    case "image": {
      const src = String(props.src ?? "");
      if (!src) return null;
      return (
        <figure className="space-y-1">
          <img
            src={src}
            alt={String(props.alt ?? "")}
            className="max-h-[60vh] w-full rounded object-contain"
          />
          {props.caption ? (
            <figcaption className="text-center text-sm text-ink-500">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "asset_image": {
      const assetId = String(props.assetId ?? "");
      if (!assetId) return null;
      // Public blob URL — only resolves for visibility=public assets.
      // Misconfigured assets show a broken image; the editor warns about
      // this when picking a non-public asset.
      const src = publicAssetUrl(tenantSlug, assetId);
      return (
        <figure className="space-y-1">
          <img
            src={src}
            alt={String(props.alt ?? "")}
            className="max-h-[60vh] w-full rounded object-contain"
          />
          {props.caption ? (
            <figcaption className="text-center text-sm text-ink-500">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "divider":
      return <hr className="border-ink-700" />;
    case "button":
      return (
        <a
          href={String(props.href ?? "#")}
          className="inline-block rounded border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 hover:bg-accent-500/25"
        >
          {String(props.label ?? "Read more")}
        </a>
      );
    case "card_gallery":
      return (
        <CmsCardGalleryBlock
          tenantSlug={tenantSlug}
          factionSlug={String(props.factionSlug ?? "")}
          setCode={String(props.setCode ?? "")}
          limit={Number(props.limit ?? 12)}
        />
      );
    case "form": {
      const formSlug = String(props.formSlug ?? "");
      if (!formSlug) {
        return (
          <div className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
            Form block has no slug configured.
          </div>
        );
      }
      return <CmsFormBlock tenantSlug={tenantSlug} formSlug={formSlug} />;
    }
    default:
      return (
        <div className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
          Unknown block "{block.type}"
        </div>
      );
  }
}

function CmsCardGalleryBlock({
  tenantSlug,
  factionSlug,
  setCode,
  limit,
}: {
  tenantSlug: string;
  factionSlug: string;
  setCode: string;
  limit: number;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchPublicCards(tenantSlug, {});
        if (!alive) return;
        let filtered = r.cards as unknown as Card[];
        if (factionSlug) {
          filtered = filtered.filter((c) => {
            const f = (c.dataJson as { faction?: string } | null)?.faction;
            return typeof f === "string" && f === factionSlug;
          });
        }
        if (setCode) {
          filtered = filtered.filter((c) => c.setId === setCode);
        }
        setCards(filtered.slice(0, Math.max(1, limit)));
      } catch {
        if (alive) setCards([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug, factionSlug, setCode, limit]);

  if (cards === null) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-4 text-sm text-ink-400">
        Loading cards…
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-4 text-sm text-ink-400">
        No cards match this gallery's filters.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {cards.map((c) => (
        <PublicCardThumb key={c.id} tenantSlug={tenantSlug} card={c} />
      ))}
    </div>
  );
}

/* ====================================================================== */
/* Default tenant landing — shown when no CMS site exists yet             */
/* ====================================================================== */

/**
 * Empty-state landing for a tenant who hasn't set up their CMS yet.
 * Visitors get a styled welcome with the tenant name, a "Browse cards"
 * CTA pointing at the gallery, and (for owners) a quiet "set up your
 * public site" link to /admin/cms.
 *
 * Pulls the tenant's name + branding from the public cards endpoint
 * because we don't have a dedicated "tenant info" public route — and
 * cards is a cheap fetch that already returns branding inline.
 */
function TenantDefaultLanding({
  tenantSlug,
  navigate,
}: {
  tenantSlug: string;
  navigate: (n: PublicRoute) => void;
}) {
  const [tenantName, setTenantName] = useState(tenantSlug);
  const [cardCount, setCardCount] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchPublicCards(tenantSlug)
      .then((r) => {
        if (!alive) return;
        setTenantName(r.tenant.name);
        setCardCount(r.cards.length);
      })
      .catch(() => {
        /* tenant might not exist yet — keep slug as the name */
      });
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <PublicHeader tenantName={tenantName} subtitle="Public site" />
      <section className="relative overflow-hidden border-b border-ink-700">
        <div
          className="absolute inset-0 opacity-50"
          aria-hidden="true"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 30%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
            backgroundSize: "auto, 14px 14px",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6 py-20 text-center md:py-28">
          <p className="text-[11px] uppercase tracking-widest text-accent-400">
            Welcome to
          </p>
          <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight text-ink-50 md:text-5xl">
            {tenantName}
          </h1>
          <p className="mt-4 text-base text-ink-300">
            {cardCount > 0
              ? `Explore the card collection — ${cardCount} card${cardCount === 1 ? "" : "s"} published.`
              : "This studio is just getting started."}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ kind: "grid" })}
              className="rounded-md bg-accent-500 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-400"
            >
              Browse cards →
            </button>
            <a
              href="/admin"
              className="rounded-md border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm font-medium text-ink-200 hover:bg-ink-800"
            >
              Studio admin
            </a>
          </div>
        </div>
      </section>
      <section className="bg-ink-900/30">
        <div className="mx-auto max-w-3xl px-6 py-14 text-center text-sm text-ink-400">
          <p className="font-medium text-ink-200">
            Are you the owner of this tenant?
          </p>
          <p className="mt-2">
            Set up your public site through the CMS — sign into{" "}
            <a href="/admin" className="text-accent-300 hover:underline">
              /admin
            </a>{" "}
            and create a site under <strong>Public site</strong>. A published
            page with slug <code className="font-mono">home</code> replaces
            this default copy.
          </p>
        </div>
      </section>
      <PublicFooter />
    </div>
  );
}

/* ====================================================================== */
/* Form block — public submission UI                                       */
/* ====================================================================== */

/**
 * Renders a CMS form on the public site. Loads the form definition,
 * draws inputs per field kind, posts to the public submit endpoint,
 * shows the configured success message on 201.
 *
 * Per-field validation is intentionally light here — the server is the
 * source of truth (see /api/public/.../submit). Client-side hints save
 * a round-trip in the obvious cases but never block what the server
 * would accept.
 */
function CmsFormBlock({
  tenantSlug,
  formSlug,
}: {
  tenantSlug: string;
  formSlug: string;
}) {
  const [form, setForm] = useState<PublicCmsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicCmsForm(tenantSlug, formSlug)
      .then((f) => {
        if (alive) setForm(f);
      })
      .catch((err) => {
        if (alive)
          setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [tenantSlug, formSlug]);

  if (loadError) {
    return (
      <div className="rounded border border-danger-500/30 bg-danger-500/10 p-3 text-xs text-danger-400">
        Couldn't load form "{formSlug}": {loadError}
      </div>
    );
  }
  if (!form) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-3 text-sm text-ink-400">
        Loading form…
      </div>
    );
  }
  if (success) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        {success}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.settingsJson?.requireConsent && !consent) {
      setError("Please agree to the consent terms before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await submitPublicCmsForm(tenantSlug, formSlug, values);
      setSuccess(r.successMessage);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Submission failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded border border-ink-700 bg-ink-900 p-4"
    >
      <div>
        <h3 className="text-base font-medium text-ink-100">{form.name}</h3>
        {form.description && (
          <p className="mt-1 text-xs text-ink-400">{form.description}</p>
        )}
      </div>
      {(form.fieldsJson?.fields ?? []).map((f) => (
        <CmsFormFieldRenderer
          key={f.id}
          field={f}
          value={values[f.name]}
          onChange={(v) => setValues({ ...values, [f.name]: v })}
        />
      ))}
      {/* Honeypot — visible to bots that fill every input, hidden from
          real users. Submit handler on the server silently swallows
          anything that has a value here. */}
      <input
        type="text"
        name="_hp"
        autoComplete="off"
        tabIndex={-1}
        onChange={(e) => setValues({ ...values, _hp: e.target.value })}
        className="hidden"
        aria-hidden="true"
      />
      {form.settingsJson?.requireConsent && (
        <label className="flex items-start gap-2 text-xs text-ink-300">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {form.settingsJson?.consentLabel ??
              "I agree to the terms and privacy policy."}
          </span>
        </label>
      )}
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Submit"}
      </button>
    </form>
  );
}

function CmsFormFieldRenderer({
  field,
  value,
  onChange,
}: {
  field: CmsFormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const baseInputClass =
    "block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";
  const stringValue = typeof value === "string" ? value : "";

  let control: React.ReactNode;
  switch (field.kind) {
    case "longtext":
      control = (
        <textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          rows={4}
          className={baseInputClass}
        />
      );
      break;
    case "number":
      control = (
        <input
          type="number"
          value={
            typeof value === "number"
              ? value
              : value === undefined
              ? ""
              : Number(value)
          }
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          className={baseInputClass}
        />
      );
      break;
    case "email":
      control = (
        <input
          type="email"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
      break;
    case "url":
      control = (
        <input
          type="url"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
      break;
    case "phone":
      control = (
        <input
          type="tel"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
      break;
    case "date":
      control = (
        <input
          type="date"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className={baseInputClass}
        />
      );
      break;
    case "checkbox":
      control = (
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
      break;
    case "select":
      control = (
        <select
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className={baseInputClass}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "multiselect": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      control = (
        <div className="space-y-1">
          {(field.options ?? []).map((o) => (
            <label
              key={o.value}
              className="flex items-center gap-2 text-sm text-ink-200"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, o.value]
                    : selected.filter((v) => v !== o.value);
                  onChange(next);
                }}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
      break;
    }
    default:
      control = (
        <input
          type="text"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          pattern={field.pattern}
          className={baseInputClass}
        />
      );
  }

  // Checkboxes already include their own label, so don't wrap them.
  if (field.kind === "checkbox") {
    return <div>{control}</div>;
  }

  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-ink-300">
        {field.label}
        {field.required && <span className="text-danger-400"> *</span>}
      </span>
      {control}
      {field.helpText && (
        <span className="block text-[11px] text-ink-500">{field.helpText}</span>
      )}
    </label>
  );
}
