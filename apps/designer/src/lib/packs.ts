import type { Card, PackProfile, PackRules, PackSlot } from "@/lib/apiTypes";

/**
 * Pure-client pack sampler (sec 27.4).
 *
 * Walks the rule's slots in order, filters the candidate pool by each
 * slot's rarity (and optional weighted distribution), and pulls
 * `slot.count` cards. Returns the assembled pack.
 *
 * Why client-side: pack generation is read-only over already-fetched
 * cards. No server round-trip means previewing a pack is instant, and
 * the same routine can later run on the public site for "open a pack"
 * demos without a new endpoint.
 *
 * Determinism: pass a `seed` for reproducible packs (useful in
 * playtesting). Without a seed we use Math.random.
 */
export interface PackResult {
  cards: Card[];
  /** Per-slot diagnostics — useful when a slot couldn't be filled. */
  slots: Array<{
    rarity: string;
    requested: number;
    delivered: number;
    missing?: string;
  }>;
}

export function generatePack(args: {
  /** A single profile to roll. Use generatePackByProfile when you have a
   * full PackRules + a profile name to pick. */
  profile: PackProfile;
  cards: Card[];
  seed?: number;
}): PackResult {
  const rng = args.seed != null ? mulberry32(args.seed) : Math.random;
  const used = new Set<string>();
  const out: Card[] = [];
  const diag: PackResult["slots"] = [];

  // Group source cards by rarity once. Cards without a rarity field land
  // under "unrarity" so authors who haven't tagged anything still get a
  // sample (we only fall back when no slot matches).
  const byRarity = new Map<string, Card[]>();
  for (const c of args.cards) {
    const r = (c.rarity ?? "").toLowerCase() || "unrarity";
    const arr = byRarity.get(r);
    if (arr) arr.push(c);
    else byRarity.set(r, [c]);
  }

  for (const slot of args.profile.slots) {
    const requested = slot.count;
    if (requested <= 0) {
      diag.push({ rarity: slot.rarity, requested, delivered: 0 });
      continue;
    }
    const pool = pickPoolForSlot(slot, byRarity);
    if (pool.length === 0) {
      diag.push({
        rarity: slot.rarity,
        requested,
        delivered: 0,
        missing: `No cards with rarity "${slot.rarity}" in the source pool.`,
      });
      continue;
    }
    let delivered = 0;
    for (let i = 0; i < requested; i++) {
      const candidate = pool[Math.floor(rng() * pool.length)];
      if (!candidate) break;
      // Honour duplicates flag — when false, retry up to a small ceiling
      // so we don't infinite-loop a tiny pool.
      if (!args.profile.duplicates && used.has(candidate.id)) {
        let tries = 0;
        let next: Card | undefined = candidate;
        while (next && used.has(next.id) && tries < 20) {
          next = pool[Math.floor(rng() * pool.length)];
          tries++;
        }
        if (!next || used.has(next.id)) continue;
        used.add(next.id);
        out.push(next);
      } else {
        used.add(candidate.id);
        out.push(candidate);
      }
      delivered++;
    }
    diag.push({ rarity: slot.rarity, requested, delivered });
  }

  return { cards: out, slots: diag };
}

/**
 * Compute the candidate pool for a slot. If the slot has weights,
 * pick a rarity bucket weighted-randomly per draw — this is normally
 * called per-slot, so we expand by re-sampling weights internally.
 *
 * For the simple (no weights) case we return the literal rarity bucket.
 * For weighted slots we return all matching cards from each bucket
 * concatenated (the sampler still picks uniformly inside that union,
 * which gives an approximate mix). True weighted sampling per draw is
 * an enhancement worth doing later if the unweighted union mis-models
 * actual distributions.
 */
function pickPoolForSlot(
  slot: PackSlot,
  byRarity: Map<string, Card[]>,
): Card[] {
  const r = slot.rarity.toLowerCase();
  if (slot.weights && Object.keys(slot.weights).length > 0) {
    const out: Card[] = [];
    for (const [rarityKey, weight] of Object.entries(slot.weights)) {
      if (weight <= 0) continue;
      const bucket = byRarity.get(rarityKey.toLowerCase()) ?? [];
      // Replicate by integer weight so the union biases toward heavier
      // rarities. Cheap approximation; OK for pack-preview UX.
      const reps = Math.max(1, Math.round(weight * 10));
      for (let i = 0; i < reps; i++) out.push(...bucket);
    }
    return out;
  }
  return byRarity.get(r) ?? [];
}

