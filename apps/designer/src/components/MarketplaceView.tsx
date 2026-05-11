/**
 * Marketplace view (sec 35).
 *
 * Three tabs:
 *   • Browse        — discovery: search + category filter + package tiles.
 *                     Clicking a tile opens the detail drawer.
 *   • My installs   — packages this tenant has installed, with disable
 *                     and uninstall actions.
 *   • Author        — publisher onboarding + listing of packages this
 *                     tenant has authored. Gated behind the
 *                     `publicMarketplacePublishing` plan feature for
 *                     scope=platform packages, but every tenant can
 *                     create scope=tenant private packages for itself.
 *
 * Cards bind to the live `/api/v1/marketplace/...` endpoints. The
 * install button writes through to the API; success bumps the local
 * list state.
 */

import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import {
  createMarketplacePackage,
  deleteMarketplacePackage,
  getMarketplacePackage,
  getMarketplacePublisher,
  installMarketplacePackage,
  listMarketplaceInstalls,
  listMarketplacePackages,
  listMyMarketplacePackages,
  publishMarketplaceVersion,
  reviewMarketplacePackage,
  uninstallMarketplacePackage,
  updateMarketplacePackage,
  upsertMarketplacePublisher,
  type MarketplaceInstall,
  type MarketplaceKind,
  type MarketplacePackage,
  type MarketplacePublisher,
} from "@/lib/api";

const KIND_LABELS: Record<string, string> = {
  plugin: "Plugin",
  exporter: "Exporter",
  cms_theme: "CMS theme",
  cms_block_pack: "CMS blocks",
  frame_pack: "Frame pack",
  icon_pack: "Icon pack",
  font_pack: "Font pack",
  starter_kit: "Starter kit",
  rules_pack: "Rules pack",
  keyword_pack: "Keyword pack",
  ability_pack: "Ability pack",
  board_layout: "Board layout",
  print_profile: "Print profile",
  pack_generator: "Pack generator",
  // Infrastructure providers — installed plugins can register a
  // provider implementation that the Settings dropdowns then list
  // as a selectable option (sec 8 / 42 / 43).
  email_provider: "Email provider",
  storage_provider: "Storage provider",
  payment_processor: "Payment processor",
};

const KIND_OPTIONS: Array<MarketplaceKind | "all"> = [
  "all",
  "plugin",
  "exporter",
  "cms_theme",
  "cms_block_pack",
  "frame_pack",
  "icon_pack",
  "font_pack",
  "starter_kit",
  "rules_pack",
  "keyword_pack",
  "ability_pack",
  "board_layout",
  "print_profile",
  "pack_generator",
  "email_provider",
  "storage_provider",
  "payment_processor",
];

