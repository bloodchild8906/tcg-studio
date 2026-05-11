import type {
  Ability,
  Card,
  CardSet,
  CardType,
  Deck,
  Faction,
  Keyword,
  Lore,
} from "@/lib/apiTypes";

/**
 * Project-wide validator.
 *
 * Pure function over an already-loaded bundle of project resources.
 * Produces a triaged list of Issues — each issue carries a severity, a
 * category for filtering, a human-readable message, optional details,
 * and an `entity` reference so the UI can offer "open this card" /
 * "open this deck" navigation links.
 *
 * Why pure-function: the same routine drives the validation overview
 * UI today and (later) a CI-style pre-publish gate that runs server-
 * side or in a build pipeline. Keeping no I/O / no DOM means we can
 * unit-test it trivially and embed it anywhere.
 *
 * Ordering of checks: cheap structural checks first (broken refs,
 * duplicate slugs), then expensive cross-walks (deck-card resolution,
 * usage analysis), then "informational" sweeps that flag unused
 * taxonomy entries the author may want to clean up.
 */

export type IssueSeverity = "info" | "warning" | "error";

export type IssueCategory =
  | "identity" // missing name, slug, etc.
  | "reference" // broken cross-references between resources
  | "duplication" // collisions on slug / code
  | "schema" // schema-required fields missing
  | "orphans" // resources nothing references (info-level)
  | "consistency"; // semantic mismatches (e.g. set has 0 cards)

export type EntityKind =
  | "card"
  | "card_type"
  | "set"
  | "deck"
  | "faction"
  | "keyword"
  | "ability"
  | "lore";

export interface Issue {
  /** Stable id — derived from category + entity so the UI can de-dup. */
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  /** Short user-facing message. */
  message: string;
  /** Optional extra context (multi-line OK). */
  detail?: string;
  /** Pointer back to the resource the issue belongs to. */
  entity?: { kind: EntityKind; id: string; name: string };
}

export interface ProjectValidationBundle {
  cards: Card[];
  cardTypes: CardType[];
  sets: CardSet[];
  decks: Deck[];
  factions: Faction[];
  keywords: Keyword[];
  abilities: Ability[];
  lore: Lore[];
}

/**
 * Run every check against the bundle. Returns issues in deterministic
 * order: errors first, then warnings, then infos; within a severity
 * level we keep insertion order so deeper issues group near the top
 * of their related resource.
 */