/** Tiny seedable PRNG for reproducible packs. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Default Booster profile for a new set — common starter that authors
 * can clone or replace. Mirrors the typical 8/3/1 split.
 */
export const DEFAULT_PACK_PROFILE: PackProfile = {
  id: "booster",
  name: "Booster",
  kind: "booster",
  slots: [
    { rarity: "common", count: 8 },
    { rarity: "uncommon", count: 3 },
    { rarity: "rare", count: 1 },
  ],
  duplicates: false,
};

/** Stub for a Starter Deck profile (60-card deck, no rarity gating). */
export const STARTER_DECK_PROFILE: PackProfile = {
  id: "starter",
  name: "Starter Deck",
  kind: "starter_deck",
  slots: [{ rarity: "common", count: 40 }, { rarity: "uncommon", count: 15 }, { rarity: "rare", count: 5 }],
  duplicates: true,
};

/**
 * Normalize the persisted rules blob into the canonical multi-profile
 * shape. Mirrors the API-side normalizer so reads from older sets that
 * never round-tripped still upgrade transparently in the editor.
 */
export function normalizePackRules(input: unknown): PackRules {
  if (!input || typeof input !== "object") {
    return { profiles: [DEFAULT_PACK_PROFILE] };
  }
  const v = input as Record<string, unknown>;
  if (Array.isArray(v.profiles)) {
    return { profiles: (v.profiles as PackProfile[]).filter(Boolean) };
  }
  if (Array.isArray(v.slots)) {
    return {
      profiles: [
        {
          id: "default",
          name: "Booster",
          kind: "booster",
          slots: v.slots as PackSlot[],
          totalCount: typeof v.totalCount === "number" ? v.totalCount : undefined,
          duplicates: typeof v.duplicates === "boolean" ? v.duplicates : false,
        },
      ],
    };
  }
  // Empty object — first-time pack config. Seed with the default Booster
  // so the user has a starting point rather than an empty profile list.
  return { profiles: [DEFAULT_PACK_PROFILE] };
}

/**
 * Suggested defaults for each PackKind — used when adding a new profile
 * via the kind picker. Authors can edit slots afterward.
 */
export const PACK_KIND_DEFAULTS: Record<string, Pick<PackProfile, "name" | "slots" | "duplicates">> = {
  booster: { name: "Booster", slots: [{ rarity: "common", count: 8 }, { rarity: "uncommon", count: 3 }, { rarity: "rare", count: 1 }], duplicates: false },
  starter_deck: { name: "Starter Deck", slots: [{ rarity: "common", count: 40 }, { rarity: "uncommon", count: 15 }, { rarity: "rare", count: 5 }], duplicates: true },
  draft: { name: "Draft Pack", slots: [{ rarity: "common", count: 10 }, { rarity: "uncommon", count: 3 }, { rarity: "rare", count: 1 }], duplicates: false },
  promo: { name: "Promo Pack", slots: [{ rarity: "rare", count: 1 }], duplicates: false },
  fixed: { name: "Fixed Pack", slots: [], duplicates: false },
  random: { name: "Random Pack", slots: [{ rarity: "common", count: 5 }], duplicates: true },
  faction_pack: { name: "Faction Pack", slots: [{ rarity: "common", count: 12 }, { rarity: "rare", count: 1 }], duplicates: false },
  sealed_pool: { name: "Sealed Pool", slots: [{ rarity: "common", count: 30 }, { rarity: "uncommon", count: 12 }, { rarity: "rare", count: 6 }], duplicates: false },
  commander_deck: { name: "Commander Deck", slots: [{ rarity: "common", count: 70 }, { rarity: "uncommon", count: 20 }, { rarity: "rare", count: 10 }], duplicates: false },
  custom: { name: "Custom", slots: [], duplicates: false },
};
