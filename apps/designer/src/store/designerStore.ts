import { create } from "zustand";
import type {
  CardTypeTemplate,
  Layer,
  LayerId,
  LayerType,
} from "@/types";
import { sampleTemplate } from "@/data/sampleTemplate";
import * as api from "@/lib/api";
import type {
  AuthUser,
  Card,
  CardSet,
  CardType,
  MembershipWithTenant,
  Project,
  Tenant,
} from "@/lib/apiTypes";

/**
 * Central state for the Card Type Designer.
 *
 * Why Zustand: the designer needs frequent fine-grained reads (each Konva node
 * subscribes to "its layer") plus a few cross-cutting writes (move, resize,
 * reorder). Context + reducer would re-render the whole tree on every drag tick.
 * Zustand selectors give per-shape memoization without ceremony.
 *
 * Three concerns live in one store:
 *
 *   1. Template editing — `template`, layer mutations, save/load, undo/redo.
 *   2. UI state — `selectedLayerId`, `viewport`, `overlays`.
 *   3. API binding — `projects`, `cardTypes`, the currently-active project /
 *      card type / template, and the dirty/saving lifecycle.
 *
 * They share a single store so one selector can derive cross-cutting facts
 * (e.g. "show 'Save' button only when activeTemplateId set AND template !=
 * lastSavedTemplate").
 *
 * Undo/redo model:
 *   - Discrete actions (add/remove/duplicate/reorder/rename/toggleLock,
 *     toggleVisibility) auto-commit one history frame.
 *   - `updateLayer` does NOT auto-commit — callers (canvas drag/transform end,
 *     inspector blur) call `commit()` themselves so a multi-keystroke text
 *     edit becomes one undo step rather than N.
 *   - Past/future stacks are capped at HISTORY_CAPACITY frames.
 *   - Selection / viewport / overlays are NOT historic — undoing a layer
 *     change shouldn't yank the camera around.
 */

const HISTORY_CAPACITY = 50;

export interface Viewport {
  /** Visual zoom — 1 means 1px-of-canvas == 1px-on-screen. */
  scale: number;
  /** Pan in screen pixels. */
  x: number;
  y: number;
}

interface History {
  past: CardTypeTemplate[];
  future: CardTypeTemplate[];
}

/** Represents the live API <-> client sync state for the active template. */
export type SaveStatus =
  | "idle" // no template selected / loaded
  | "loading" // fetching from API
  | "synced" // template matches what's on the server
  | "dirty" // template differs; user needs to save
  | "saving" // a PATCH is in flight
  | "error"; // last operation failed; see lastError

export type SelectMode = "replace" | "add" | "toggle";

export interface DesignerState {
  // ----- template + UI -----
  template: CardTypeTemplate;
  /**
   * Multi-select set, ordered by selection time (last selected first).
   * Most code reads the first entry as "the primary" — the inspector etc.
   * Empty array means nothing selected.
   */
  selectedLayerIds: LayerId[];
  viewport: Viewport;
  overlays: { grid: boolean; safeZone: boolean; bleed: boolean };
  history: History;

  /**
   * Top-level view. The dashboard is the home; the others are section pages
   * reached via the sidebar (or by drilling in from the dashboard / a card
   * type tile).
   */
  view:
    | "dashboard"
    | "tenants"
    | "projects"
    | "card_types"
    | "designer"
    | "cards"
    | "assets"
    | "sets"
    | "rules"
    | "factions"
    | "lore"
    | "decks"
    | "boards"
    | "rulesets"
    | "abilities"
    | "playtest"
    | "insights"
    | "validation"
    | "variant_badges"
    | "cms"
    | "tasks"
    | "messages"
    | "planning"
    | "marketplace"
    | "platform"
    | "members"
    | "support"
    | "commerce"
    | "profile"
    | "settings";
  setView: (
    v:
      | "dashboard"
      | "tenants"
      | "projects"
      | "card_types"
      | "designer"
      | "cards"
      | "assets"
      | "sets"
      | "rules"
      | "factions"
      | "lore"
      | "decks"
      | "boards"
      | "rulesets"
      | "abilities"
      | "playtest"
      | "insights"
      | "validation"
      | "variant_badges"
      | "cms"
      | "tasks"
      | "messages"
      | "planning"
      | "marketplace"
      | "platform"
      | "members"
      | "support"
      | "commerce"
      | "profile"
      | "settings",
  ) => void;

  // ----- API state -----
  /** Authenticated user. Null when not signed in. */
  currentUser: AuthUser | null;
  /** Platform-admin role of the current user, or null. Set by
   *  loadInitial after fetching /api/v1/platform/me; gates the
   *  Platform sidebar entry + view. */
  platformRole: "owner" | "admin" | "support" | null;
  /** Memberships of the current user (across tenants). Empty when not signed in. */
  memberships: MembershipWithTenant[];
  tenants: Tenant[];
  /** Slug of the currently-selected tenant. Drives every API call. */
  activeTenantSlug: string;
  projects: Project[];
  cardTypes: CardType[];
  /** Sets that belong to the active project — used for the card-editor picker. */
  sets: CardSet[];
  cards: Card[];
  activeProjectId: string | null;
  activeCardTypeId: string | null;
  activeTemplateId: string | null;
  activeCardId: string | null;
  /** Reference to whatever was last loaded/saved against the server. Drives dirty detection. */
  lastSavedTemplate: CardTypeTemplate | null;
  /** Server-side version (PATCH /templates increments this). Shown in the header. */
  serverTemplateVersion: number | null;
  saveStatus: SaveStatus;
  /** Last user-visible error message — surfaced in status bar / save badge. */
  lastError: string | null;

