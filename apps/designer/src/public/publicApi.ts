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

import type { Card, CardType, Faction, Lore, Template } from "@/lib/apiTypes";

const API_BASE: string = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL)
  ? import.meta.env.VITE_API_URL
  : "http://localhost:4000";

type PublicCardSummary = Pick<
  Card,
  "id" | "slug" | "name" | "cardTypeId" | "projectId" | "setId" | "collectorNumber" | "rarity" | "dataJson" | "status" | "updatedAt"
>;

interface PublicSet {
  id: string;
  projectId: string;
  blockId?: string | null;
  name: string;
  code: string;
  description: string;
  releaseDate: string | null;
  status: string;
  cardCount?: number;
}

interface PublicTenant {
  name: string;
  slug: string;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(`${API_BASE}${url}`, { credentials: "omit" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`${r.status} ${r.statusText} — ${text || "request failed"}`);
  }
  return (await r.json()) as T;
}

export async function fetchPublicCards(tenantSlug: string, params?: {
  projectId?: string;
  setId?: string;
  q?: string;
}): Promise<{ tenant: PublicTenant; cards: PublicCardSummary[] }> {
  const qs = new URLSearchParams();
  if (params?.projectId) qs.set("projectId", params.projectId);
  if (params?.setId) qs.set("setId", params.setId);
  if (params?.q) qs.set("q", params.q);
  const suffix = qs.toString() ? `?${qs}` : "";
  return get(`/api/public/${encodeURIComponent(tenantSlug)}/cards${suffix}`);
}

export async function fetchPublicCard(
  tenantSlug: string,
  cardSlug: string,
): Promise<{
  card: PublicCardSummary;
  cardType: Pick<CardType, "id" | "name" | "slug" | "schemaJson" | "activeTemplateId"> | null;
  template:
    | (Pick<Template, "id" | "name" | "version"> & { contentJson: unknown })
    | null;
}> {
  return get(
    `/api/public/${encodeURIComponent(tenantSlug)}/cards/${encodeURIComponent(cardSlug)}`,
  );
}

export async function fetchPublicSets(tenantSlug: string): Promise<{ sets: PublicSet[] }> {
  return get(`/api/public/${encodeURIComponent(tenantSlug)}/sets`);
}

export async function fetchPublicFactions(tenantSlug: string): Promise<{ factions: Faction[] }> {
  return get(`/api/public/${encodeURIComponent(tenantSlug)}/factions`);
}

export async function fetchPublicLore(
  tenantSlug: string,
  params?: { kind?: string },
): Promise<{ lore: Lore[] }> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  const suffix = qs.toString() ? `?${qs}` : "";
  return get(`/api/public/${encodeURIComponent(tenantSlug)}/lore${suffix}`);
}

/**
 * Browser-resolvable URL for a public asset blob. Used as <img src> in
 * the gallery's CardRender output — public assets only, by design.
 */
export function publicAssetUrl(tenantSlug: string, assetId: string): string {
  if (!assetId) return "";
  return `${API_BASE}/api/public/${encodeURIComponent(tenantSlug)}/assets/${encodeURIComponent(assetId)}/blob`;
}
