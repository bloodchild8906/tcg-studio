import { useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import { useDesigner } from "@/store/designerStore";

/**
 * Cmd-K / Ctrl-K spotlight search.
 *
 * Backed by `/api/v1/search` — a tenant-scoped fanout endpoint that
 * searches across cards, assets, projects, CMS pages, sets, decks,
 * keywords, factions, abilities, lore, and marketplace packages in a
 * single request. The previous client-side implementation indexed the
 * whole tenant on first open; this one fetches incrementally per
 * keystroke (debounced) so we only pay for what the user actually
 * searches for.
 *
 * Picking a result navigates: a card opens its editor, an asset opens
 * the assets view, a CMS page jumps to that page, a project navigates
 * to its subdomain, a marketplace package opens the marketplace view.
 *
 * The component renders a header trigger button + a modal overlay that
 * mounts on demand. Wires Cmd-K / Ctrl-K globally so the user can pop
 * it from anywhere.
 */

const DEBOUNCE_MS = 180;

export function GlobalSearch() {
  const [open, setOpen] = useState(false);

  // Global hotkey: Cmd-K (mac) / Ctrl-K (everywhere). Bound at the
  // window so the trigger works regardless of focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Search (⌘K)"
        className="flex h-8 items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2.5 text-[11px] text-ink-400 hover:border-ink-600 hover:bg-ink-800"
      >
        <SearchIcon />
        <span>Search</span>
        <kbd className="ml-auto rounded bg-ink-800 px-1 py-0.5 font-mono text-[10px] text-ink-500">
          ⌘K
        </kbd>
      </button>
      {open && <Palette onClose={() => setOpen(false)} />}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const setView = useDesigner((s) => s.setView);
  const selectCard = useDesigner((s) => s.selectCard);
  const activeProjectId = useDesigner((s) => s.activeProjectId);
  const tenantSlug = useDesigner((s) => s.activeTenantSlug);
  const tenants = useDesigner((s) => s.tenants);
  const projects = useDesigner((s) => s.projects);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<api.SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /**
   * Debounced backend search. Empty query shows a small primer of the
   * tenant's projects so the palette has a non-blank state on first
   * open. Only one request is in flight at a time; later keystrokes
   * supersede earlier ones via the abort controller.
   */
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setLoading(false);
      setError(null);
      // Seed with the projects the store already knows about — that's
      // free, immediate, and useful navigation.
      setHits(
        projects.slice(0, 20).map((p) => ({
          id: p.id,
          kind: "project" as const,
          title: p.name,
          subtitle: `Project · ${p.slug}`,
        })),
      );
      return;
    }

    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await api.search({
          q,
          projectId: activeProjectId ?? undefined,
          limit: 8,
        });
        if (controller.signal.aborted) return;
        setHits(r.hits);
        setActiveIndex(0);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, activeProjectId, projects]);

  // Focus the input on mount so the user can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit(item: api.SearchHit) {
    onClose();
    switch (item.kind) {
      case "project": {
        const tenant = tenants.find((t) => t.slug === tenantSlug);
        const project = projects.find((p) => p.id === item.id);
        if (tenant && project) {
          const root = api.getRootDomain();
          const port = window.location.port ? `:${window.location.port}` : "";
          window.location.href = `${window.location.protocol}//${project.slug}-${tenant.slug}.${root}${port}/admin`;
        }
        return;
      }
      case "card": {
        void selectCard(item.id).then(() => setView("cards"));
        return;
      }
      case "card_type":
        setView("card_types");
        return;
      case "asset":
        setView("assets");
        return;
      case "set":
        setView("sets");
        return;
      case "deck":
        setView("decks");
        return;
      case "keyword":
        setView("rules");
        return;
      case "faction":
        setView("factions");
        return;
      case "ability":
        setView("abilities");
        return;
      case "lore":
        setView("lore");
        return;
      case "cms_page":
        setView("cms");
        return;
      case "marketplace":
        setView("marketplace");
        return;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = hits[activeIndex];
      if (pick) commit(pick);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-ink-950/70 p-6 pt-24 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(680px,95vw)] overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-ink-800 px-3 py-3">
          <SearchIcon />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search cards, assets, pages, projects, marketplace…"
            className="flex-1 bg-transparent text-base text-ink-100 outline-none placeholder:text-ink-500"
          />
          {loading && (
            <span className="text-[10px] uppercase tracking-wider text-ink-500">
              searching
            </span>
          )}
          <kbd className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
            esc
          </kbd>
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {error ? (
            <li className="px-3 py-4 text-center text-xs text-danger-400">
              {error}
            </li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-4 text-center text-xs text-ink-500">
              {query.trim()
                ? loading
                  ? "Searching…"
                  : "No matches."
                : "Type to search across this tenant."}
            </li>
          ) : (
            hits.map((item, i) => (
              <li key={`${item.kind}-${item.id}`}>
                <button
                  type="button"
                  onClick={() => commit(item)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={[
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left",
                    i === activeIndex
                      ? "bg-accent-500/15 text-accent-200"
                      : "text-ink-200 hover:bg-ink-800",
                  ].join(" ")}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <KindBadge kind={item.kind} />
                    <span className="truncate text-sm">{item.title}</span>
                  </span>
                  {item.subtitle && (
                    <span className="ml-auto truncate text-[11px] text-ink-500">
                      {item.subtitle}
                    </span>
                  )}
                </button>
                {item.match && i === activeIndex && (
                  <p className="border-l-2 border-accent-500/40 bg-ink-950 px-3 py-1 text-[11px] text-ink-400">
                    {item.match}
                  </p>
                )}
              </li>
            ))
          )}
        </ul>
        <footer className="flex items-center justify-between border-t border-ink-800 bg-ink-900/40 px-3 py-1.5 text-[10px] text-ink-500">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>
            {hits.length} result{hits.length === 1 ? "" : "s"}
          </span>
        </footer>
      </div>
    </div>
  );
}

const KIND_PALETTE: Record<api.SearchKind, string> = {
  project: "bg-emerald-500/20 text-emerald-300",
  card: "bg-accent-500/20 text-accent-200",
  card_type: "bg-accent-500/15 text-accent-300",
  asset: "bg-sky-500/20 text-sky-300",
  set: "bg-violet-500/20 text-violet-300",
  deck: "bg-pink-500/20 text-pink-300",
  keyword: "bg-amber-500/20 text-amber-300",
  faction: "bg-rose-500/20 text-rose-300",
  ability: "bg-teal-500/20 text-teal-300",
  lore: "bg-indigo-500/20 text-indigo-300",
  cms_page: "bg-amber-500/20 text-amber-300",
  marketplace: "bg-fuchsia-500/20 text-fuchsia-300",
};

const KIND_LABEL: Record<api.SearchKind, string> = {
  project: "project",
  card: "card",
  card_type: "type",
  asset: "asset",
  set: "set",
  deck: "deck",
  keyword: "keyword",
  faction: "faction",
  ability: "ability",
  lore: "lore",
  cms_page: "page",
  marketplace: "package",
};

function KindBadge({ kind }: { kind: api.SearchKind }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px text-[9px] uppercase tracking-wider ${KIND_PALETTE[kind] ?? "bg-ink-800 text-ink-300"}`}
    >
      {KIND_LABEL[kind] ?? kind}
    </span>
  );
}

function SearchIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 text-ink-500"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  );
}
