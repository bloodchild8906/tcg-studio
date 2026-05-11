/**
 * API response types — mirror the shapes coming back from apps/api.
 *
 * We deliberately *don't* import Prisma types here — the API is a contract,
 * and the designer should be free to evolve independently. If a field shape
 * drifts, the runtime parser in `api.ts` will surface it loudly.
 *
 * Keep these types narrow: only the fields we actually consume.
 */

import type { CardTypeTemplate } from "@/types";

export interface TenantBranding {
  /** White-label product name. When set, replaces "TCGStudio" in the header. */
  productName?: string;
  /** Hex accent color (e.g. "#d4a24c"). Used by the active-state UI. */
  accentColor?: string;
  /** Asset id of the tenant logo (future — picker not wired yet). */
  logoAssetId?: string;
  /** When true, drops the "Designer" platform badge + tones down platform copy. */
  hidePlatformBranding?: boolean;
  /** Tenant support email surfaced in error toasts / footer (sec 11.3). */
  supportEmail?: string;
  /** Legal entity name shown in exported card footers (sec 11.3). */
  legalName?: string;
  /** Free-form forward-compat slot. */
  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface MembershipWithTenant {
  id: string;
  role: string;
  tenant: Pick<Tenant, "id" | "name" | "slug" | "status" | "brandingJson">;
}

/** A row from the tenant's membership list — focused on the user side. */
export interface TenantMember {
  id: string;
  role: string;
  tenantId: string;
  userId: string;
  createdAt: string;
  user: AuthUser;
}

/** A row from a project's membership list (sec 13.4). */
export interface ProjectMember {
  id: string;
  role: string;
  projectId: string;
  userId: string;
  createdAt: string;
  user: AuthUser;
}

export interface AuthSession {
  user: AuthUser;
  token: string;
  /** Tenant the new user was placed in (only on signup). */
  tenantId?: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  /** trial | active | past_due | suspended | disabled | pending_deletion */
  status: string;
  /** White-label settings (sec 11). Defaults to {} on a new tenant. */
  brandingJson: TenantBranding;
  /** Archetype that drives the dashboard preset + sidebar grouping
   *  defaults. Optional in older API responses. */
  tenantType?: "solo" | "studio" | "publisher" | "school" | "reseller";
  /** Default content locale (sec 47). IETF BCP 47 tag. */
  defaultLocale?: string;
  /** Locales this tenant publishes in. Always includes the default. */
  supportedLocalesJson?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

export interface CardType {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  /** The template this card type renders against by default. */
  activeTemplateId: string | null;
  schemaJson: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Card {
  id: string;
  tenantId: string;
  projectId: string;
  cardTypeId: string;
  /** Optional set membership; null while the card is set-less. */
  setId: string | null;
  name: string;
  slug: string;
  /** Schema-keyed values: { name: "Ember Knight", cost: 3, … } */
  dataJson: Record<string, unknown>;
  status: string;
  rarity: string | null;
  collectorNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface KeywordParameter {
  name: string;
  type: "number" | "text";
  min?: number;
  max?: number;
  default?: number | string;
}

export interface Keyword {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  /** Short italicized line shown on cards. */
  reminderText: string;
  /** Long-form formal definition for the rulebook. */
  rulesDefinition: string;
  /** Author-defined category — evergreen / deciduous / set-specific / general. */
  category: string;
  /** Structured parameter shape — empty for nullary keywords. */
  parametersJson: KeywordParameter[];
  iconAssetId: string | null;
  /** Hex color used by the glossary entry / icon. */
  color: string | null;
  /** draft | approved | deprecated */
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Faction (sec 28). Identity / mechanics / visuals — the variant system
 * uses these to swap card art per-faction without per-card overrides.
 */
export interface Faction {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  /** Hex color used on badges / variant tinting (e.g. "#b34a40"). */
  color: string;
  /** Optional faction icon asset id — small, used in cost slots /
   *  badges / picker tiles. */
  iconAssetId: string | null;
  /** Optional faction banner / portrait asset id — large-format art
   *  used on lore pages, public faction profile, faction-pick header,
   *  and decklist hero strips. Distinct from `iconAssetId` so each
   *  can be sized for its surface. */
  imageAssetId: string | null;
  /** Optional default frame art asset id used by variant rules. */
  frameAssetId: string | null;
  /** Free-form list of associated keyword slugs / mechanic names. */
  mechanicsJson: string[];
  /** Long-form lore / character notes for the rulebook + public CMS. */
  lore: string;
  /** draft | approved | deprecated */
  status: string;
  /** Display order within the project (lower = earlier in pickers). */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pack-generation rules attached to a Set (sec 27.4).
 *
 * The pack generator draws cards in slot order, filtering the set's
 * cards by `slot.rarity` and pulling `slot.count` distinct entries.
 * `duplicates: true` allows the same card to appear twice in one pack.
 * `weights` lets a slot bias toward specific rarities (e.g. a "rare" slot
 * that yields a mythic 1/8 of the time).
 */
export interface PackSlot {
  rarity: string;
  count: number;
  weights?: Record<string, number>;
}

/** Pack-type discriminator from sec 27.4. */
export type PackKind =
  | "booster"
  | "starter_deck"
  | "draft"
  | "promo"
  | "fixed"
  | "random"
  | "faction_pack"
  | "sealed_pool"
  | "commander_deck"
  | "custom";

/**
 * One named pack profile inside a set's `packRulesJson.profiles` array.
 * The same set may ship with a Booster (15 cards) and a Starter Deck
 * (60 cards) — each is its own profile with its own slot rules.
 */
export interface PackProfile {
  /** Stable id for diffing — generated client-side. */
  id: string;
  name: string;
  kind: PackKind;
  slots: PackSlot[];
  totalCount?: number;
  duplicates?: boolean;
}

/**
 * Multi-profile container persisted on Set.packRulesJson.
 *
 * Backwards-compat with the legacy single-rules shape: when the stored
 * blob has `slots` at the top level (no `profiles` array), the loader
 * upgrades it on read into a single "Booster" profile. Saves always go
 * out as `{ profiles: [...] }` so future loads stay clean.
 */
export interface PackRules {
  profiles: PackProfile[];
}

/**
 * One zone on a board layout (sec 26). Lives inside `BoardLayout.zonesJson`.
 *
 * `kind` is a free-form discriminator — common values: deck / hand /
 * discard / exile / battlefield / resource / command / sideboard /
 * shared / token / custom. The playtest engine uses `kind` to drive
 * default behavior (e.g. "deck" zones support shuffle + draw, "hand"
 * zones default to private visibility, etc.).
 */
export interface BoardZone {
  id: string;
  name: string;
  kind: string;
  bounds: { x: number; y: number; width: number; height: number };
  /** "p1" | "p2" | "shared" — drives interaction permissions. */
  owner: string;
  /** "public" | "private" | "owner_only" — affects card-back rendering. */
  visibility: string;
  /** stacked | spread | row | grid | fan — drives card layout within the zone. */
  stackMode: string;
  rotation?: number;
  color?: string;
  maxCards?: number;
  /** Free-form per-zone metadata (e.g. starting hand size for deck zones). */
  [key: string]: unknown;
}

/**
 * Board layout (sec 26) — playmat / play area with named zones. The
 * playtest view consumes this at runtime to lay out a game session.
 */
export interface BoardLayout {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  width: number;
  height: number;
  background: string;
  zonesJson: BoardZone[];
  metadataJson: Record<string, unknown>;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One card slot in a deck (sec 30) — composite reference + quantity.
 * `sideboard` flag separates main vs side. The deck-detail endpoint
 * embeds the underlying card summary for cheap rendering.
 */
export interface DeckCard {
  id: string;
  deckId: string;
  cardId: string;
  quantity: number;
  sideboard: boolean;
  category: string;
  card?: {
    id: string;
    name: string;
    slug: string;
    rarity: string | null;
    cardTypeId: string;
    setId: string | null;
    dataJson: Record<string, unknown> | null;
  };
}

/**
 * A deck (sec 30) — curated card list + format + visibility. Cards live
 * on a separate row; the deck record carries identity and metadata.
 */
export interface Deck {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  format: string;
  factionId: string | null;
  setId: string | null;
  coverAssetId: string | null;
  /** draft | testing | locked | published | archived */
  status: string;
  /** private | tenant_internal | project_internal | public */
  visibility: string;
  metadataJson: Record<string, unknown>;
  sortOrder: number;
  /** Total slot count (sum of quantities). Available on list responses. */
  cardCount?: number;
  /** Embedded card list — only present on detail responses. */
  cards?: DeckCard[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Visual badge stamped on cards to mark a printing variant: foil,
 * promo, showcase, alt-art, language, championship, etc.
 *
 * Cards opt in via `dataJson.variantBadges: string[]` (badge ids), or
 * automatically via the badge's `conditionJson` evaluating against the
 * card's data. The renderer's `variant_badge` layer type stamps each
 * matching badge at its configured `position`.
 */
export interface VariantBadge {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  /** Short text rendered on the badge ("FOIL", "PROMO"). Empty = icon-only. */
  label: string;
  /** Optional icon asset id from the project's library. */
  iconAssetId: string | null;
  /** Hex color for the badge background. */
  color: string;
  /** Hex color for the badge label / icon. */
  textColor: string;
  /** circle | rounded | banner | star | shield */
  shape: string;
  /** top_left | top_right | bottom_left | bottom_right | bottom_center */
  position: string;
  /** Auto-apply rule against card.dataJson. Empty object = manual only. */
  conditionJson: Record<string, unknown>;
  /** draft | active | archived */
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Discriminator for Ability.kind. */
export type AbilityKind =
  | "static"
  | "triggered"
  | "activated"
  | "replacement"
  | "prevention"
  | "resource"
  | "combat";

/**
 * Ability (sec 24) — reusable rules-text fragment. Cards reference
 * abilities by id from `dataJson.abilities`. The visual graph editor
 * (sec 24.2) lives in `graphJson` — empty for now.
 */
export interface Ability {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  kind: AbilityKind;
  text: string;
  reminderText: string;
  trigger: string;
  cost: string;
  keywordId: string | null;
  relatedCardIds: string[];
  graphJson: Record<string, unknown>;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Ruleset (sec 23) — a project's gameplay-rules definition. The full
 * config (phases, win conditions, custom actions, …) lives in
 * `configJson` whose shape is the engine's `RulesetConfig`.
 */
export interface Ruleset {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  /**
   * The runtime config consumed by the playtest engine. Typed as
   * unknown here so the API client doesn't have to import the engine —
   * the playtest layer narrows it via `configJson as RulesetConfig`.
   */
  configJson: unknown;
  status: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lore relation reference (sec 29). Points at a card / faction / set /
 * other lore entry — kind + id (or slug). Renderers turn these into
 * clickable cross-references on the public site.
 */
export interface LoreRelation {
  kind: "card" | "faction" | "set" | "lore";
  id?: string;
  slug?: string;
  label?: string;
}

/** Discriminator for Lore.kind. */
export type LoreKind =
  | "world"
  | "region"
  | "character"
  | "artifact"
  | "event"
  | "timeline"
  | "chapter"
  | "custom";

/**
 * Lore entry (sec 29) — worldbuilding records. Single model handles
 * many kinds via `kind` discriminator. Body is markdown.
 */
export interface Lore {
  id: string;
  tenantId: string;
  projectId: string;
  kind: LoreKind;
  name: string;
  slug: string;
  summary: string;
  body: string;
  coverAssetId: string | null;
  factionId: string | null;
  setId: string | null;
  relationsJson: LoreRelation[];
  metadataJson: Record<string, unknown>;
  /** private | internal | public_after_release | public */
  visibility: string;
  /** draft | review | approved | released | archived */
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Block (sec 27.3) — groups related sets within a project. Story-arc
 * level container. Sets without a block are valid (one-shot promo).
 */
export interface Block {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  color: string;
  sortOrder: number;
  metadataJson: Record<string, unknown>;
  /** draft | active | concluded | archived */
  status: string;
  /** Number of sets currently grouped under this block. */
  setCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CardSet {
  id: string;
  tenantId: string;
  projectId: string;
  /** Optional parent block — sets can stand alone. */
  blockId?: string | null;
  name: string;
  /** Short uppercase code printed on cards (e.g. "CORE", "MYT"). */
  code: string;
  description: string;
  releaseDate: string | null;
  /** draft | design | playtesting | locked | released | archived */
  status: string;
  /** Pack rules — empty object means "no profile defined". */
  packRulesJson?: PackRules | Record<string, never>;
  /** Number of cards currently assigned to this set. */
  cardCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetMetadata {
  /** 9-slice insets in source-image px. Picked up by image layers automatically. */
  slice?: { top: number; right: number; bottom: number; left: number };
  /**
   * 25-slice insets in source-image px — two cuts per side (outer +
   * inner). When present takes precedence over `slice` at the layer
   * renderer. See `TwentyFiveSlice` in `src/types.ts` for the layout.
   */
  slice25?: {
    outerTop: number;
    outerRight: number;
    outerBottom: number;
    outerLeft: number;
    innerTop: number;
    innerRight: number;
    innerBottom: number;
    innerLeft: number;
  };
  /** Free-form tags for filtering / search later. */
  tags?: string[];
  /** Optional license + author strings (sec 20.3). */
  license?: string;
  author?: string;
  /**
   * How many source pixels equal one logical unit. Used by the designer to
   * size layers in units (e.g. snap a sprite to its natural unit count) and
   * by export pipelines to keep pixel-art crisp regardless of card scale.
   * Absent or 0 means "unset" — consumers fall back to raw pixel sizing.
   */
  pixelsPerUnit?: number;
  /** Anything else — clients may store custom metadata; the API doesn't validate. */
  [key: string]: unknown;
}

export interface Asset {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  slug: string;
  type: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  storageKey: string;
  visibility: string;
  metadataJson: AssetMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  tenantId: string;
  projectId: string;
  cardTypeId: string;
  name: string;
  version: number;
  /** Free-form payload — for the Card Type Designer this is `CardTypeTemplate`. */
  contentJson: CardTypeTemplate | unknown;
  status: string;
  createdAt: string;
  updatedAt: string;
}