export function validateProject(bundle: ProjectValidationBundle): Issue[] {
  const issues: Issue[] = [];

  // ----- Build look-up indexes once. Repeating these inside each rule
  //       would make the validator quadratic in the number of cards.
  const cardById = new Map<string, Card>();
  const cardBySlug = new Map<string, Card[]>();
  for (const c of bundle.cards) {
    cardById.set(c.id, c);
    const arr = cardBySlug.get(c.slug);
    if (arr) arr.push(c);
    else cardBySlug.set(c.slug, [c]);
  }
  const setById = new Map<string, CardSet>();
  const setByCode = new Map<string, CardSet[]>();
  for (const s of bundle.sets) {
    setById.set(s.id, s);
    const arr = setByCode.get(s.code);
    if (arr) arr.push(s);
    else setByCode.set(s.code, [s]);
  }
  const factionBySlug = new Map<string, Faction>();
  for (const f of bundle.factions) factionBySlug.set(f.slug, f);
  const keywordBySlug = new Map<string, Keyword>();
  for (const k of bundle.keywords) keywordBySlug.set(k.slug, k);
  const abilityById = new Map<string, Ability>();
  const abilityBySlug = new Map<string, Ability>();
  for (const a of bundle.abilities) {
    abilityById.set(a.id, a);
    abilityBySlug.set(a.slug, a);
  }
  const cardTypeById = new Map<string, CardType>();
  for (const ct of bundle.cardTypes) cardTypeById.set(ct.id, ct);

  // Track usage so we can flag unused taxonomy entries at the end.
  const usedFactionSlugs = new Set<string>();
  const usedKeywordSlugs = new Set<string>();
  const usedAbilityIds = new Set<string>();
  const usedSetIds = new Set<string>();
  const usedCardTypeIds = new Set<string>();

  /* ----- Cards ----- */
  for (const c of bundle.cards) {
    if (!c.name?.trim()) {
      issues.push({
        id: `card-${c.id}-no-name`,
        severity: "error",
        category: "identity",
        message: `Card has no name`,
        entity: { kind: "card", id: c.id, name: c.slug || c.id },
      });
    }
    if (!c.slug?.trim()) {
      issues.push({
        id: `card-${c.id}-no-slug`,
        severity: "error",
        category: "identity",
        message: `Card "${c.name}" has no slug`,
        entity: { kind: "card", id: c.id, name: c.name || c.id },
      });
    }
    // Duplicate slug — only report once per slug, on the second+ card.
    const slugDupes = c.slug ? cardBySlug.get(c.slug) ?? [] : [];
    if (slugDupes.length > 1 && slugDupes[0].id !== c.id) {
      issues.push({
        id: `card-dup-slug-${c.id}`,
        severity: "error",
        category: "duplication",
        message: `Duplicate card slug "${c.slug}"`,
        detail: `Also used by card ${slugDupes[0].name} (${slugDupes[0].id.slice(0, 8)})`,
        entity: { kind: "card", id: c.id, name: c.name },
      });
    }
    // Card type reference.
    if (c.cardTypeId && !cardTypeById.has(c.cardTypeId)) {
      issues.push({
        id: `card-${c.id}-bad-card-type`,
        severity: "error",
        category: "reference",
        message: `Card "${c.name}" references a missing card type`,
        detail: `cardTypeId = ${c.cardTypeId}`,
        entity: { kind: "card", id: c.id, name: c.name },
      });
    } else if (c.cardTypeId) {
      usedCardTypeIds.add(c.cardTypeId);
    }
    // Set reference.
    if (c.setId) {
      if (!setById.has(c.setId)) {
        issues.push({
          id: `card-${c.id}-bad-set`,
          severity: "error",
          category: "reference",
          message: `Card "${c.name}" references a missing set`,
          detail: `setId = ${c.setId}`,
          entity: { kind: "card", id: c.id, name: c.name },
        });
      } else {
        usedSetIds.add(c.setId);
      }
    }

    // Faction / keywords / abilities references via dataJson.
    const data = (c.dataJson as Record<string, unknown> | null) ?? {};
    const factionSlug = typeof data.faction === "string" ? data.faction : null;
    if (factionSlug) {
      if (!factionBySlug.has(factionSlug.toLowerCase())) {
        issues.push({
          id: `card-${c.id}-bad-faction`,
          severity: "warning",
          category: "reference",
          message: `Card "${c.name}" references unknown faction "${factionSlug}"`,
          entity: { kind: "card", id: c.id, name: c.name },
        });
      } else {
        usedFactionSlugs.add(factionSlug.toLowerCase());
      }
    }
    if (Array.isArray(data.factions)) {
      for (const slug of data.factions as unknown[]) {
        if (typeof slug !== "string") continue;
        if (!factionBySlug.has(slug.toLowerCase())) {
          issues.push({
            id: `card-${c.id}-bad-faction-${slug}`,
            severity: "warning",
            category: "reference",
            message: `Card "${c.name}" references unknown faction "${slug}"`,
            entity: { kind: "card", id: c.id, name: c.name },
          });
        } else {
          usedFactionSlugs.add(slug.toLowerCase());
        }
      }
    }
    if (Array.isArray(data.keywords)) {
      for (const slug of data.keywords as unknown[]) {
        if (typeof slug !== "string") continue;
        if (!keywordBySlug.has(slug.toLowerCase())) {
          issues.push({
            id: `card-${c.id}-bad-keyword-${slug}`,
            severity: "warning",
            category: "reference",
            message: `Card "${c.name}" tagged with unknown keyword "${slug}"`,
            entity: { kind: "card", id: c.id, name: c.name },
          });
        } else {
          usedKeywordSlugs.add(slug.toLowerCase());
        }
      }
    }
    if (Array.isArray(data.abilities)) {
      for (const id of data.abilities as unknown[]) {
        if (typeof id !== "string") continue;
        // Ability lookups try id first (the canonical reference), then
        // slug (in case authors are using slugs from older imports).
        if (!abilityById.has(id) && !abilityBySlug.has(id.toLowerCase())) {
          issues.push({
            id: `card-${c.id}-bad-ability-${id}`,
            severity: "warning",
            category: "reference",
            message: `Card "${c.name}" references unknown ability "${id}"`,
            entity: { kind: "card", id: c.id, name: c.name },
          });
        } else {
          const resolved = abilityById.get(id) ?? abilityBySlug.get(id.toLowerCase());
          if (resolved) usedAbilityIds.add(resolved.id);
        }
      }
    }

    // Schema validation — required fields with empty values.
    const cardType = c.cardTypeId ? cardTypeById.get(c.cardTypeId) : null;
    if (cardType?.schemaJson) {
      const schema = cardType.schemaJson as { fields?: Array<{ key: string; required?: boolean }> };
      for (const field of schema.fields ?? []) {
        if (!field.required) continue;
        const value = data[field.key];
        if (value === undefined || value === null || value === "") {
          issues.push({
            id: `card-${c.id}-missing-${field.key}`,
            severity: "warning",
            category: "schema",
            message: `Card "${c.name}" is missing required field "${field.key}"`,
            entity: { kind: "card", id: c.id, name: c.name },
          });
        }
      }
    }
  }

  /* ----- Sets ----- */
  for (const s of bundle.sets) {
    if (!s.code?.trim()) {
      issues.push({
        id: `set-${s.id}-no-code`,
        severity: "error",
        category: "identity",
        message: `Set "${s.name}" has no code`,
        entity: { kind: "set", id: s.id, name: s.name },
      });
    }
    const codeDupes = s.code ? setByCode.get(s.code) ?? [] : [];
    if (codeDupes.length > 1 && codeDupes[0].id !== s.id) {
      issues.push({
        id: `set-dup-code-${s.id}`,
        severity: "error",
        category: "duplication",
        message: `Duplicate set code "${s.code}"`,
        detail: `Also used by set "${codeDupes[0].name}"`,
        entity: { kind: "set", id: s.id, name: s.name },
      });
    }
    // Released sets without cards smell like a typo / forgotten step.
    if (s.status === "released" && !usedSetIds.has(s.id)) {
      issues.push({
        id: `set-${s.id}-empty`,
        severity: "warning",
        category: "consistency",
        message: `Released set "${s.name}" (${s.code}) has 0 cards`,
        entity: { kind: "set", id: s.id, name: s.name },
      });
    }
  }

  /* ----- Decks ----- */
  for (const d of bundle.decks) {
    if (!d.cards) continue; // list responses omit; only checked when hydrated
    for (const slot of d.cards) {
      if (!cardById.has(slot.cardId)) {
        issues.push({
          id: `deck-${d.id}-bad-card-${slot.cardId}`,
          severity: "error",
          category: "reference",
          message: `Deck "${d.name}" references a missing card`,
          detail: `cardId = ${slot.cardId} (${slot.quantity} copies, ${slot.sideboard ? "sideboard" : "main"})`,
          entity: { kind: "deck", id: d.id, name: d.name },
        });
      }
    }
    if (d.factionId && !bundle.factions.some((f) => f.id === d.factionId)) {
      issues.push({
        id: `deck-${d.id}-bad-faction`,
        severity: "warning",
        category: "reference",
        message: `Deck "${d.name}" references a missing faction`,
        detail: `factionId = ${d.factionId}`,
        entity: { kind: "deck", id: d.id, name: d.name },
      });
    }
    if (d.setId && !setById.has(d.setId)) {
      issues.push({
        id: `deck-${d.id}-bad-set`,
        severity: "warning",
        category: "reference",
        message: `Deck "${d.name}" references a missing set`,
        detail: `setId = ${d.setId}`,
        entity: { kind: "deck", id: d.id, name: d.name },
      });
    }
  }

  /* ----- Lore ----- */
  for (const l of bundle.lore) {
    if (l.factionId && !bundle.factions.some((f) => f.id === l.factionId)) {
      issues.push({
        id: `lore-${l.id}-bad-faction`,
        severity: "warning",
        category: "reference",
        message: `Lore "${l.name}" references a missing faction`,
        entity: { kind: "lore", id: l.id, name: l.name },
      });
    }
    if (l.setId && !setById.has(l.setId)) {
      issues.push({
        id: `lore-${l.id}-bad-set`,
        severity: "warning",
        category: "reference",
        message: `Lore "${l.name}" references a missing set`,
        entity: { kind: "lore", id: l.id, name: l.name },
      });
    }
    if (Array.isArray(l.relationsJson)) {
      for (const rel of l.relationsJson) {
        if (rel.kind === "card" && rel.id && !cardById.has(rel.id)) {
          issues.push({
            id: `lore-${l.id}-rel-${rel.id}`,
            severity: "info",
            category: "reference",
            message: `Lore "${l.name}" relates to a missing card`,
            detail: `cardId = ${rel.id}`,
            entity: { kind: "lore", id: l.id, name: l.name },
          });
        }
      }
    }
  }

  /* ----- Card types ----- */
  for (const ct of bundle.cardTypes) {
    const schema = (ct.schemaJson as { fields?: unknown[] }) ?? {};
    if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
      issues.push({
        id: `cardtype-${ct.id}-no-schema`,
        severity: "warning",
        category: "schema",
        message: `Card type "${ct.name}" has no schema fields`,
        detail: "Cards under this type can't be authored with structured data until a schema is defined.",
        entity: { kind: "card_type", id: ct.id, name: ct.name },
      });
    }
  }

  /* ----- Abilities — keyword reference ----- */
  for (const a of bundle.abilities) {
    if (a.keywordId && !bundle.keywords.some((k) => k.id === a.keywordId)) {
      issues.push({
        id: `ability-${a.id}-bad-keyword`,
        severity: "warning",
        category: "reference",
        message: `Ability "${a.name}" references a missing keyword`,
        detail: `keywordId = ${a.keywordId}`,
        entity: { kind: "ability", id: a.id, name: a.name },
      });
    }
  }

  /* ----- Orphans (informational) ----- */
  for (const f of bundle.factions) {
    if (!usedFactionSlugs.has(f.slug.toLowerCase())) {
      issues.push({
        id: `faction-${f.id}-unused`,
        severity: "info",
        category: "orphans",
        message: `Faction "${f.name}" is defined but never referenced by a card`,
        entity: { kind: "faction", id: f.id, name: f.name },
      });
    }
  }
  for (const k of bundle.keywords) {
    if (!usedKeywordSlugs.has(k.slug.toLowerCase())) {
      issues.push({
        id: `keyword-${k.id}-unused`,
        severity: "info",
        category: "orphans",
        message: `Keyword "${k.name}" is defined but never tagged on a card`,
        entity: { kind: "keyword", id: k.id, name: k.name },
      });
    }
  }
  for (const a of bundle.abilities) {
    if (!usedAbilityIds.has(a.id)) {
      issues.push({
        id: `ability-${a.id}-unused`,
        severity: "info",
        category: "orphans",
        message: `Ability "${a.name}" is defined but never attached to a card`,
        entity: { kind: "ability", id: a.id, name: a.name },
      });
    }
  }
  for (const ct of bundle.cardTypes) {
    if (!usedCardTypeIds.has(ct.id)) {
      issues.push({
        id: `cardtype-${ct.id}-unused`,
        severity: "info",
        category: "orphans",
        message: `Card type "${ct.name}" has no cards`,
        entity: { kind: "card_type", id: ct.id, name: ct.name },
      });
    }
  }

  // Sort: errors first, warnings, then infos. Within a tier, keep
  // insertion order — that groups related issues together since we
  // walked resources in turn.
  const severityRank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  return issues
    .map((issue, idx) => ({ issue, idx }))
    .sort((a, b) => {
      const sa = severityRank[a.issue.severity];
      const sb = severityRank[b.issue.severity];
      if (sa !== sb) return sa - sb;
      return a.idx - b.idx;
    })
    .map((entry) => entry.issue);
}

/**
 * Quick aggregate counts for the validation overview header — by
 * severity and category, so the UI can show "12 errors, 38 warnings,
 * 5 info" without re-walking the issue list per chip.
 */
export function summarizeIssues(issues: Issue[]): {
  bySeverity: Record<IssueSeverity, number>;
  byCategory: Record<IssueCategory, number>;
  total: number;
} {
  const bySeverity: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  const byCategory: Record<IssueCategory, number> = {
    identity: 0,
    reference: 0,
    duplication: 0,
    schema: 0,
    orphans: 0,
    consistency: 0,
  };
  for (const i of issues) {
    bySeverity[i.severity]++;
    byCategory[i.category]++;
  }
  return { bySeverity, byCategory, total: issues.length };
}