  // ----- selection -----
  /**
   * Update the selection.
   *   - id null + mode replace → clear
   *   - mode "replace" → set to [id]
   *   - mode "add"     → include id if not already (no-op if present)
   *   - mode "toggle"  → flip membership
   */
  selectLayer: (id: LayerId | null, mode?: SelectMode) => void;
  clearSelection: () => void;
  /** Delete every currently-selected layer. Used by the Delete key. */
  removeSelectedLayers: () => void;

  // ----- layer CRUD -----
  addLayer: (type: LayerType) => LayerId;
  removeLayer: (id: LayerId) => void;
  duplicateLayer: (id: LayerId) => LayerId | null;
  /**
   * Patch a layer in place. Does NOT push history — call `commit()` from the
   * gesture boundary (drag end, blur, key-up) when you want the edit to land
   * as one undo step.
   */
  updateLayer: (id: LayerId, patch: Partial<Layer>) => void;
  renameLayer: (id: LayerId, name: string) => void;
  toggleVisibility: (id: LayerId) => void;
  toggleLock: (id: LayerId) => void;
  reorderLayer: (id: LayerId, toIndex: number) => void;
  /**
   * Reparent a layer under a different group (or to the top level when
   * `parentId` is null). Doesn't change render order, just structure.
   */
  setLayerParent: (id: LayerId, parentId: LayerId | null) => void;
  /**
   * Wrap the currently-selected layers in a new group. Returns the new
   * group's id or null if nothing was selected. The group is created at
   * the topmost selected layer's position so render order is preserved.
   */
  groupSelectedLayers: () => LayerId | null;
  /**
   * Inverse — for a given group, move its children up to the group's
   * own parent and delete the group itself.
   */
  ungroupLayer: (id: LayerId) => void;

  /**
   * Patch the top-level template fields (size, bleed, safeZone, dpi,
   * background, name, description). Doesn't touch layers. Used by
   * the Page Setup panel — calls `commit()` itself so each setting
   * change becomes its own undo step.
   */
  patchTemplateMeta: (
    patch: Partial<
      Pick<
        CardTypeTemplate,
        "name" | "description" | "size" | "bleed" | "safeZone" | "background"
      > & { dpi?: number }
    >,
  ) => void;

  // ----- viewport -----
  setViewport: (next: Viewport) => void;
  resetViewport: () => void;
  toggleOverlay: (key: keyof DesignerState["overlays"]) => void;

  // ----- template-level -----
  loadTemplate: (next: CardTypeTemplate) => void;
  resetToSample: () => void;

  // ----- history -----
  commit: () => void;
  undo: () => void;
  redo: () => void;

  // ----- preview data (variants — sec 21) -----
  /**
   * Update one key on the template's previewData. Does not push history —
   * preview data is "design-time scratch" and undoing it would feel weird.
   * It still marks the template dirty against the API because the value
   * round-trips with the template JSON.
   */
  setPreviewField: (field: string, value: unknown) => void;
  removePreviewField: (field: string) => void;

  // ----- auth -----
  signUp: (input: {
    email: string;
    password: string;
    name: string;
    /** When set, the signup is redeeming an invitation. The backend
     *  skips creating a personal tenant — the new user becomes only
     *  a member of the inviting level (platform/tenant/project). */
    invitationToken?: string;
    /** When set, joins this existing tenant by slug as a viewer
     *  rather than minting a personal tenant. Same as the per-tenant
     *  signup-on-subdomain flow. */
    tenantSlug?: string;
  }) => Promise<void>;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signOut: () => void;
  /** Refresh `currentUser` + `memberships` from /api/v1/auth/me. No-op without a token. */
  refreshMe: () => Promise<void>;

  // ----- tenants -----
  /** Switch the active tenant. Clears project / card type / cards state and reloads. */
  selectTenant: (slug: string) => Promise<void>;
  createTenant: (input: {
    name: string;
    slug: string;
    /** Tenant archetype (sec 8) — drives dashboard preset. Optional;
     *  defaults to "studio" server-side. */
    tenantType?: "solo" | "studio" | "publisher" | "school" | "reseller";
    /** White-label tokens captured from the registration wizard.
     *  Read by the tenant create endpoint when seeding the default
     *  CMS landing/login pages. */
    brandingJson?: Record<string, unknown>;
  }) => Promise<void>;
  deleteTenant: (id: string) => Promise<void>;

  /**
   * Server-resolved host context (sec 10.4). Populated on boot via
   * `loadInitial` calling `/api/v1/context` — the canonical source of
   * truth for level + tenant + project (resolves custom domains
   * correctly, unlike the local hostname parser).
   *
   * `null` until the bootstrap call resolves; treat as "platform"
   * during that interval.
   */
  hostContext: import("@/lib/api").HostContext | null;