export function MarketplaceView() {
  // The "themes" tab is a pre-filtered slice of Browse with a tighter
  // header copy that nudges users toward "submit a theme". Surfaces
  // a dedicated experience without duplicating Browse — the underlying
  // tile list is reused.
  const [tab, setTab] = useState<
    "browse" | "themes" | "installed" | "author"
  >("browse");
  // Lets the Themes tab CTA jump into Author mode with a pre-selected
  // cms_theme kind so users don't have to scroll a 14-option dropdown
  // to submit a theme.
  const [authorPrefillKind, setAuthorPrefillKind] = useState<string | null>(null);

  function tabLabel(k: typeof tab) {
    return (
      {
        browse: "Browse",
        themes: "Themes",
        installed: "Installed",
        author: "Author",
      } as const
    )[k];
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <h1 className="text-sm font-medium text-ink-100">Marketplace</h1>
          <p className="text-[11px] text-ink-500">
            Plugins, themes, asset packs, and starter kits — install in one click
            or publish your own.
          </p>
        </div>
        <nav className="flex gap-1 rounded border border-ink-800 bg-ink-950 p-1 text-xs">
          {(["browse", "themes", "installed", "author"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={[
                "rounded px-3 py-1 transition-colors",
                tab === k
                  ? "bg-accent-500/20 text-accent-200"
                  : "text-ink-400 hover:text-ink-200",
              ].join(" ")}
            >
              {tabLabel(k)}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-hidden">
        {tab === "browse" && <BrowseTab />}
        {tab === "themes" && (
          <ThemesTab
            onSubmitTheme={() => {
              setAuthorPrefillKind("cms_theme");
              setTab("author");
            }}
          />
        )}
        {tab === "installed" && <InstalledTab />}
        {tab === "author" && (
          <AuthorTab prefillKind={authorPrefillKind} onPrefillConsumed={() => setAuthorPrefillKind(null)} />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Themes tab — themes-only slice of Browse with a submit CTA              */
/* ---------------------------------------------------------------------- */

/**
 * Dedicated browser for `cms_theme` packages. Re-uses the same tile
 * + drawer experience as Browse but with the kind filter pinned and
 * a header CTA that drops the user into the Author flow with the
 * theme kind pre-selected. Themes apply tokens to every CmsSite the
 * tenant owns — see `lib/marketplace.ts → cms_theme` install handler.
 */
function ThemesTab({ onSubmitTheme }: { onSubmitTheme: () => void }) {
  const [q, setQ] = useState("");
  const [packages, setPackages] = useState<MarketplacePackage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openPackageId, setOpenPackageId] = useState<string | null>(null);
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const [list, installs] = await Promise.all([
        listMarketplacePackages({
          q: q.trim() || undefined,
          kind: "cms_theme",
          limit: 60,
        }),
        listMarketplaceInstalls(),
      ]);
      setPackages(list.packages);
      setInstalledSet(new Set(installs.map((i) => i.packageId)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full grid-cols-[1fr_minmax(380px,30%)] overflow-hidden">
      <main className="overflow-y-auto bg-ink-950 px-4 py-4">
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-violet-300">
              Themes
            </p>
            <p className="mt-0.5 text-xs font-medium text-ink-100">
              Apply curated themes across every CMS site, or submit your own
              for review.
            </p>
            <p className="mt-1 text-[11px] text-ink-400">
              Installed themes merge tokens (colors, layout, typography) into
              the tenant's CMS sites without overwriting customizations.
            </p>
          </div>
          <button
            type="button"
            onClick={onSubmitTheme}
            className="shrink-0 rounded border border-violet-500/40 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-200 hover:border-violet-500/60 hover:bg-violet-500/25"
          >
            + Submit a theme
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search themes…"
            className="flex-1 min-w-[200px] rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100"
          />
          <button
            type="submit"
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
          >
            Search
          </button>
        </form>

        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
            {err}
          </p>
        )}

        {packages === null ? (
          <p className="text-xs text-ink-500">Loading themes…</p>
        ) : packages.length === 0 ? (
          <div className="rounded border border-dashed border-ink-700 p-8 text-center">
            <p className="text-xs text-ink-300">
              No approved themes match your search.
            </p>
            <p className="mt-1 text-[11px] text-ink-500">
              Be the first — submit a theme for review.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {packages.map((p) => (
              <li
                key={p.id}
                className={[
                  "rounded-lg border p-3 transition-colors",
                  openPackageId === p.id
                    ? "border-accent-500/50 bg-accent-500/5"
                    : "border-ink-800 bg-ink-900 hover:border-ink-700",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => setOpenPackageId(p.id)}
                  className="block w-full text-left"
                >
                  <p className="text-xs font-medium text-ink-100">{p.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">
                    {p.summary || p.description.slice(0, 100)}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-500">
                    <span>{p.authorName || "TCGStudio"}</span>
                    <span>·</span>
                    <span>{p.installCount} installs</span>
                    {installedSet.has(p.id) && (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-300">
                        Installed
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {busy && <p className="mt-2 text-[10px] text-ink-500">Refreshing…</p>}
      </main>
      <aside className="overflow-y-auto border-l border-ink-800 bg-ink-900">
        {openPackageId ? (
          <PackageDetail
            packageId={openPackageId}
            onClose={() => setOpenPackageId(null)}
            onChanged={refresh}
            isInstalled={installedSet.has(openPackageId)}
          />
        ) : (
          <div className="p-6 text-[11px] text-ink-500">
            Pick a theme to preview its tokens, screenshots, and changelog.
          </div>
        )}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

function BrowseTab() {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [packages, setPackages] = useState<MarketplacePackage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openPackageId, setOpenPackageId] = useState<string | null>(null);
  const [installedSet, setInstalledSet] = useState<Set<string>>(new Set());

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const [list, installs] = await Promise.all([
        listMarketplacePackages({
          q: q.trim() || undefined,
          kind: kind === "all" ? undefined : kind,
          limit: 60,
        }),
        listMarketplaceInstalls(),
      ]);
      setPackages(list.packages);
      setInstalledSet(new Set(installs.map((i) => i.packageId)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    // intentionally don't depend on q/kind — debounce via the form submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid h-full grid-cols-[1fr_minmax(380px,30%)] overflow-hidden">
      <main className="overflow-y-auto bg-ink-950 px-4 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void refresh();
          }}
          className="mb-3 flex flex-wrap items-center gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search packages…"
            className="flex-1 min-w-[200px] rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm text-ink-100"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k === "all" ? "All kinds" : KIND_LABELS[k] ?? k}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </form>

        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-400">
            {err}
          </p>
        )}

        {!packages ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : packages.length === 0 ? (
          <p className="text-sm text-ink-500">No packages match.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {packages.map((pkg) => (
              <PackageTile
                key={pkg.id}
                pkg={pkg}
                installed={installedSet.has(pkg.id)}
                onOpen={() => setOpenPackageId(pkg.id)}
              />
            ))}
          </div>
        )}
      </main>
      <aside className="overflow-y-auto border-l border-ink-800 bg-ink-900 px-4 py-4 text-sm text-ink-300">
        {openPackageId ? (
          <PackageDetail
            id={openPackageId}
            onChanged={() => void refresh()}
            onClose={() => setOpenPackageId(null)}
          />
        ) : (
          <p className="text-xs text-ink-500">
            Pick a package on the left to see details, versions, and reviews.
          </p>
        )}
      </aside>
    </div>
  );
}

function PackageTile({
  pkg,
  installed,
  onOpen,
}: {
  pkg: MarketplacePackage;
  installed: boolean;
  onOpen: () => void;
}) {
  const stars = (pkg.ratingAvg10 / 10).toFixed(1);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-start gap-2 rounded-lg border border-ink-800 bg-ink-900 p-3 text-left transition-colors hover:border-accent-500/40 hover:bg-ink-800/50"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-100">{pkg.name}</h3>
        {installed && (
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            Installed
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-xs text-ink-400">
        {pkg.summary || pkg.description.slice(0, 140)}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-ink-500">
        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-300">
          {KIND_LABELS[pkg.kind] ?? pkg.kind}
        </span>
        {pkg.category && (
          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-ink-300">
            {pkg.category}
          </span>
        )}
        <span>by {pkg.publisher?.displayName ?? pkg.authorName ?? "TCGStudio"}</span>
        {pkg.publisher?.verified && (
          <span className="text-accent-300">✓ verified</span>
        )}
      </div>
      <div className="flex w-full items-center justify-between text-[11px] text-ink-500">
        <span>{pkg.installCount.toLocaleString()} installs</span>
        {pkg.ratingCount > 0 && (
          <span className="text-amber-300">
            ★ {stars} <span className="text-ink-500">({pkg.ratingCount})</span>
          </span>
        )}
      </div>
    </button>
  );
}

function PackageDetail({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<{
    package: MarketplacePackage;
    install: MarketplaceInstall | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState("");

  async function load() {
    setData(null);
    setErr(null);
    try {
      setData(await getMarketplacePackage(id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function install() {
    setBusy(true);
    setErr(null);
    try {
      await installMarketplacePackage(id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function uninstall() {
    if (!confirm("Uninstall this package from your tenant?")) return;
    setBusy(true);
    setErr(null);
    try {
      await uninstallMarketplacePackage(id);
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    setBusy(true);
    setErr(null);
    try {
      await reviewMarketplacePackage(id, {
        rating: reviewRating,
        body: reviewBody,
      });
      setReviewBody("");
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div>
        {err ? (
          <p className="text-xs text-danger-400">{err}</p>
        ) : (
          <p className="text-xs text-ink-500">Loading…</p>
        )}
      </div>
    );
  }

  const pkg = data.package;
  const stars = (pkg.ratingAvg10 / 10).toFixed(1);
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-medium text-ink-100">{pkg.name}</h2>
          <p className="text-[11px] text-ink-500">
            {KIND_LABELS[pkg.kind] ?? pkg.kind}
            {pkg.category && <> · {pkg.category}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-400 hover:bg-ink-700"
        >
          Close
        </button>
      </div>

      <p className="text-xs text-ink-300">{pkg.description}</p>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-400">
        <span>{pkg.installCount.toLocaleString()} installs</span>
        {pkg.ratingCount > 0 && (
          <span className="text-amber-300">
            ★ {stars} <span className="text-ink-500">({pkg.ratingCount})</span>
          </span>
        )}
        <span>by {pkg.publisher?.displayName ?? pkg.authorName}</span>
      </div>

      <div className="flex gap-2">
        {data.install ? (
          <button
            type="button"
            onClick={uninstall}
            disabled={busy}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-400 hover:bg-danger-500/20 disabled:opacity-50"
          >
            Uninstall
          </button>
        ) : (
          <button
            type="button"
            onClick={install}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Installing…" : "Install"}
          </button>
        )}
      </div>

      {err && <p className="text-[11px] text-danger-400">{err}</p>}

      {pkg.versions && pkg.versions.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
            Versions
          </h3>
          <ul className="space-y-1 text-[11px] text-ink-300">
            {pkg.versions.slice(0, 5).map((v) => (
              <li
                key={v.id}
                className="rounded border border-ink-800 bg-ink-950 px-2 py-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-ink-100">{v.version}</span>
                  <span className="text-ink-500">
                    {v.publishedAt
                      ? new Date(v.publishedAt).toLocaleDateString()
                      : "unpublished"}
                  </span>
                </div>
                {v.changelog && (
                  <p className="mt-0.5 text-[10px] text-ink-500">{v.changelog}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
          Leave a review
        </h3>
        <div className="space-y-2 rounded border border-ink-800 bg-ink-950 p-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setReviewRating(n)}
                className={[
                  "rounded px-1 text-base",
                  n <= reviewRating ? "text-amber-300" : "text-ink-700",
                ].join(" ")}
                aria-label={`${n} stars`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            rows={2}
            placeholder="Optional: what worked, what didn't"
            className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
          <button
            type="button"
            onClick={submitReview}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            Submit review
          </button>
        </div>
      </section>

      {pkg.reviews && pkg.reviews.length > 0 && (
        <section>
          <h3 className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
            Recent reviews
          </h3>
          <ul className="space-y-1.5">
            {pkg.reviews.slice(0, 6).map((r) => (
              <li
                key={r.id}
                className="rounded border border-ink-800 bg-ink-950 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between text-ink-400">
                  <span className="text-amber-300">
                    {"★".repeat(r.rating)}
                    <span className="text-ink-700">{"★".repeat(5 - r.rating)}</span>
                  </span>
                  <span>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                {r.body && <p className="mt-0.5 text-ink-300">{r.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed
// ---------------------------------------------------------------------------

function InstalledTab() {
  const [installs, setInstalls] = useState<MarketplaceInstall[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      setInstalls(await listMarketplaceInstalls());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function uninstall(id: string) {
    if (!confirm("Uninstall this package?")) return;
    setBusy(true);
    setErr(null);
    try {
      await uninstallMarketplacePackage(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      {err && (
        <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-400">
          {err}
        </p>
      )}
      {!installs ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : installs.length === 0 ? (
        <p className="text-sm text-ink-500">
          No packages installed yet. Browse the marketplace to add some.
        </p>
      ) : (
        <ul className="space-y-2">
          {installs.map((i) => (
            <li
              key={i.id}
              className="flex items-start justify-between rounded border border-ink-800 bg-ink-900 px-3 py-2"
            >
              <div>
                <p className="text-sm text-ink-100">
                  {i.package?.name ?? i.packageId}
                </p>
                <p className="text-[11px] text-ink-500">
                  {KIND_LABELS[i.package?.kind ?? ""] ?? i.package?.kind} ·
                  {" "}installed {new Date(i.installedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => i.package && uninstall(i.package.id)}
                disabled={busy}
                className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20 disabled:opacity-50"
              >
                Uninstall
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Author
// ---------------------------------------------------------------------------

function AuthorTab({
  prefillKind,
  onPrefillConsumed,
}: {
  /** Kind to seed the create-package form with when the user landed
   *  here from a "Submit a theme" CTA. Consumed once on mount. */
  prefillKind?: string | null;
  onPrefillConsumed?: () => void;
} = {}) {
  const [publisher, setPublisher] = useState<MarketplacePublisher | null>(null);
  const [packages, setPackages] = useState<MarketplacePackage[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If the user was sent here by another tab (e.g. "Submit a theme")
  // pop the create form open immediately so they don't have to click
  // again. We consume the prefill so a back-and-forth doesn't keep
  // re-opening the form.
  useEffect(() => {
    if (prefillKind) {
      setCreating(true);
    }
  }, [prefillKind]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    bio: "",
    websiteUrl: "",
  });

  async function refresh() {
    try {
      const [pub, pkgs] = await Promise.all([
        getMarketplacePublisher(),
        listMyMarketplacePackages(),
      ]);
      setPublisher(pub);
      setPackages(pkgs);
      if (pub) {
        setForm({
          displayName: pub.displayName,
          bio: pub.bio,
          websiteUrl: pub.websiteUrl,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function savePublisher() {
    setErr(null);
    try {
      const next = await upsertMarketplacePublisher({
        displayName: form.displayName,
        bio: form.bio,
        websiteUrl: form.websiteUrl,
      });
      setPublisher(next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="grid h-full grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
      <aside className="overflow-y-auto border-r border-ink-800 bg-ink-950 px-4 py-4">
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
          Publisher profile
        </h3>
        {publisher && !editing ? (
          <div className="space-y-2 text-xs text-ink-300">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-ink-100">
                {publisher.displayName}
              </span>
              {publisher.verified && (
                <span className="rounded border border-accent-500/40 bg-accent-500/10 px-1.5 py-0.5 text-[10px] text-accent-300">
                  ✓ verified
                </span>
              )}
            </div>
            {publisher.bio && <p className="text-ink-400">{publisher.bio}</p>}
            {publisher.websiteUrl && (
              <p className="truncate text-ink-500">{publisher.websiteUrl}</p>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
            >
              Edit profile
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Display name"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            />
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              placeholder="Short bio"
              rows={3}
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
            <input
              value={form.websiteUrl}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
              placeholder="Website URL"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
            <button
              type="button"
              onClick={savePublisher}
              disabled={!form.displayName.trim()}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              {publisher ? "Save changes" : "Become a publisher"}
            </button>
            {publisher && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="ml-2 text-[11px] text-ink-500 hover:text-ink-300"
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {err && (
          <p className="mt-2 text-[11px] text-danger-400">{err}</p>
        )}
      </aside>

      <main className="overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink-100">My packages</h3>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!publisher && !creating}
            title={publisher ? "" : "Set up your publisher profile first"}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            New package
          </button>
        </div>

        <TemplatesPanel />

        {creating && (
          <CreatePackageForm
            initialKind={prefillKind ?? undefined}
            onCancel={() => {
              setCreating(false);
              onPrefillConsumed?.();
            }}
            onCreated={async () => {
              setCreating(false);
              onPrefillConsumed?.();
              await refresh();
            }}
          />
        )}

        {packages.length === 0 ? (
          <p className="text-sm text-ink-500">
            You haven't published any packages yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {packages.map((p) => (
              <PackageRow key={p.id} pkg={p} onChanged={refresh} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function CreatePackageForm({
  onCancel,
  onCreated,
  initialKind,
}: {
  onCancel: () => void;
  onCreated: () => Promise<void>;
  /** When set, the form opens with this kind pre-selected — used by
   *  the "Submit a theme" CTA from the Themes tab. */
  initialKind?: string;
}) {
  const [form, setForm] = useState({
    slug: "",
    name: "",
    kind: initialKind ?? "plugin",
    summary: "",
    scope: "tenant" as "platform" | "tenant",
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await createMarketplacePackage(form);
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 space-y-2 rounded-lg border border-ink-800 bg-ink-900 p-3">
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Display name"
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
        />
        <input
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          placeholder="slug"
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm font-mono text-ink-100"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
        >
          {Object.entries(KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={form.scope}
          onChange={(e) =>
            setForm({ ...form, scope: e.target.value as "platform" | "tenant" })
          }
          className="rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100"
        >
          <option value="tenant">Private to my tenant</option>
          <option value="platform">Public marketplace</option>
        </select>
      </div>
      <textarea
        value={form.summary}
        onChange={(e) => setForm({ ...form, summary: e.target.value })}
        placeholder="Short summary"
        rows={2}
        className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
      />
      {err && <p className="text-[11px] text-danger-400">{err}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !form.slug || !form.name}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-300 hover:bg-ink-700"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function PackageRow({
  pkg,
  onChanged,
}: {
  pkg: MarketplacePackage;
  onChanged: () => Promise<void>;
}) {
  const [showVersion, setShowVersion] = useState(false);
  const [version, setVersion] = useState("0.1.0");
  const [changelog, setChangelog] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function publish() {
    setBusy(true);
    setErr(null);
    try {
      await publishMarketplaceVersion(pkg.id, { version, changelog });
      setShowVersion(false);
      setChangelog("");
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!confirm(`Delete package ${pkg.name}? This removes it for everyone.`))
      return;
    try {
      await deleteMarketplacePackage(pkg.id);
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function deprecate() {
    try {
      await updateMarketplacePackage(pkg.id, { status: "deprecated" });
      await onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <li className="rounded border border-ink-800 bg-ink-900 p-3 text-xs text-ink-300">
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-medium text-ink-100">{pkg.name}</h4>
          <p className="text-[11px] text-ink-500">
            {pkg.slug} · {KIND_LABELS[pkg.kind] ?? pkg.kind} · status{" "}
            <code className="text-ink-300">{pkg.status}</code>
            {pkg.scope === "platform" ? " · public" : " · private"}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowVersion((v) => !v)}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
          >
            Publish version
          </button>
          {pkg.status !== "deprecated" && (
            <button
              type="button"
              onClick={deprecate}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-700"
            >
              Deprecate
            </button>
          )}
          <button
            type="button"
            onClick={destroy}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20"
          >
            Delete
          </button>
        </div>
      </div>
      {showVersion && (
        <div className="mt-2 space-y-2 rounded border border-ink-800 bg-ink-950 p-2">
          <div className="grid grid-cols-[120px_1fr] gap-2">
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="0.1.0"
              className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100"
            />
            <input
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="Changelog (optional)"
              className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            />
          </div>
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      )}
      {err && <p className="mt-2 text-[11px] text-danger-400">{err}</p>}
      {pkg._count && (
        <p className="mt-1 text-[10px] text-ink-500">
          {pkg._count.installs} installs · {pkg._count.versions} versions ·{" "}
          {pkg._count.reviews} reviews
        </p>
      )}
    </li>
  );
}

/**
 * Starter templates for every authoring kind. Lists the kinds the API
 * knows about (so we don't hard-code the catalog client-side) and
 * gives each one a Download button that streams a pre-filled JSON
 * scaffold the author edits + submits via the New package form.
 *
 * Collapsed by default — clicking the header expands the list. The
 * Author tab already has a lot going on; the templates are a power-
 * user affordance rather than the primary action.
 */
function TemplatesPanel() {
  const [open, setOpen] = useState(false);
  const [kinds, setKinds] = useState<api.MarketplaceTemplateKind[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!open || kinds) return;
    void api
      .listMarketplaceTemplateKinds()
      .then(setKinds)
      .catch((e) => setErr(e instanceof Error ? e.message : "load failed"));
  }, [open, kinds]);

  async function download(kind: string) {
    setDownloading(kind);
    setErr(null);
    try {
      await api.downloadMarketplaceTemplate(kind);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "download failed");
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="mb-3 rounded border border-ink-700 bg-ink-900/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-ink-100">
          Starter templates
        </span>
        <span className="text-[10px] text-ink-500">
          {open ? "Hide" : "Show"}
        </span>
      </button>
      {open && (
        <div className="border-t border-ink-800 px-3 py-3">
          <p className="mb-3 text-[11px] text-ink-400">
            Download a JSON scaffold for the kind you want to author —
            it ships with sensible defaults and inline comments. Edit,
            then submit through the New package form above.
          </p>
          {err && (
            <p className="mb-2 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
              {err}
            </p>
          )}
          {!kinds ? (
            <p className="text-[11px] text-ink-500">Loading…</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
              {kinds.map((k) => (
                <li
                  key={k.kind}
                  className="flex items-center gap-2 rounded border border-ink-800 bg-ink-950 px-2 py-1.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-ink-100">{k.label}</p>
                    <p className="truncate text-[10px] text-ink-500">{k.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void download(k.kind)}
                    disabled={downloading === k.kind}
                    className="shrink-0 rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] text-ink-200 hover:bg-ink-700 disabled:opacity-50"
                  >
                    {downloading === k.kind ? "…" : "Download"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
