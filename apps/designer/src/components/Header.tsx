import { useState } from "react";
import {
  selectActiveCardType,
  selectActiveProject,
  useDesigner,
} from "@/store/designerStore";
import {
  downloadTemplate,
  pickTemplateFile,
  TemplateIOError,
} from "@/lib/templateIO";
import { exportPngBus } from "@/lib/exportPngBus";
import { SchemaEditor } from "@/components/SchemaEditor";
import { assetBlobUrl } from "@/lib/api";
import { NotificationBell } from "@/components/NotificationBell";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { GlobalSearch } from "@/components/GlobalSearch";

/**
 * Global header.
 *
 * Always visible:
 *   • Brand mark
 *   • Project picker (tenant-wide context)
 *   • Save status badge
 *
 * Visible only in the Designer view (since they only mean something there):
 *   • Undo / redo
 *   • Add layer dropdown
 *   • Save / Export JSON / Import / Export PNG / Reset to sample
 *
 * The card-type picker used to live here too — it now belongs to the section
 * (you pick a card type by clicking a tile, not from a global dropdown), so
 * we show its name as a read-only breadcrumb when the user is in a card-
 * type-scoped section (designer / cards) and skip it otherwise.
 */
export function Header() {
  const view = useDesigner((s) => s.view);
  const tenants = useDesigner((s) => s.tenants);
  const activeTenantSlug = useDesigner((s) => s.activeTenantSlug);
  const selectTenant = useDesigner((s) => s.selectTenant);
  const activeTenant = tenants.find((t) => t.slug === activeTenantSlug) ?? null;
  const branding = activeTenant?.brandingJson ?? {};
  const projects = useDesigner((s) => s.projects);
  const activeProject = useDesigner(selectActiveProject);
  const selectProject = useDesigner((s) => s.selectProject);
  const activeCardType = useDesigner(selectActiveCardType);
  const setView = useDesigner((s) => s.setView);
  const hostContext = useDesigner((s) => s.hostContext);

  // When the URL is `<project>.<tenant>.<root>`, we lock the tenant +
  // project pickers — the user is meant to operate inside that scope
  // and switching context should require navigating to a different
  // hostname. Tenant scope locks just the tenant picker.
  const tenantPinned = !!hostContext?.tenant;
  const projectPinned = !!hostContext?.project;
  // Platform scope is the cross-tenant admin host. The platform admin
  // surface lives in PlatformView (Tenants directory, Billing, etc.) —
  // they don't pick a tenant from the header to "operate inside" one,
  // and the platform never deals in projects. So at platform level we
  // hide BOTH pickers entirely; the header shows only the brand mark
  // + level chip + the right-cluster controls.
  const isPlatformLevel = hostContext?.level === "platform";

  const saveStatus = useDesigner((s) => s.saveStatus);
  const serverVersion = useDesigner((s) => s.serverTemplateVersion);

  return (
    <header
      className="flex h-12 items-center gap-3 bg-ink-900 px-3 text-ink-50"
      style={
        typeof branding.accentColor === "string"
          ? ({
              ["--brand-accent" as string]: branding.accentColor,
            } as React.CSSProperties)
          : undefined
      }
    >
      <BrandMark
        productName={
          typeof branding.productName === "string" && branding.productName
            ? branding.productName
            : "TCGStudio"
        }
        hidePlatform={branding.hidePlatformBranding === true}
        accentColor={
          typeof branding.accentColor === "string" ? branding.accentColor : null
        }
        logoAssetId={
          typeof branding.logoAssetId === "string" && branding.logoAssetId
            ? branding.logoAssetId
            : null
        }
      />

      <Divider />

      {/* No level chip. At platform scope the URL bar + the dashboard
       *  ("Mission control") already make the level obvious; at tenant
       *  / project scope the branding + active picker carry it. The
       *  chip is kept around (LevelChip below) for any future surface
       *  that genuinely needs it, but the header is intentionally
       *  bare at platform level — the user only wanted the brand mark
       *  and the right-cluster controls. */}

      {/* Tenant slot.
       *
       *   • Platform scope — hidden. The platform never operates "as"
       *     a tenant; it manages them via PlatformView.
       *   • Pinned by hostname — drop the label since the URL +
       *     branding already says which tenant we're in.
       *   • Tenant scope without a pinned tenant — render the picker.
       */}
      {!isPlatformLevel && !tenantPinned && (
        <PickerSelect
          label="Tenant"
          value={activeTenantSlug}
          onChange={(slug) => {
            if (slug) void selectTenant(slug);
          }}
          options={tenants.map((t) => ({ value: t.slug, label: t.name }))}
          emptyLabel="(no tenant)"
        />
      )}

      {/* Project slot.
       *
       *   • Platform scope — hidden. Platform doesn't know about
       *     projects (sec 9.2 / capability matrix).
       *   • Pinned by hostname (project subdomain) — drop the label
       *     for the same reason as above; the URL has the project
       *     slug.
       *   • Tenant scope without a pinned project — render the picker
       *     so the user can pick a project to drill into.
       */}
      {!isPlatformLevel && !projectPinned && (
        <PickerSelect
          label="Project"
          value={activeProject?.id ?? ""}
          onChange={(v) => selectProject(v)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          emptyLabel="(no project)"
        />
      )}

      {(view === "designer" || view === "cards") && activeCardType && (
        <>
          <Breadcrumb separator />
          <button
            type="button"
            onClick={() => setView("card_types")}
            className="rounded px-1.5 py-0.5 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            title="Back to card types"
          >
            Card types
          </button>
          <Breadcrumb />
          <span className="text-xs text-ink-200">{activeCardType.name}</span>
        </>
      )}

      {/* Save status is about the active card-type template — it only
       *  makes sense in the designer view. Showing it on a tenant
       *  dashboard or platform admin surface was just noise (and read
       *  "v9 SYNCED" at platform scope where there's no template at
       *  all). Pin it to the designer view where it belongs. */}
      {view === "designer" && (
        <SaveStatusBadge status={saveStatus} version={serverVersion} />
      )}

      {view === "designer" && (
        <DesignerToolbar />
      )}

      {view !== "designer" && <div className="ml-auto" />}

      {/* Header right cluster — search + bell + profile dropdown.
          Always visible regardless of view. ⌘K opens search globally;
          the trigger button is also a tappable spotlight on touch. */}
      <div className="flex items-center gap-2">
        <GlobalSearch />
        <NotificationBell />
        <ProfileDropdown />
      </div>
    </header>
  );
}

function DesignerToolbar() {
  const template = useDesigner((s) => s.template);
  const addLayer = useDesigner((s) => s.addLayer);
  const loadTemplate = useDesigner((s) => s.loadTemplate);
  const resetToSample = useDesigner((s) => s.resetToSample);
  const saveActiveTemplate = useDesigner((s) => s.saveActiveTemplate);
  const undo = useDesigner((s) => s.undo);
  const redo = useDesigner((s) => s.redo);
  const canUndo = useDesigner((s) => s.history.past.length > 0);
  const canRedo = useDesigner((s) => s.history.future.length > 0);
  const saveStatus = useDesigner((s) => s.saveStatus);
  const activeCardTypeId = useDesigner((s) => s.activeCardTypeId);
  const cardType = useDesigner(selectActiveCardType);
  const [schemaOpen, setSchemaOpen] = useState(false);

  // Read field count off the schemaJson without parsing the whole thing.
  const fieldCount =
    Array.isArray((cardType?.schemaJson as { fields?: unknown[] } | undefined)?.fields)
      ? ((cardType!.schemaJson as { fields: unknown[] }).fields.length)
      : 0;

  async function handleImport() {
    try {
      const next = await pickTemplateFile();
      loadTemplate(next);
    } catch (err) {
      if (err instanceof TemplateIOError) alert(`Import failed:\n${err.message}`);
      else if ((err as Error)?.message) alert(`Import failed:\n${(err as Error).message}`);
    }
  }

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <ToolbarButton onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
        <UndoIcon />
      </ToolbarButton>
      <ToolbarButton onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
        <RedoIcon />
      </ToolbarButton>

      <Divider />

      <AddLayerMenu onAdd={(t) => addLayer(t)} />
      <ToolbarButton
        onClick={() => setSchemaOpen(true)}
        disabled={!cardType}
        title="Edit the field schema for this card type"
      >
        <SchemaIcon />
        Schema
        <span className="ml-0.5 rounded-full bg-ink-700 px-1.5 text-[9px] text-ink-300">
          {fieldCount}
        </span>
      </ToolbarButton>
      <SchemaEditor open={schemaOpen} onClose={() => setSchemaOpen(false)} />

      <Divider />

      <PrimaryButton
        onClick={() => saveActiveTemplate()}
        disabled={!activeCardTypeId || saveStatus === "saving" || saveStatus === "synced"}
        title="Save the current template back to the server"
      >
        <SaveIcon />
        {saveStatus === "saving" ? "Saving…" : "Save"}
      </PrimaryButton>
      <ToolbarButton onClick={() => downloadTemplate(template)} title="Download template as JSON">
        <DownloadIcon /> JSON
      </ToolbarButton>
      <ToolbarButton onClick={handleImport} title="Replace the canvas with a JSON file">
        <UploadIcon /> Import
      </ToolbarButton>
      <ToolbarButton
        onClick={() => exportPngBus.emit("export")}
        title="Export the card art at design size to PNG"
      >
        <ExportIcon /> PNG
      </ToolbarButton>
      <ToolbarButton
        onClick={resetToSample}
        title="Replace the canvas with the bundled sample template (unsynced)"
      >
        <ResetIcon />
      </ToolbarButton>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Brand                                                                  */
/* ---------------------------------------------------------------------- */

function BrandMark({
  productName,
  hidePlatform,
  accentColor,
  logoAssetId,
}: {
  productName: string;
  hidePlatform: boolean;
  accentColor: string | null;
  logoAssetId: string | null;
}) {
  const safeAccent = isCleanHex(accentColor) ? accentColor : "#d4a24c";

  // Resolution order for the mark, simplest first:
  //   1. Per-tenant uploaded logo asset (if logoAssetId set).
  //   2. Platform default — the editable SVG in /branding/mark.svg.
  // Either way the product-name text sits to the right of the mark.
  const isPlatformBrand = productName === "TCGStudio" || productName === "TcgStudio";
  const markSrc = logoAssetId ? assetBlobUrl(logoAssetId) : "/branding/mark.svg";

  return (
    <div className="flex items-center gap-2">
      <img
        src={markSrc}
        alt=""
        aria-hidden="true"
        className="h-7 w-7 rounded shrink-0 object-contain"
        style={{
          // Glow tint matching the accent — invisible on the platform mark
          // but lets a custom monochrome logo absorb the brand color.
          boxShadow: logoAssetId
            ? "none"
            : `0 0 0 1px ${safeAccent}33`,
          background: "#11141a",
        }}
      />
      <span className="font-semibold tracking-wide text-ink-50">{productName}</span>
      {!hidePlatform && (
        <span
          className="hidden rounded bg-ink-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider sm:inline-block"
          style={{ color: safeAccent }}
        >
          {isPlatformBrand ? "Designer" : "by TCGStudio"}
        </span>
      )}
    </div>
  );
}

function isCleanHex(value: string | null): value is string {
  if (!value) return false;
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function Breadcrumb({ separator }: { separator?: boolean }) {
  return (
    <span className="text-ink-600" aria-hidden="true">
      {separator ? "/" : "›"}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Project picker                                                         */
/* ---------------------------------------------------------------------- */

function PickerSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  emptyLabel: string;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-300">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      <select
        value={value}
        disabled={options.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {options.length === 0 && <option value="">{emptyLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------------------------------------------------------------------- */
/* Save status badge                                                      */
/* ---------------------------------------------------------------------- */

function SaveStatusBadge({
  status,
  version,
}: {
  status: ReturnType<typeof useDesigner.getState>["saveStatus"];
  version: number | null;
}) {
  const lastError = useDesigner((s) => s.lastError);
  const cfg = STATUS_CFG[status];
  return (
    <span
      title={lastError ? `Error: ${lastError}` : cfg.tip}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        cfg.classes,
      ].join(" ")}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
      {version !== null && status !== "loading" && status !== "idle" && (
        <span className="text-ink-500 normal-case tracking-normal">v{version}</span>
      )}
    </span>
  );
}

const STATUS_CFG: Record<
  ReturnType<typeof useDesigner.getState>["saveStatus"],
  { label: string; classes: string; dot: string; tip: string }
> = {
  idle: {
    label: "no template",
    classes: "border-ink-700 bg-ink-800 text-ink-400",
    dot: "bg-ink-500",
    tip: "Pick or create a card type to bind a template.",
  },
  loading: {
    label: "loading",
    classes: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    dot: "bg-sky-400",
    tip: "Fetching from the API…",
  },
  synced: {
    label: "synced",
    classes: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    dot: "bg-emerald-400",
    tip: "All changes are saved.",
  },
  dirty: {
    label: "unsaved",
    classes: "border-amber-500/50 bg-amber-500/10 text-amber-300",
    dot: "bg-amber-400",
    tip: "You have local changes. Click Save to push.",
  },
  saving: {
    label: "saving",
    classes: "border-sky-500/40 bg-sky-500/10 text-sky-300",
    dot: "bg-sky-400 animate-pulse",
    tip: "Saving…",
  },
  error: {
    label: "error",
    classes: "border-danger-500/60 bg-danger-500/10 text-danger-500",
    dot: "bg-danger-500",
    tip: "Last operation failed — hover for details.",
  },
};

/* ---------------------------------------------------------------------- */
/* Toolbar primitives                                                     */
/* ---------------------------------------------------------------------- */

/**
 * Chip showing what level the user is currently operating at — driven
 * by the host context (`tcgstudio.local` = platform, `<sub>.<root>` =
 * tenant, `<proj>.<sub>.<root>` = project, custom domains via DB
 * lookup). Helps prevent the "wait, which workspace am I in?"
 * confusion when juggling multiple tabs.
 */
function LevelChip({ context }: { context: import("@/lib/api").HostContext }) {
  const cls =
    context.level === "platform"
      ? "border-ink-700 bg-ink-800 text-ink-300"
      : context.level === "tenant"
      ? "border-accent-500/40 bg-accent-500/10 text-accent-300"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  const label =
    context.level === "platform"
      ? "Platform"
      : context.level === "tenant"
      ? `Tenant: ${context.tenant?.name ?? context.tenantSlug ?? ""}`
      : `Project: ${context.project?.name ?? context.projectSlug ?? ""}`;
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium",
        cls,
      ].join(" ")}
      title={`Resolved from ${window.location.hostname}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background:
            context.level === "platform"
              ? "#7a7f95"
              : context.level === "tenant"
              ? "#d4a24c"
              : "#4ed1a2",
        }}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * Read-only label used in place of a picker when host-based pinning
 * locks the value. Visually matches the picker so the header layout
 * doesn't shift between contexts.
 */
function PinnedLabel({ label, value }: { label: string; value: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900/60 px-2 py-1 text-[11px]"
      title={`Pinned by hostname — switch by visiting a different URL.`}
    >
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      <span className="text-ink-200">{value || "—"}</span>
      <span className="text-ink-500">🔒</span>
    </span>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-ink-700" aria-hidden="true" />;
}

function ToolbarButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-100 hover:border-ink-600 hover:bg-ink-800 active:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  children,
  onClick,
  title,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center gap-1.5 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 active:bg-accent-500/30 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500 disabled:hover:border-ink-700 disabled:hover:bg-ink-800"
    >
      {children}
    </button>
  );
}

function AddLayerMenu({
  onAdd,
}: {
  onAdd: (t: "rect" | "text" | "image" | "zone" | "group") => void;
}) {
  return (
    <div className="relative inline-block">
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-ink-50 hover:bg-ink-700 [&::-webkit-details-marker]:hidden">
          <PlusIcon /> Add layer
          <ChevronIcon />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded border border-ink-700 bg-ink-800 shadow-lg">
          <MenuItem onClick={() => onAdd("rect")}>
            <SquareIcon /> Rectangle
          </MenuItem>
          <MenuItem onClick={() => onAdd("text")}>
            <TIcon /> Text
          </MenuItem>
          <MenuItem onClick={() => onAdd("image")}>
            <ImageIcon /> Image
          </MenuItem>
          <MenuItem onClick={() => onAdd("zone")}>
            <ZoneIcon /> Zone (data bound)
          </MenuItem>
          <MenuItem onClick={() => onAdd("group")}>
            <FolderIcon /> Group
          </MenuItem>
        </div>
      </details>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.7l1.4 1.4h5A1.5 1.5 0 0 1 14 5.9v5.6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5V4.5z" />
    </svg>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        const details = e.currentTarget.closest("details") as HTMLDetailsElement | null;
        if (details) details.open = false;
        onClick();
      }}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-ink-100 hover:bg-ink-700"
    >
      {children}
    </button>
  );
}

/* ----- icons ----- */
const ico = "h-3.5 w-3.5";

function PlusIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
function ChevronIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
function SquareIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="10" height="10" rx="1" />
    </svg>
  );
}
function TIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 4h10M8 4v9" />
    </svg>
  );
}
function ImageIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="7" r="1" />
      <path d="M2 12l4-3 4 2 4-3" />
    </svg>
  );
}
function ZoneIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.5">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    </svg>
  );
}
function SaveIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3h8l2 2v8H3z" />
      <path d="M5 3v4h6V3M6 13h4" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v8M5 8l3 3 3-3M3 13h10" />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 13V5M5 8l3-3 3 3M3 13v-2M13 13v-2" />
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <path d="M5 7l3 3 3-3" />
    </svg>
  );
}
function UndoIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 8h6a3 3 0 0 1 0 6H8M5 8l3-3M5 8l3 3" />
    </svg>
  );
}
function RedoIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M11 8H5a3 3 0 0 0 0 6h3M11 8L8 5M11 8l-3 3" />
    </svg>
  );
}
function ResetIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8a5 5 0 1 0 1.5-3.5M3 3v3h3" />
    </svg>
  );
}
function SchemaIcon() {
  return (
    <svg className={ico} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
      <path d="M5 6h6M5 9h6M5 12h4" />
    </svg>
  );
}
