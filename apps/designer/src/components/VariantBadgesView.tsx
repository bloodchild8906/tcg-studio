import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { VariantBadge } from "@/lib/apiTypes";
import { assetBlobUrl } from "@/lib/api";

const SHAPES = ["circle", "rounded", "banner", "star", "shield"] as const;
const POSITIONS = [
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
  "bottom_center",
] as const;

/**
 * Variant badges view (sec 21.x).
 *
 * Project-scoped catalog of visual stamps applied to cards. Each badge
 * carries its own visual identity (label, icon, color, shape, position)
 * plus an optional auto-apply condition. The card-template renderer
 * consumes the catalog via a `variant_badge` layer type — present
 * badges land at their configured position without per-card layout
 * authoring.
 *
 * Layout: list left, edit form right, with a live preview pinned at
 * the top of the editor so authors see badge appearance update in
 * real time as they tweak fields.
 */
export function VariantBadgesView() {
  const project = useDesigner(selectActiveProject);
  const [badges, setBadges] = useState<VariantBadge[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setBadges([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBadges(await api.listVariantBadges({ projectId: project.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = useMemo(
    () => badges.find((b) => b.id === selectedId) ?? null,
    [badges, selectedId],
  );

  async function handleCreate(input: { name: string; slug: string; label: string; color: string }) {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createVariantBadge({
        projectId: project.id,
        ...input,
      });
      setBadges((prev) => [...prev, created]);
      setSelectedId(created.id);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handlePatch(id: string, patch: Partial<VariantBadge>) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateVariantBadge(id, patch);
      setBadges((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this badge? Cards keep references but display nothing for it.")) return;
    try {
      await api.deleteVariantBadge(id);
      setBadges((prev) => prev.filter((b) => b.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its variant badges.</p>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[300px_1fr] overflow-hidden">
      <aside className="flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900">
        <header className="border-b border-ink-700 px-3 py-3">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Project: {project.name}
          </p>
          <h1 className="mt-1 text-base font-semibold text-ink-50">Variant badges</h1>
          <p className="mt-1 text-xs text-ink-400">
            {badges.length} badge{badges.length === 1 ? "" : "s"} · foil / promo / showcase / alt-art markers
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setCreating(true);
              }}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
            >
              + New badge
            </button>
          </div>
        </header>
        <ul className="flex-1 overflow-y-auto py-1">
          {loading ? (
            <li className="px-3 py-4 text-center text-xs text-ink-500">Loading…</li>
          ) : badges.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-ink-500">
              No badges yet — create one to mark printing variants.
            </li>
          ) : (
            badges.map((b) => (
              <li
                key={b.id}
                onClick={() => {
                  setSelectedId(b.id);
                  setCreating(false);
                }}
                className={[
                  "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs",
                  selectedId === b.id
                    ? "bg-accent-500/10 text-accent-300 ring-1 ring-inset ring-accent-500/30"
                    : "text-ink-100 hover:bg-ink-800",
                ].join(" ")}
              >
                <BadgeChip badge={b} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">
                    {b.slug}
                  </span>
                </span>
                <span className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-400">
                  {b.position.replace("_", " ")}
                </span>
              </li>
            ))
          )}
        </ul>
      </aside>

      <main className="overflow-y-auto bg-ink-950 p-6">
        {error && (
          <div className="mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}
        {creating ? (
          <BadgeCreateForm onCancel={() => setCreating(false)} onCreate={handleCreate} busy={busy} />
        ) : selected ? (
          <BadgeDetail
            badge={selected}
            onPatch={(patch) => handlePatch(selected.id, patch)}
            onDelete={() => handleDelete(selected.id)}
            busy={busy}
          />
        ) : (
          <div className="rounded border border-dashed border-ink-700 p-10 text-center text-sm text-ink-500">
            Pick a badge on the left, or click <span className="text-ink-300">New badge</span> to add one.
          </div>
        )}
      </main>
    </div>
  );
}

/* ====================================================================== */
/* Badge rendering — used by the list and the detail preview              */
/* ====================================================================== */

/**
 * Standalone badge renderer — pure SVG so it scales cleanly from the
 * tiny 28px list chip up to a 96px detail preview without bitmap
 * artifacts. Same shape vocabulary the card-template renderer uses.
 */
export function BadgeChip({
  badge,
  size = 48,
}: {
  badge: VariantBadge;
  size?: number;
}) {
  const stroke = darken(badge.color, 0.25);
  const r = size / 2;
  const cx = r;
  const cy = r;

  const labelChars = badge.label.length;
  // Auto-shrink the label so it fits inside the badge — the label area
  // is roughly 60% of the badge diameter; we pick a font size that
  // makes the longest dimension fit, capped at half the badge size.
  const labelFontSize = labelChars
    ? Math.max(8, Math.min(size * 0.42, (size * 0.6) / Math.max(1, labelChars * 0.55)))
    : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-label={badge.name}
    >
      {renderShape({
        shape: badge.shape,
        size,
        fill: badge.color,
        stroke,
      })}
      {badge.iconAssetId && (
        <image
          href={assetBlobUrl(badge.iconAssetId)}
          x={size * 0.2}
          y={size * 0.2}
          width={size * 0.6}
          height={size * 0.6}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {badge.label && !badge.iconAssetId && (
        <text
          x={cx}
          y={cy + labelFontSize * 0.35}
          textAnchor="middle"
          fontSize={labelFontSize}
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontWeight={700}
          fill={badge.textColor}
        >
          {badge.label}
        </text>
      )}
    </svg>
  );
}

/**
 * Render the SVG geometry for a badge shape. Each shape is sized to
 * fit a `size`x`size` viewBox with a small inset so the stroke
 * doesn't get clipped against the layer bounds.
 */
function renderShape({
  shape,
  size,
  fill,
  stroke,
}: {
  shape: string;
  size: number;
  fill: string;
  stroke: string;
}) {
  const r = size / 2;
  const inset = size * 0.06;
  switch (shape) {
    case "circle":
      return <circle cx={r} cy={r} r={r - inset} fill={fill} stroke={stroke} strokeWidth={size * 0.04} />;
    case "rounded":
      return (
        <rect
          x={inset}
          y={inset}
          width={size - inset * 2}
          height={size - inset * 2}
          rx={size * 0.18}
          ry={size * 0.18}
          fill={fill}
          stroke={stroke}
          strokeWidth={size * 0.04}
        />
      );
    case "banner": {
      // Pennant — flat top, slightly notched bottom.
      const w = size - inset * 2;
      const notch = size * 0.18;
      const path = `M ${inset} ${inset} h ${w} v ${size - inset * 2 - notch} l ${-w / 2} ${notch} l ${-w / 2} ${-notch} z`;
      return <path d={path} fill={fill} stroke={stroke} strokeWidth={size * 0.04} />;
    }
    case "star": {
      // Five-pointed star inscribed in the viewBox.
      const points: string[] = [];
      for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const radius = i % 2 === 0 ? r - inset : (r - inset) * 0.45;
        const x = r + Math.cos(angle) * radius;
        const y = r + Math.sin(angle) * radius;
        points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return (
        <polygon
          points={points.join(" ")}
          fill={fill}
          stroke={stroke}
          strokeWidth={size * 0.04}
        />
      );
    }
    case "shield": {
      // Heater shield — flat top, curve to a point at bottom.
      const path = `M ${inset} ${inset} h ${size - inset * 2} v ${size * 0.55} q 0 ${size * 0.4} ${-(size - inset * 2) / 2} ${size * 0.4} q ${-(size - inset * 2) / 2} 0 ${-(size - inset * 2) / 2} ${-(size * 0.4)} z`;
      return <path d={path} fill={fill} stroke={stroke} strokeWidth={size * 0.04} />;
    }
    default:
      return <circle cx={r} cy={r} r={r - inset} fill={fill} stroke={stroke} strokeWidth={size * 0.04} />;
  }
}

function darken(hex: string, amount: number): string {
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return hex;
  const raw = m[1];
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount))));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount))));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount))));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/* ====================================================================== */
/* Forms                                                                   */
/* ====================================================================== */