  // ----- API -----
  loadInitial: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectCardType: (cardTypeId: string) => Promise<void>;
  /** PATCH the active template OR POST a new one if there isn't one yet. */
  saveActiveTemplate: () => Promise<void>;
  /** POST a new card type and switch to the designer view to edit its template. */
  createCardType: (input: { name: string; slug: string; description?: string }) => Promise<void>;
  /** POST a new project, prepend to projects[], select it, and land on the dashboard.
   *  `ownerEmail` is required — it nominates the user who can sign in to the project.
   *  The creator does NOT auto-inherit access (sec 13.4). */
  createProject: (input: {
    name: string;
    slug: string;
    description?: string;
    ownerEmail: string;
    status?: string;
    /** Optional white-label tokens. Read by the project-create
     *  endpoint when seeding the project's CMS landing/login pages. */
    brandingJson?: Record<string, unknown>;
  }) => Promise<void>;
  /** DELETE a project and refresh the projects list. */
  deleteProject: (id: string) => Promise<void>;
  /** PATCH the active card type's schemaJson; refresh in the cards array. */
  updateActiveCardTypeSchema: (schemaJson: unknown) => Promise<void>;
  /** Pick a card for preview — its dataJson replaces the current previewData. */
  selectCard: (cardId: string | null) => void;
  /** POST a new card using the current preview data as dataJson. */
  createCardFromPreview: (input: { name: string; slug: string }) => Promise<void>;
  /** PATCH the active card's dataJson with the current preview data. */
  saveActiveCardData: () => Promise<void>;
  /** DELETE a card (no confirm here — caller decides). */
  deleteCard: (cardId: string) => Promise<void>;
  clearError: () => void;
}

let _idCounter = 1;
function nextId(prefix: string): string {
  // Cheap monotonic id generator. Real ids will come from the backend later.
  const stamp = Date.now().toString(36).slice(-4);
  const seq = (_idCounter++).toString(36);
  return `${prefix}_${stamp}${seq}`;
}

/**
 * Build a default new layer of the given type, placed roughly in the middle
 * of the card so the user sees it appear without scrolling.
 */
function makeDefaultLayer(type: LayerType, size: { width: number; height: number }): Layer {
  const cx = Math.round(size.width / 2);
  const cy = Math.round(size.height / 2);
  const w = 240;
  const h = 80;
  const base = {
    bounds: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
  } as const;

  switch (type) {
    case "rect":
      return {
        ...base,
        id: nextId("lyr_rect"),
        type: "rect",
        name: "Rectangle",
        fill: "#262c3d",
        stroke: "#d4a24c",
        strokeWidth: 2,
        cornerRadius: 6,
      };
    case "text":
      return {
        ...base,
        id: nextId("lyr_text"),
        type: "text",
        name: "Text",
        text: "Text",
        fill: "#ebd198",
        fontFamily: "serif",
        fontSize: 28,
        fontStyle: "normal",
        align: "left",
        verticalAlign: "top",
        wrap: true,
      };
    case "image":
      return {
        ...base,
        id: nextId("lyr_image"),
        type: "image",
        name: "Image",
        assetId: null,
        src: null,
        fit: "contain",
      };
    case "zone":
      return {
        ...base,
        id: nextId("lyr_zone"),
        type: "zone",
        name: "New zone",
        fieldKey: "field_key",
        binding: "text",
        placeholder: "Bound field",
        designerTint: "rgba(212, 162, 76, 0.08)",
        fontFamily: "serif",
        fontSize: 24,
        align: "left",
        fill: "#ebd198",
      };
    case "group":
      return {
        // Groups don't render — bounds default to a small box at the
        // center for nominal positioning, in case a future feature
        // transforms the whole group as a unit.
        ...base,
        id: nextId("lyr_group"),
        type: "group",
        name: "Group",
        collapsed: false,
      };
  }
}

const initialViewport: Viewport = { scale: 0.5, x: 60, y: 40 };
const initialHistory: History = { past: [], future: [] };

/**
 * Snapshot the *current* template into past, clear future. Used by every
 * action that produces a discrete change. Returns the new history object.
 */
function pushPast(history: History, snapshot: CardTypeTemplate): History {
  const next = [...history.past, snapshot];
  if (next.length > HISTORY_CAPACITY) next.shift();
  return { past: next, future: [] };
}

/**
 * Recompute the save status from fields. Called after every mutation /
 * API operation so the badge stays in sync without per-action bookkeeping.
 */
/**
 * Cycle guard for setLayerParent. Returns true if `candidateAncestorId`
 * is a descendant (or self) of `id` — in which case making `id` the
 * parent of `candidateAncestorId` would create a cycle.
 */
function isDescendantOf(layers: Layer[], candidateAncestorId: string, id: string): boolean {
  if (candidateAncestorId === id) return true;
  let cursor: string | null | undefined = candidateAncestorId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = layers.find((l) => l.id === cursor);
    if (!node) return false;
    if (node.parentId === id) return true;
    cursor = node.parentId ?? null;
  }
  return false;
}

function deriveStatus(s: Pick<DesignerState, "saveStatus" | "lastSavedTemplate" | "template" | "activeTemplateId">): SaveStatus {
  // Transient states (loading, saving, error) win — don't override mid-flight.
  if (s.saveStatus === "loading" || s.saveStatus === "saving" || s.saveStatus === "error") {
    return s.saveStatus;
  }
  if (!s.activeTemplateId || !s.lastSavedTemplate) return "idle";
  return s.template === s.lastSavedTemplate ? "synced" : "dirty";
}

