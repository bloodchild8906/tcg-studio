/**
 * Public API client. Mirrors the shape of `lib/api.ts` but doesn't carry
 * tenant/auth headers — the public endpoints are unauthenticated and
 * scope themselves via the tenant slug in the URL path.
 *
 * Why a separate module: the public gallery mounts BEFORE the auth wall
 * resolves, so it can't pull from the authenticated client. Keeping the
 * fetch logic isolated also means the public gallery is portable — a
 * future static-site renderer / SDK can import this module standalone.
 */
const API_BASE = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
    ? import.meta.env.VITE_API_URL
    : "http://localhost:4000";
async function get(url) {
    const r = await fetch(`${API_BASE}${url}`, { credentials: "omit" });
    if (!r.ok) {
        const text = await r.text().catch(() => "");
        throw new Error(`${r.status} ${r.statusText} — ${text || "request failed"}`);
    }
    return (await r.json());
}
export async function fetchPublicCards(tenantSlug, params) {
    const qs = new URLSearchParams();
    if (params?.projectId)
        qs.set("projectId", params.projectId);
    if (params?.setId)
        qs.set("setId", params.setId);
    if (params?.q)
        qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get(`/api/public/${encodeURIComponent(tenantSlug)}/cards${suffix}`);
}
export async function fetchPublicCard(tenantSlug, cardSlug) {
    return get(`/api/public/${encodeURIComponent(tenantSlug)}/cards/${encodeURIComponent(cardSlug)}`);
}
export async function fetchPublicSets(tenantSlug) {
    return get(`/api/public/${encodeURIComponent(tenantSlug)}/sets`);
}
export async function fetchPublicFactions(tenantSlug) {
    return get(`/api/public/${encodeURIComponent(tenantSlug)}/factions`);
}
export async function fetchPublicLore(tenantSlug, params) {
    const qs = new URLSearchParams();
    if (params?.kind)
        qs.set("kind", params.kind);
    const suffix = qs.toString() ? `?${qs}` : "";
    return get(`/api/public/${encodeURIComponent(tenantSlug)}/lore${suffix}`);
}
/**
 * Browser-resolvable URL for a public asset blob. Used as <img src> in
 * the gallery's CardRender output — public assets only, by design.
 */
export function publicAssetUrl(tenantSlug, assetId) {
    if (!assetId)
        return "";
    return `${API_BASE}/api/public/${encodeURIComponent(tenantSlug)}/assets/${encodeURIComponent(assetId)}/blob`;
}