function BadgeCreateForm({
  onCancel,
  onCreate,
  busy,
}: {
  onCancel: () => void;
  onCreate: (input: { name: string; slug: string; label: string; color: string }) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#d4a24c");
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [touchedLabel, setTouchedLabel] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name || !slug) return;
        onCreate({ name, slug, label, color });
      }}
      className="max-w-xl space-y-4"
    >
      <header>
        <h2 className="text-base font-semibold text-ink-50">New variant badge</h2>
        <p className="mt-1 text-xs text-ink-400">
          Pick a name, label, and color. Icon, shape, position, and auto-apply condition land
          on the detail editor.
        </p>
      </header>
      <Field label="Name">
        <Input
          value={name}
          onChange={(v) => {
            setName(v);
            if (!touchedSlug) setSlug(slugify(v));
            if (!touchedLabel) setLabel(v.toUpperCase().slice(0, 8));
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Slug">
          <Input
            value={slug}
            onChange={(v) => {
              setTouchedSlug(true);
              setSlug(v.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
            }}
          />
        </Field>
        <Field label="Label" hint="Short text rendered on the badge.">
          <Input
            value={label}
            onChange={(v) => {
              setTouchedLabel(true);
              setLabel(v.toUpperCase().slice(0, 12));
            }}
          />
        </Field>
      </div>
      <Field label="Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-7 w-12 cursor-pointer rounded border border-ink-700 bg-ink-900"
          />
          <Input value={color} onChange={setColor} />
        </div>
      </Field>
      <div className="flex items-center gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !name || !slug}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}

function BadgeDetail({
  badge,
  onPatch,
  onDelete,
  busy,
}: {
  badge: VariantBadge;
  onPatch: (patch: Partial<VariantBadge>) => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<VariantBadge>(badge);
  useEffect(() => setDraft(badge), [badge]);

  function commit<K extends keyof VariantBadge>(key: K, value: VariantBadge[K]) {
    if (badge[key] === value) return;
    setDraft({ ...draft, [key]: value });
    onPatch({ [key]: value } as Partial<VariantBadge>);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink-50">{badge.name}</h2>
          <p className="mt-1 font-mono text-[11px] text-ink-500">{badge.slug}</p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20 disabled:opacity-40"
        >
          Delete
        </button>
      </header>

      {/* Live preview pinned to the top. Updates as the user edits draft state. */}
      <section className="flex items-center gap-6 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <BadgeChip badge={draft} size={96} />
        <div className="text-[11px] text-ink-400">
          <p>Preview at 96px.</p>
          <p className="mt-1 text-ink-500">
            Cards render this at the configured <span className="text-ink-300">{draft.position.replace("_", " ")}</span>
            {" "}corner via a <code className="font-mono">variant_badge</code> layer.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(v) => setDraft({ ...draft, name: v })}
            onBlur={() => commit("name", draft.name)}
          />
        </Field>
        <Field label="Status">
          <select
            value={draft.status}
            onChange={(e) => commit("status", e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["draft", "active", "archived"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label" hint='Short text inside the badge ("FOIL", "PROMO"). Leave empty for icon-only.'>
          <Input
            value={draft.label}
            onChange={(v) => setDraft({ ...draft, label: v.toUpperCase() })}
            onBlur={() => commit("label", draft.label)}
          />
        </Field>
        <Field label="Icon asset id">
          <Input
            value={draft.iconAssetId ?? ""}
            onChange={(v) => setDraft({ ...draft, iconAssetId: v.trim() || null })}
            onBlur={() => commit("iconAssetId", draft.iconAssetId)}
          />
        </Field>
        <Field label="Background color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.color}
              onChange={(e) => commit("color", e.target.value)}
              className="h-7 w-12 cursor-pointer rounded border border-ink-700 bg-ink-900"
            />
            <Input
              value={draft.color}
              onChange={(v) => setDraft({ ...draft, color: v })}
              onBlur={() => commit("color", draft.color)}
            />
          </div>
        </Field>
        <Field label="Text / icon color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={draft.textColor}
              onChange={(e) => commit("textColor", e.target.value)}
              className="h-7 w-12 cursor-pointer rounded border border-ink-700 bg-ink-900"
            />
            <Input
              value={draft.textColor}
              onChange={(v) => setDraft({ ...draft, textColor: v })}
              onBlur={() => commit("textColor", draft.textColor)}
            />
          </div>
        </Field>
        <Field label="Shape">
          <select
            value={draft.shape}
            onChange={(e) => commit("shape", e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <select
            value={draft.position}
            onChange={(e) => commit("position", e.target.value)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            value={draft.sortOrder}
            onChange={(e) => {
              const n = Number(e.target.value);
              setDraft({ ...draft, sortOrder: Number.isFinite(n) ? n : draft.sortOrder });
            }}
            onBlur={() => commit("sortOrder", draft.sortOrder)}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
          />
        </Field>
      </div>

      <Field
        label="Auto-apply condition (JSON)"
        hint='Optional: e.g. {"match":"all","conditions":[{"field":"foil","op":"equals","value":true}]} auto-applies this badge to cards where dataJson.foil === true.'
      >
        <textarea
          value={JSON.stringify(draft.conditionJson, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              setDraft({ ...draft, conditionJson: parsed });
            } catch {
              // ignore mid-typing
            }
          }}
          onBlur={() => commit("conditionJson", draft.conditionJson)}
          rows={4}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-100"
        />
      </Field>
    </div>
  );
}

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
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Input({
  value,
  onChange,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
    />
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}
