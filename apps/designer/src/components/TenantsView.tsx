import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
import type { Tenant } from "@/lib/apiTypes";

/**
 * Tenants view — top-level grid of every tenant the platform knows about.
 *
 * Spec sec 9.3: a tenant is the main customer workspace; in this product
 * each tenant is effectively one creator's studio. Switching tenant changes
 * the entire visible scope (projects, card types, cards, assets — all are
 * tenant-isolated server-side).
 *
 * Why this view exists: until now the tenant was hardcoded to the seeded
 * "demo". To actually use TCGStudio multi-tenant, you need to be able to
 * see every tenant in your platform, create new ones, and switch between
 * them. The view tile is just the surface — `selectTenant` in the store
 * does the heavy lifting (clears caches, reloads projects).
 *
 * Layout mirrors ProjectsView for muscle-memory consistency.
 */
export function TenantsView() {
  const tenants = useDesigner((s) => s.tenants);
  const activeSlug = useDesigner((s) => s.activeTenantSlug);
  const selectTenant = useDesigner((s) => s.selectTenant);
  const deleteTenant = useDesigner((s) => s.deleteTenant);
  const setView = useDesigner((s) => s.setView);

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Platform</p>
          <h1 className="mt-1 text-xl font-semibold text-ink-50">Tenants</h1>
          <p className="mt-1 text-xs text-ink-400">
            Each tenant is its own studio workspace — projects, card types, cards, and assets
            are fully isolated. Switch tenant and the entire app re-scopes.
          </p>
        </header>

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          <NewTenantTile />
          {tenants.map((t) => (
            <TenantTile
              key={t.id}
              tenant={t}
              isActive={t.slug === activeSlug}
              onOpen={async () => {
                await selectTenant(t.slug);
                setView("dashboard");
              }}
              onDelete={() => {
                if (
                  confirm(
                    `Delete tenant "${t.name}"?\nThis removes ALL projects, card types, cards, assets, and members. Cannot be undone.`,
                  )
                ) {
                  void deleteTenant(t.id);
                }
              }}
            />
          ))}
        </ul>

        {tenants.length === 0 && (
          <p className="mt-6 text-sm text-ink-500">
            No tenants exist. Create one above to get started.
          </p>
        )}
      </div>
    </div>
  );
}

function TenantTile({
  tenant,
  isActive,
  onOpen,
  onDelete,
}: {
  tenant: Tenant;
  isActive: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={[
        "group flex flex-col overflow-hidden rounded-lg border bg-ink-900 transition-colors hover:border-accent-500/40",
        isActive ? "border-accent-500/50 ring-1 ring-accent-500/30" : "border-ink-700",
      ].join(" ")}
    >
      <button type="button" onClick={onOpen} className="flex flex-1 flex-col gap-2 p-4 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink-50">{tenant.name}</h3>
            <p className="truncate font-mono text-[10px] text-ink-500">{tenant.slug}</p>
          </div>
          <StatusPill status={tenant.status} />
        </div>
        <TenantGlyph slug={tenant.slug} />
        <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
          <span>updated {formatRelative(tenant.updatedAt)}</span>
          {isActive && (
            <span className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
              active
            </span>
          )}
        </div>
      </button>
      <div className="flex border-t border-ink-800">
        <button
          type="button"
          onClick={onOpen}
          className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
        >
          Switch into
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isActive}
          title={isActive ? "Switch to another tenant first" : "Delete tenant"}
          className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-500"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

/** A tiny visual decoration so each tile has its own face. */
function TenantGlyph({ slug }: { slug: string }) {
  // Hash the slug to a hue so the same tenant always shows the same accent.
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return (
    <div className="relative h-16 w-full overflow-hidden rounded">
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(135deg, hsl(${hue} 60% 28%) 0%, hsl(${(hue + 40) % 360} 50% 16%) 100%)`,
        }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 30">
        <text
          x="50"
          y="20"
          textAnchor="middle"
          fontSize="14"
          fontFamily="serif"
          fill="rgba(255,255,255,0.85)"
          fontWeight="600"
        >
          {slug.slice(0, 2).toUpperCase()}
        </text>
      </svg>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    trial: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    past_due: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    suspended: "border-danger-500/40 bg-danger-500/10 text-danger-500",
    disabled: "border-ink-700 bg-ink-800 text-ink-500",
    pending_deletion: "border-danger-500/40 bg-danger-500/10 text-danger-500",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
        map[status] ?? map.active
      }`}
    >
      {status}
    </span>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ---------------------------------------------------------------------- */
/* + new tile                                                             */
/* ---------------------------------------------------------------------- */

function NewTenantTile() {
  const createTenant = useDesigner((s) => s.createTenant);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  function autoSlug(n: string) {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createTenant({
        name: name.trim(),
        slug: (slug.trim() || autoSlug(name)) || "tenant",
      });
      setName("");
      setSlug("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-full min-h-[180px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300"
        >
          <PlusIcon />
          <span className="text-xs font-medium">New tenant</span>
          <span className="text-[10px] text-ink-500">Studio, publisher, school, …</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <form
        onSubmit={submit}
        className="flex h-full min-h-[180px] flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3"
      >
        <p className="text-[10px] uppercase tracking-wider text-accent-300">New tenant</p>
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slug) setSlug(autoSlug(e.target.value));
          }}
          placeholder="Studio name"
          autoFocus
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))}
          placeholder="slug"
          className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100"
        />
        <p className="text-[10px] text-ink-500">
          Slug becomes the tenant's URL prefix and the X-Tenant-Slug header value.
        </p>
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </li>
  );
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
