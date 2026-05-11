import { create } from "zustand";
import { sampleTemplate } from "@/data/sampleTemplate";
import * as api from "@/lib/api";
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
let _idCounter = 1;
function nextId(prefix) {
    // Cheap monotonic id generator. Real ids will come from the backend later.
    const stamp = Date.now().toString(36).slice(-4);
    const seq = (_idCounter++).toString(36);
    return `${prefix}_${stamp}${seq}`;
}
/**
 * Build a default new layer of the given type, placed roughly in the middle
 * of the card so the user sees it appear without scrolling.
 */
function makeDefaultLayer(type, size) {
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
    };
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
const initialViewport = { scale: 0.5, x: 60, y: 40 };
const initialHistory = { past: [], future: [] };
/**
 * Snapshot the *current* template into past, clear future. Used by every
 * action that produces a discrete change. Returns the new history object.
 */
function pushPast(history, snapshot) {
    const next = [...history.past, snapshot];
    if (next.length > HISTORY_CAPACITY)
        next.shift();
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
function isDescendantOf(layers, candidateAncestorId, id) {
    if (candidateAncestorId === id)
        return true;
    let cursor = candidateAncestorId;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const node = layers.find((l) => l.id === cursor);
        if (!node)
            return false;
        if (node.parentId === id)
            return true;
        cursor = node.parentId ?? null;
    }
    return false;
}
function deriveStatus(s) {
    // Transient states (loading, saving, error) win — don't override mid-flight.
    if (s.saveStatus === "loading" || s.saveStatus === "saving" || s.saveStatus === "error") {
        return s.saveStatus;
    }
    if (!s.activeTemplateId || !s.lastSavedTemplate)
        return "idle";
    return s.template === s.lastSavedTemplate ? "synced" : "dirty";
}
export const useDesigner = create((set, get) => ({
    template: sampleTemplate,
    selectedLayerIds: [],
    viewport: initialViewport,
    overlays: { grid: true, safeZone: true, bleed: true },
    history: initialHistory,
    view: "dashboard",
    setView: (v) => set({ view: v }),
    currentUser: null,
    memberships: [],
    tenants: [],
    activeTenantSlug: api.getActiveTenantSlug(),
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
            if (mode === "replace")
                return { selectedLayerIds: [id] };
            if (mode === "add") {
                if (cur.includes(id))
                    return s;
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
        if (sel.size === 0)
            return;
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
        if (idx < 0)
            return null;
        const original = t.layers[idx];
        const copy = {
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
        const layers = t.layers.map((l) => l.id === id ? { ...l, ...patch } : l);
        const next = { ...t, layers };
        // Intentionally NOT touching history — caller decides when to commit.
        set((s) => ({ template: next, saveStatus: deriveStatus({ ...s, template: next }) }));
    },
    renameLayer: (id, name) => {
        const t = get().template;
        const layers = t.layers.map((l) => (l.id === id ? { ...l, name } : l));
        const next = { ...t, layers };
        set((s) => ({
            template: next,
            history: pushPast(get().history, t),
            saveStatus: deriveStatus({ ...s, template: next }),
        }));
    },
    toggleVisibility: (id) => {
        const t = get().template;
        const layers = t.layers.map((l) => l.id === id ? { ...l, visible: !l.visible } : l);
        const next = { ...t, layers };
        set((s) => ({
            template: next,
            history: pushPast(get().history, t),
            saveStatus: deriveStatus({ ...s, template: next }),
        }));
    },
    toggleLock: (id) => {
        const t = get().template;
        const layers = t.layers.map((l) => l.id === id ? { ...l, locked: !l.locked } : l);
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
        if (fromIndex < 0)
            return;
        const clamped = Math.max(0, Math.min(toIndex, t.layers.length - 1));
        if (clamped === fromIndex)
            return;
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
        if (parentId && isDescendantOf(t.layers, parentId, id))
            return;
        const layers = t.layers.map((l) => l.id === id ? { ...l, parentId: parentId ?? null } : l);
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
        if (sel.length === 0)
            return null;
        // Position the new group at the index of the topmost selected
        // layer (largest index in the array). Children keep their order;
        // only their parentId changes.
        const indices = sel
            .map((id) => t.layers.findIndex((l) => l.id === id))
            .filter((i) => i >= 0);
        if (indices.length === 0)
            return null;
        const insertAt = Math.max(...indices) + 1;
        const groupLayer = makeDefaultLayer("group", t.size);
        // Inherit parent of the first selected layer so grouping inside
        // an existing group "stays inside" rather than escaping to root.
        const firstSelected = t.layers.find((l) => l.id === sel[0]);
        const parentId = firstSelected?.parentId ?? null;
        const groupWithParent = { ...groupLayer, parentId };
        const selSet = new Set(sel);
        const layers = t.layers.map((l) => selSet.has(l.id) ? { ...l, parentId: groupWithParent.id } : l);
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
        if (!group || group.type !== "group")
            return;
        const newParent = group.parentId ?? null;
        const layers = t.layers
            .map((l) => l.parentId === id ? { ...l, parentId: newParent } : l)
            .filter((l) => l.id !== id);
        const next = { ...t, layers };
        set((s) => ({
            template: next,
            selectedLayerIds: s.selectedLayerIds.filter((x) => x !== id),
            history: pushPast(get().history, t),
            saveStatus: deriveStatus({ ...s, template: next }),
        }));
    },
    setViewport: (next) => set({ viewport: next }),
    resetViewport: () => set({ viewport: initialViewport }),
    toggleOverlay: (key) => set((s) => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),
    loadTemplate: (next) => set({
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
    resetToSample: () => set({
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
        if (past.length === 0)
            return;
        const previous = past[past.length - 1];
        const current = get().template;
        set((s) => ({
            template: previous,
            history: { past: past.slice(0, -1), future: [...future, current] },
            // Drop selection ids that don't exist in the restored template.
            selectedLayerIds: s.selectedLayerIds.filter((id) => previous.layers.some((l) => l.id === id)),
            saveStatus: deriveStatus({ ...s, template: previous }),
        }));
    },
    redo: () => {
        const { past, future } = get().history;
        if (future.length === 0)
            return;
        const nextTemplate = future[future.length - 1];
        const current = get().template;
        set((s) => ({
            template: nextTemplate,
            history: { past: [...past, current], future: future.slice(0, -1) },
            selectedLayerIds: s.selectedLayerIds.filter((id) => nextTemplate.layers.some((l) => l.id === id)),
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
        if (!t.previewData)
            return;
        const previewData = { ...t.previewData };
        delete previewData[field];
        const next = { ...t, previewData };
        set((s) => ({ template: next, saveStatus: deriveStatus({ ...s, template: next }) }));
    },
    // ----- auth -----
    signUp: async ({ email, password, name }) => {
        const session = await api.signUp({ email, password, name });
        set({ currentUser: session.user, lastError: null });
        // The signup flow auto-creates a tenant + membership; refresh the
        // memberships list and tenants so the picker / sidebar update.
        await get().refreshMe();
        // If signup created a brand-new tenant, switch to it.
        if (session.tenantId) {
            const me = get().memberships.find((m) => m.tenant.id === session.tenantId);
            if (me)
                await get().selectTenant(me.tenant.slug);
        }
        else {
            await api.listTenants().then((tenants) => set({ tenants })).catch(() => { });
        }
    },
    signIn: async ({ email, password }) => {
        const session = await api.signIn({ email, password });
        set({ currentUser: session.user, lastError: null });
        await get().refreshMe();
        // After login, prefer one of the user's tenants over the previously-cached slug.
        const memberships = get().memberships;
        if (memberships.length > 0) {
            const stillMember = memberships.find((m) => m.tenant.slug === get().activeTenantSlug);
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
        }
        catch {
            // Token rejected — clear it so we don't keep banging on /me forever.
            api.signOut();
            set({ currentUser: null, memberships: [] });
        }
    },
    // ----- tenants -----
    selectTenant: async (slug) => {
        if (!slug)
            return;
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
            }
            else {
                set({ saveStatus: "idle" });
            }
        }
        catch (err) {
            set({
                saveStatus: "error",
                lastError: err instanceof Error ? err.message : "tenant switch failed",
            });
        }
    },
    createTenant: async ({ name, slug }) => {
        try {
            const tenant = await api.createTenant({ name, slug });
            set((s) => ({ tenants: [...s.tenants, tenant], lastError: null }));
            // Switch into the new tenant — it'll be empty until they create a project.
            await get().selectTenant(tenant.slug);
        }
        catch (err) {
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
            const stillActive = refreshed.find((t) => t.slug === get().activeTenantSlug);
            if (!stillActive && refreshed.length > 0) {
                await get().selectTenant(refreshed[0].slug);
            }
            else if (refreshed.length === 0) {
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
        }
        catch (err) {
            set({ lastError: err instanceof Error ? err.message : "delete tenant failed" });
        }
    },
    // ----- API -----
    loadInitial: async () => {
        set({ saveStatus: "loading", lastError: null });
        try {
            // Restore the auth session if a token is in localStorage.
            await get().refreshMe();
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
            await get().selectProject(projects[0].id);
        }
        catch (err) {
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
                api.listSets({ projectId }).catch(() => []),
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
        }
        catch (err) {
            set({
                saveStatus: "error",
                lastError: err instanceof Error ? err.message : "project load failed",
            });
        }
    },
    selectCardType: async (cardTypeId) => {
        const cardType = get().cardTypes.find((c) => c.id === cardTypeId);
        if (!cardType)
            return;
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
            const content = template.contentJson;
            // Sample-shaped seed templates lack the full layer set — fall back to
            // the bundled sample if the server's content has no layers, so the user
            // never stares at an empty canvas.
            const safeContent = Array.isArray(content?.layers) && content.layers.length > 0
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
        }
        catch (err) {
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
            }
            catch (err) {
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
        }
        catch (err) {
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
        }
        catch (err) {
            set({ lastError: err instanceof Error ? err.message : "schema save failed" });
        }
    },
    createProject: async ({ name, slug, description }) => {
        try {
            const project = await api.createProject({ name, slug, description });
            // Insert at the front of the list and switch into it.
            set((s) => ({
                projects: [project, ...s.projects],
                lastError: null,
            }));
            await get().selectProject(project.id);
            set({ view: "dashboard" });
        }
        catch (err) {
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
                }
                else {
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
        }
        catch (err) {
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
        }
        catch (err) {
            set({ lastError: err instanceof Error ? err.message : "create card type failed" });
        }
    },
    selectCard: (cardId) => {
        if (cardId === null) {
            set({ activeCardId: null });
            return;
        }
        const card = get().cards.find((c) => c.id === cardId);
        if (!card)
            return;
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
                dataJson: (template.previewData ?? {}),
            });
            set((s) => ({ cards: [card, ...s.cards], activeCardId: card.id }));
        }
        catch (err) {
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
                dataJson: (template.previewData ?? {}),
            });
            set((s) => ({
                cards: s.cards.map((c) => (c.id === updated.id ? updated : c)),
                lastError: null,
            }));
        }
        catch (err) {
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
        }
        catch (err) {
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
export const selectSelectedLayer = (s) => {
    const id = s.selectedLayerIds[0];
    if (!id)
        return null;
    return s.template.layers.find((l) => l.id === id) ?? null;
};
export const selectIsLayerSelected = (id) => (s) => s.selectedLayerIds.includes(id);
export const selectActiveProject = (s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null;
export const selectActiveCardType = (s) => s.cardTypes.find((c) => c.id === s.activeCardTypeId) ?? null;