export const useDesigner = create<DesignerState>((set, get) => ({
  template: sampleTemplate,
  selectedLayerIds: [],
  viewport: initialViewport,
  overlays: { grid: true, safeZone: true, bleed: true },
  history: initialHistory,

  view: "dashboard",
  setView: (v) => set({ view: v }),

  currentUser: null,
  platformRole: null,
  memberships: [],
  tenants: [],
  activeTenantSlug: api.getActiveTenantSlug(),
  hostContext: null,
  projects: [],
  cardTypes: [],
  sets: [],
  cards: [],
  activeProjectId: null,
  activeCardTypeId: null,
  activeTemplateId: null,
  activeCardId: null,
  lastSavedTemplate: null,
  serverTemplateVersion: null,
  saveStatus: "idle",
  lastError: null,

  selectLayer: (id, mode = "replace") => {
    if (id === null) {
      set({ selectedLayerIds: [] });
      return;
    }
    set((s) => {
      const cur = s.selectedLayerIds;
      if (mode === "replace") return { selectedLayerIds: [id] };
      if (mode === "add") {
        if (cur.includes(id)) return s;
        return { selectedLayerIds: [id, ...cur] };
      }
      // toggle
      if (cur.includes(id)) {
        return { selectedLayerIds: cur.filter((x) => x !== id) };
      }
      return { selectedLayerIds: [id, ...cur] };
    });
  },

  clearSelection: () => set({ selectedLayerIds: [] }),

  removeSelectedLayers: () => {
    const t = get().template;
    const sel = new Set(get().selectedLayerIds);
    if (sel.size === 0) return;
    const next = { ...t, layers: t.layers.filter((l) => !sel.has(l.id)) };
    set((s) => ({
      template: next,
      selectedLayerIds: [],
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  addLayer: (type) => {
    const t = get().template;
    const layer = makeDefaultLayer(type, t.size);
    const next = { ...t, layers: [...t.layers, layer] };
    set((s) => ({
      template: next,
      selectedLayerIds: [layer.id],
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
    return layer.id;
  },

  removeLayer: (id) => {
    const t = get().template;
    const next = { ...t, layers: t.layers.filter((l) => l.id !== id) };
    set((s) => ({
      template: next,
      selectedLayerIds: s.selectedLayerIds.filter((x) => x !== id),
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  duplicateLayer: (id) => {
    const t = get().template;
    const idx = t.layers.findIndex((l) => l.id === id);
    if (idx < 0) return null;
    const original = t.layers[idx];
    const copy: Layer = {
      ...original,
      id: nextId(`lyr_${original.type}`),
      name: `${original.name} copy`,
      bounds: {
        ...original.bounds,
        x: original.bounds.x + 16,
        y: original.bounds.y + 16,
      },
    };
    const layers = [...t.layers];
    layers.splice(idx + 1, 0, copy);
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      selectedLayerIds: [copy.id],
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
    return copy.id;
  },

  updateLayer: (id, patch) => {
    const t = get().template;
    const layers = t.layers.map((l) =>
      l.id === id ? ({ ...l, ...patch } as Layer) : l,
    );
    const next = { ...t, layers };
    // Intentionally NOT touching history — caller decides when to commit.
    set((s) => ({ template: next, saveStatus: deriveStatus({ ...s, template: next }) }));
  },

  renameLayer: (id, name) => {
    const t = get().template;
    const layers = t.layers.map((l) => (l.id === id ? ({ ...l, name } as Layer) : l));
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  toggleVisibility: (id) => {
    const t = get().template;
    const layers = t.layers.map((l) =>
      l.id === id ? ({ ...l, visible: !l.visible } as Layer) : l,
    );
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  toggleLock: (id) => {
    const t = get().template;
    const layers = t.layers.map((l) =>
      l.id === id ? ({ ...l, locked: !l.locked } as Layer) : l,
    );
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  reorderLayer: (id, toIndex) => {
    const t = get().template;
    const fromIndex = t.layers.findIndex((l) => l.id === id);
    if (fromIndex < 0) return;
    const clamped = Math.max(0, Math.min(toIndex, t.layers.length - 1));
    if (clamped === fromIndex) return;
    const layers = [...t.layers];
    const [moved] = layers.splice(fromIndex, 1);
    layers.splice(clamped, 0, moved);
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  setLayerParent: (id, parentId) => {
    const t = get().template;
    // Refuse cycles: if parentId is a descendant of id, ignore. Cheap
    // protection — without it a user could drag a group into its own
    // child and produce an unwalkable tree.
    if (parentId && isDescendantOf(t.layers, parentId, id)) return;
    const layers = t.layers.map((l) =>
      l.id === id ? ({ ...l, parentId: parentId ?? null } as Layer) : l,
    );
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  groupSelectedLayers: () => {
    const t = get().template;
    const sel = get().selectedLayerIds;
    if (sel.length === 0) return null;
    // Position the new group at the index of the topmost selected
    // layer (largest index in the array). Children keep their order;
    // only their parentId changes.
    const indices = sel
      .map((id) => t.layers.findIndex((l) => l.id === id))
      .filter((i) => i >= 0);
    if (indices.length === 0) return null;
    const insertAt = Math.max(...indices) + 1;
    const groupLayer = makeDefaultLayer("group", t.size);
    // Inherit parent of the first selected layer so grouping inside
    // an existing group "stays inside" rather than escaping to root.
    const firstSelected = t.layers.find((l) => l.id === sel[0]);
    const parentId = firstSelected?.parentId ?? null;
    const groupWithParent = { ...groupLayer, parentId } as Layer;

    const selSet = new Set(sel);
    const layers = t.layers.map((l) =>
      selSet.has(l.id) ? ({ ...l, parentId: groupWithParent.id } as Layer) : l,
    );
    layers.splice(insertAt, 0, groupWithParent);

    const next = { ...t, layers };
    set((s) => ({
      template: next,
      selectedLayerIds: [groupWithParent.id],
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
    return groupWithParent.id;
  },

  ungroupLayer: (id) => {
    const t = get().template;
    const group = t.layers.find((l) => l.id === id);
    if (!group || group.type !== "group") return;
    const newParent = group.parentId ?? null;
    const layers = t.layers
      .map((l) =>
        l.parentId === id ? ({ ...l, parentId: newParent } as Layer) : l,
      )
      .filter((l) => l.id !== id);
    const next = { ...t, layers };
    set((s) => ({
      template: next,
      selectedLayerIds: s.selectedLayerIds.filter((x) => x !== id),
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  patchTemplateMeta: (patch) => {
    const t = get().template;
    const next: CardTypeTemplate = {
      ...t,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.size !== undefined
        ? {
            size: {
              width: Math.max(1, Math.round(patch.size.width)),
              height: Math.max(1, Math.round(patch.size.height)),
            },
          }
        : {}),
      ...(patch.bleed !== undefined
        ? { bleed: Math.max(0, Math.round(patch.bleed)) }
        : {}),
      ...(patch.safeZone !== undefined
        ? { safeZone: Math.max(0, Math.round(patch.safeZone)) }
        : {}),
      ...(patch.dpi !== undefined
        ? { dpi: Math.max(1, Math.round(patch.dpi)) }
        : {}),
      ...(patch.background !== undefined
        ? { background: patch.background }
        : {}),
    };
    set((s) => ({
      template: next,
      history: pushPast(get().history, t),
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  setViewport: (next) => set({ viewport: next }),
  resetViewport: () => set({ viewport: initialViewport }),
  toggleOverlay: (key) =>
    set((s) => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),

  loadTemplate: (next) =>
    set({
      template: next,
      selectedLayerIds: [],
      viewport: initialViewport,
      history: initialHistory,
      // File-loaded templates are NOT bound to a server template — clearing
      // these makes the "Save" button correctly fall through to "no API binding".
      activeTemplateId: null,
      lastSavedTemplate: null,
      serverTemplateVersion: null,
      saveStatus: "idle",
    }),

  resetToSample: () =>
    set({
      template: sampleTemplate,
      selectedLayerIds: [],
      viewport: initialViewport,
      history: initialHistory,
      activeTemplateId: null,
      lastSavedTemplate: null,
      serverTemplateVersion: null,
      saveStatus: "idle",
    }),

  // ----- history -----
  commit: () => {
    set({ history: pushPast(get().history, get().template) });
  },

  undo: () => {
    const { past, future } = get().history;
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const current = get().template;
    set((s) => ({
      template: previous,
      history: { past: past.slice(0, -1), future: [...future, current] },
      // Drop selection ids that don't exist in the restored template.
      selectedLayerIds: s.selectedLayerIds.filter((id) =>
        previous.layers.some((l) => l.id === id),
      ),
      saveStatus: deriveStatus({ ...s, template: previous }),
    }));
  },

  redo: () => {
    const { past, future } = get().history;
    if (future.length === 0) return;
    const nextTemplate = future[future.length - 1];
    const current = get().template;
    set((s) => ({
      template: nextTemplate,
      history: { past: [...past, current], future: future.slice(0, -1) },
      selectedLayerIds: s.selectedLayerIds.filter((id) =>
        nextTemplate.layers.some((l) => l.id === id),
      ),
      saveStatus: deriveStatus({ ...s, template: nextTemplate }),
    }));
  },

  // ----- preview data -----
  setPreviewField: (field, value) => {
    const t = get().template;
    const previewData = { ...(t.previewData ?? {}), [field]: value };
    const next = { ...t, previewData };
    set((s) => ({ template: next, saveStatus: deriveStatus({ ...s, template: next }) }));
  },

  removePreviewField: (field) => {
    const t = get().template;
    if (!t.previewData) return;
    const previewData = { ...t.previewData };
    delete previewData[field];
    const next = { ...t, previewData };
    set((s) => ({ template: next, saveStatus: deriveStatus({ ...s, template: next }) }));
  },

  // ----- auth -----
  signUp: async ({ email, password, name, invitationToken, tenantSlug }) => {
    const session = await api.signUp({
      email,
      password,
      name,
      ...(invitationToken ? { invitationToken } : {}),
      ...(tenantSlug ? { tenantSlug } : {}),
    });
    set({ currentUser: session.user, lastError: null });
    // Refresh `memberships` so the workspace picker reflects whatever
    // membership the backend created (invite redemption or personal-
    // tenant creation).
    await get().refreshMe();
    // If signup put the user in a tenant, switch to it. Platform-
    // only invitees get session.tenantId === null and stay on the
    // platform host — the level-aware shell takes them from there.
    if (session.tenantId) {
      const me = get().memberships.find((m) => m.tenant.id === session.tenantId);
      if (me) await get().selectTenant(me.tenant.slug);
    } else {
      await api.listTenants().then((tenants) => set({ tenants })).catch(() => {});
    }
  },
  signIn: async ({ email, password }) => {
    const session = await api.signIn({ email, password });
    set({ currentUser: session.user, lastError: null });
    await get().refreshMe();
    // After login, prefer one of the user's tenants over the previously-cached slug.
    const memberships = get().memberships;
    if (memberships.length > 0) {
      const stillMember = memberships.find(
        (m) => m.tenant.slug === get().activeTenantSlug,
      );
      const target = stillMember ?? memberships[0];
      await get().selectTenant(target.tenant.slug);
    }
  },
  signOut: () => {
    api.signOut();
    set({
      currentUser: null,
      memberships: [],
      lastError: null,
    });
    // Don't blow away tenants/projects/cards — read-only header-based access
    // is still allowed in v0 so the UI doesn't go blank on logout.
  },
  refreshMe: async () => {
    if (!api.getAuthToken()) {
      set({ currentUser: null, memberships: [] });
      return;
    }
    try {
      const r = await api.fetchMe();
      set({ currentUser: r.user, memberships: r.memberships, lastError: null });
    } catch {
      // Token rejected — clear it so we don't keep banging on /me forever.
      api.signOut();
      set({ currentUser: null, memberships: [] });
    }
  },

  // ----- tenants -----
  selectTenant: async (slug) => {
    if (!slug) return;
    api.setActiveTenantSlug(slug);
    // Clear all tenant-scoped state. We blow away projects / card types /
    // cards / template — the new tenant has its own.
    set({
      activeTenantSlug: slug,
      projects: [],
      cardTypes: [],
      sets: [],
      cards: [],
      activeProjectId: null,
      activeCardTypeId: null,
      activeTemplateId: null,
      activeCardId: null,
      lastSavedTemplate: null,
      serverTemplateVersion: null,
      template: sampleTemplate,
      history: initialHistory,
      selectedLayerIds: [],
      saveStatus: "loading",
      lastError: null,
    });
    try {
      const projects = await api.listProjects();
      set({ projects });
      if (projects.length > 0) {
        await get().selectProject(projects[0].id);
      } else {
        set({ saveStatus: "idle" });
      }
    } catch (err) {
      set({
        saveStatus: "error",
        lastError: err instanceof Error ? err.message : "tenant switch failed",
      });
    }
  },

  createTenant: async ({ name, slug, tenantType, brandingJson }) => {
    try {
      const tenant = await api.createTenant({
        name,
        slug,
        ...(tenantType ? { tenantType } : {}),
        ...(brandingJson ? { brandingJson } : {}),
      });
      set((s) => ({ tenants: [...s.tenants, tenant], lastError: null }));
      // Switch into the new tenant — it'll be empty until they create a project.
      await get().selectTenant(tenant.slug);
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "create tenant failed" });
    }
  },

  deleteTenant: async (id) => {
    try {
      await api.deleteTenant(id);
      const refreshed = await api.listTenants();
      set({ tenants: refreshed, lastError: null });
      // If we just deleted the active tenant, switch to the first available
      // one (or fall through to an empty UI if none remain).
      const stillActive = refreshed.find(
        (t) => t.slug === get().activeTenantSlug,
      );
      if (!stillActive && refreshed.length > 0) {
        await get().selectTenant(refreshed[0].slug);
      } else if (refreshed.length === 0) {
        set({
          projects: [],
          cardTypes: [],
          sets: [],
          cards: [],
          activeProjectId: null,
          activeCardTypeId: null,
          activeTemplateId: null,
          view: "tenants",
        });
      }
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "delete tenant failed" });
    }
  },

  // ----- API -----
  loadInitial: async () => {
    set({ saveStatus: "loading", lastError: null });
    try {
      // Resolve host context first — `/api/v1/context` is unauth'd
      // and lets us pin tenant + project from the hostname (including
      // custom domains, which the local hostname parser can't see).
      // We do this BEFORE refreshing auth so the auth call carries
      // the host-derived tenant slug and lands at the right scope.
      try {
        const ctx = await api.fetchHostContext();
        set({ hostContext: ctx });
        if (ctx.tenantSlug && ctx.tenantSlug !== get().activeTenantSlug) {
          api.setActiveTenantSlug(ctx.tenantSlug);
          set({ activeTenantSlug: ctx.tenantSlug });
        }
      } catch {
        // /context shouldn't fail in production but we tolerate it —
        // local hostname parser already gave a reasonable seed.
      }
      // Restore the auth session if a token is in localStorage.
      await get().refreshMe();

      // Probe the platform-admin role. Returns `null` for ordinary
      // users; the sidebar uses this to show the cross-tenant
      // Platform entry on the platform host (or anywhere a platform
      // admin happens to be signed in).
      try {
        const role = (await api.fetchPlatformRole()) as
          | "owner"
          | "admin"
          | "support"
          | null;
        set({ platformRole: role });
      } catch {
        set({ platformRole: null });
      }
      // Load the tenant list first so the UI can render the picker / TenantsView.
      // If the seeded "demo" tenant is missing (e.g. fresh DB), fall back to
      // whichever tenant comes first.
      const tenants = await api.listTenants();
      set({ tenants });
      if (tenants.length === 0) {
        set({ saveStatus: "idle" });
        return;
      }
      const activeSlug = get().activeTenantSlug;
      const matchedTenant = tenants.find((t) => t.slug === activeSlug) ?? tenants[0];
      if (matchedTenant.slug !== activeSlug) {
        api.setActiveTenantSlug(matchedTenant.slug);
        set({ activeTenantSlug: matchedTenant.slug });
      }

      const projects = await api.listProjects();
      set({ projects });
      if (projects.length === 0) {
        set({ saveStatus: "idle" });
        return;
      }

      // Project pinning from host: if the URL is
      // `<project>.<tenant>.<root>`, pre-select that project so the
      // user lands directly in its workspace without flipping the
      // dashboard's project picker manually.
      const ctx = get().hostContext;
      const pinned =
        ctx?.project ? projects.find((p) => p.id === ctx.project!.id) : null;
      const initialProject = pinned ?? projects[0];
      await get().selectProject(initialProject.id);

      // Set the initial view based on host level so tenant-scope hosts
      // start on the projects grid (management) and project-scope hosts
      // start on the dashboard (production stats). Without this we'd
      // boot every host into "dashboard" and the SectionContent guard
      // would briefly redirect, causing a flash.
      if (ctx?.level === "tenant") {
        set({ view: "projects" });
      } else if (ctx?.level === "project") {
        set({ view: "dashboard" });
      }
    } catch (err) {
      set({
        saveStatus: "error",
        lastError: err instanceof Error ? err.message : "load failed",
      });
    }
  },

  selectProject: async (projectId) => {
    set({ saveStatus: "loading", activeProjectId: projectId, lastError: null });
    try {
      // Load card types + sets in parallel — they're both project-scoped and
      // independent. Sets failing to load is non-fatal (we just won't be able
      // to populate the card editor's set picker until a refresh).
      const [cardTypes, sets] = await Promise.all([
        api.listCardTypes(projectId),
        api.listSets({ projectId }).catch(() => [] as CardSet[]),
      ]);
      set({ cardTypes, sets });
      if (cardTypes.length === 0) {
        set({
          activeCardTypeId: null,
          activeTemplateId: null,
          lastSavedTemplate: null,
          serverTemplateVersion: null,
          saveStatus: "idle",
        });
        return;
      }
      await get().selectCardType(cardTypes[0].id);
    } catch (err) {
      set({
        saveStatus: "error",
        lastError: err instanceof Error ? err.message : "project load failed",
      });
    }
  },

  selectCardType: async (cardTypeId) => {
    const cardType = get().cardTypes.find((c) => c.id === cardTypeId);
    if (!cardType) return;
    set({
      activeCardTypeId: cardType.id,
      activeCardId: null,
      selectedLayerIds: [],
      saveStatus: "loading",
      lastError: null,
    });

    // Load cards for this type in parallel with the template fetch — they're
    // independent and we want both visible quickly.
    void api
      .listCards({ projectId: cardType.projectId, cardTypeId: cardType.id })
      .then((cards) => set({ cards }))
      .catch((err) => {
        // Cards failing to load is not fatal — surface as info, leave list empty.
        set({
          cards: [],
          lastError: err instanceof Error ? err.message : "card load failed",
        });
      });

    if (!cardType.activeTemplateId) {
      // Card type has no active template — leave the canvas as-is, mark idle.
      set({
        activeTemplateId: null,
        lastSavedTemplate: null,
        serverTemplateVersion: null,
        saveStatus: "idle",
      });
      return;
    }

    try {
      const template = await api.getTemplate(cardType.activeTemplateId);
      const content = template.contentJson as CardTypeTemplate;

      // Sample-shaped seed templates lack the full layer set — fall back to
      // the bundled sample if the server's content has no layers, so the user
      // never stares at an empty canvas.
      const safeContent =
        Array.isArray(content?.layers) && content.layers.length > 0
          ? content
          : sampleTemplate;

      set({
        template: safeContent,
        lastSavedTemplate: safeContent,
        activeTemplateId: template.id,
        serverTemplateVersion: template.version,
        history: initialHistory,
        selectedLayerIds: [],
        saveStatus: "synced",
      });
    } catch (err) {
      set({
        saveStatus: "error",
        lastError: err instanceof Error ? err.message : "template load failed",
      });
    }
  },

  saveActiveTemplate: async () => {
    const { activeTemplateId, activeCardTypeId, activeProjectId, template, cardTypes } = get();

    // Path 1 — existing template: PATCH the contentJson and bump version.
    if (activeTemplateId) {
      set({ saveStatus: "saving", lastError: null });
      try {
        const updated = await api.updateTemplateContent(activeTemplateId, template);
        set({
          lastSavedTemplate: template,
          serverTemplateVersion: updated.version,
          saveStatus: "synced",
        });
      } catch (err) {
        set({
          saveStatus: "error",
          lastError: err instanceof Error ? err.message : "save failed",
        });
      }
      return;
    }

    // Path 2 — first save for a freshly-created card type: POST a new
    // template and link it as the card type's active template so subsequent
    // saves go through the PATCH path above.
    if (!activeCardTypeId || !activeProjectId) {
      set({
        saveStatus: "error",
        lastError: "Pick a project + card type before saving.",
      });
      return;
    }
    set({ saveStatus: "saving", lastError: null });
    try {
      const cardType = cardTypes.find((c) => c.id === activeCardTypeId);
      const created = await api.createTemplate({
        projectId: activeProjectId,
        cardTypeId: activeCardTypeId,
        name: `${cardType?.name ?? "Template"} v1`,
        contentJson: template,
      });
      // Promote it to the card type's active template.
      const updatedCardType = await api.updateCardType(activeCardTypeId, {
        activeTemplateId: created.id,
      });
      set((s) => ({
        activeTemplateId: created.id,
        lastSavedTemplate: template,
        serverTemplateVersion: created.version,
        saveStatus: "synced",
        cardTypes: s.cardTypes.map((c) => (c.id === updatedCardType.id ? updatedCardType : c)),
      }));
    } catch (err) {
      set({
        saveStatus: "error",
        lastError: err instanceof Error ? err.message : "create template failed",
      });
    }
  },

  updateActiveCardTypeSchema: async (schemaJson) => {
    const { activeCardTypeId } = get();
    if (!activeCardTypeId) {
      set({ lastError: "No active card type." });
      return;
    }
    try {
      const updated = await api.updateCardType(activeCardTypeId, { schemaJson });
      set((s) => ({
        cardTypes: s.cardTypes.map((c) => (c.id === updated.id ? updated : c)),
        lastError: null,
      }));
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "schema save failed" });
    }
  },

  createProject: async ({
    name,
    slug,
    description,
    ownerEmail,
    status,
    brandingJson,
  }) => {
    try {
      const project = await api.createProject({
        name,
        slug,
        description,
        ownerEmail,
        ...(status ? { status } : {}),
        ...(brandingJson ? { brandingJson } : {}),
      });
      // Insert at the front of the list and switch into it.
      set((s) => ({
        projects: [project, ...s.projects],
        lastError: null,
      }));
      await get().selectProject(project.id);
      set({ view: "dashboard" });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "create project failed" });
    }
  },

  deleteProject: async (id) => {
    try {
      await api.deleteProject(id);
      const { activeProjectId } = get();
      // Refresh the project list and pick a fallback project if we just
      // deleted the active one.
      const projects = await api.listProjects();
      set({ projects, lastError: null });
      if (activeProjectId === id) {
        if (projects.length > 0) {
          await get().selectProject(projects[0].id);
        } else {
          set({
            activeProjectId: null,
            activeCardTypeId: null,
            activeTemplateId: null,
            cardTypes: [],
            cards: [],
            view: "projects",
          });
        }
      }
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "delete project failed" });
    }
  },

  createCardType: async ({ name, slug, description }) => {
    const { activeProjectId } = get();
    if (!activeProjectId) {
      set({ lastError: "Pick a project first." });
      return;
    }
    try {
      const cardType = await api.createCardType({
        projectId: activeProjectId,
        name,
        slug,
        description,
        schemaJson: { fields: [] },
      });
      // Switch into the designer for the new card type. We start with the
      // bundled sample template so the canvas isn't empty — the first Save
      // POSTs it as a real template under this card type.
      set((s) => ({
        cardTypes: [cardType, ...s.cardTypes],
        activeCardTypeId: cardType.id,
        activeTemplateId: null,
        lastSavedTemplate: null,
        serverTemplateVersion: null,
        template: sampleTemplate,
        history: initialHistory,
        selectedLayerIds: [],
        view: "designer",
        saveStatus: "dirty",
        lastError: null,
      }));
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "create card type failed" });
    }
  },

  selectCard: (cardId) => {
    if (cardId === null) {
      set({ activeCardId: null });
      return;
    }
    const card = get().cards.find((c) => c.id === cardId);
    if (!card) return;
    const t = get().template;
    // Replace previewData with the card's dataJson so variant rules evaluate
    // against the real card.
    const next = { ...t, previewData: { ...card.dataJson } };
    set((s) => ({
      activeCardId: card.id,
      template: next,
      saveStatus: deriveStatus({ ...s, template: next }),
    }));
  },

  createCardFromPreview: async ({ name, slug }) => {
    const { activeProjectId, activeCardTypeId, template } = get();
    if (!activeProjectId || !activeCardTypeId) {
      set({ lastError: "Pick a project + card type first." });
      return;
    }
    set({ lastError: null });
    try {
      const card = await api.createCard({
        projectId: activeProjectId,
        cardTypeId: activeCardTypeId,
        name,
        slug,
        dataJson: (template.previewData ?? {}) as Record<string, unknown>,
      });
      set((s) => ({ cards: [card, ...s.cards], activeCardId: card.id }));
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "create card failed" });
    }
  },

  saveActiveCardData: async () => {
    const { activeCardId, template } = get();
    if (!activeCardId) {
      set({ lastError: "No active card selected." });
      return;
    }
    try {
      const updated = await api.updateCardData(activeCardId, {
        dataJson: (template.previewData ?? {}) as Record<string, unknown>,
      });
      set((s) => ({
        cards: s.cards.map((c) => (c.id === updated.id ? updated : c)),
        lastError: null,
      }));
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "save card failed" });
    }
  },

  deleteCard: async (cardId) => {
    try {
      await api.deleteCard(cardId);
      set((s) => ({
        cards: s.cards.filter((c) => c.id !== cardId),
        activeCardId: s.activeCardId === cardId ? null : s.activeCardId,
      }));
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : "delete card failed" });
    }
  },

  clearError: () => set({ lastError: null, saveStatus: deriveStatus(get()) }),
}));

/**
 * Selector helpers — kept here so component imports stay tidy.
 * `selectSelectedLayer` returns the *primary* selected layer (first in the
 * selectedLayerIds array). The inspector edits this one even when multiple
 * are selected; bulk operations read the full array directly.
 */
export const selectSelectedLayer = (s: DesignerState): Layer | null => {
  const id = s.selectedLayerIds[0];
  if (!id) return null;
  return s.template.layers.find((l) => l.id === id) ?? null;
};

export const selectIsLayerSelected =
  (id: LayerId) =>
  (s: DesignerState): boolean =>
    s.selectedLayerIds.includes(id);

export const selectActiveProject = (s: DesignerState): Project | null =>
  s.projects.find((p) => p.id === s.activeProjectId) ?? null;

export const selectActiveCardType = (s: DesignerState): CardType | null =>
  s.cardTypes.find((c) => c.id === s.activeCardTypeId) ?? null;

/**
 * Effective navigation level — drives which views the sidebar exposes
 * and which "shell" the user is in. Mirrors the spec's three scopes
 * (sec 9.1):
 *   • "platform" — bare root host, marketing landing.
 *   • "tenant"   — `<tenant>.<root>`, management of the tenant
 *                  (projects, members, branding, domains, CMS, billing).
 *   • "project"  — `<project>.<tenant>.<root>` or the hyphen form;
 *                  card-design tools (card types, cards, assets, etc).
 *
 * Falls back gracefully when host context isn't resolved yet (boot
 * before /context returns) or when the user is on `localhost` in dev.
 * In dev we treat localhost as "tenant" so the management UI is the
 * default rather than the project editor — picking a project from the
 * list takes the user into project scope.
 */
export const selectNavLevel = (
  s: DesignerState,
): "platform" | "tenant" | "project" => {
  const ctx = s.hostContext;
  if (!ctx) {
    // Pre-boot — assume tenant so management UI shows by default.
    return "tenant";
  }
  return ctx.level;
};
