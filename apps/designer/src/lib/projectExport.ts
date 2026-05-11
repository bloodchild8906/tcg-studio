import * as api from "@/lib/api";
import type { Project } from "@/lib/apiTypes";

/**
 * Project export — bundles everything in a project into one JSON file.
 *
 * Authors use this for:
 *   • backups before risky edits
 *   • snapshotting a release for archival
 *   • sharing a whole game prototype with a co-designer
 *   • migrating a project across tenants (a future Import companion
 *     reads this same shape)
 *
 * The bundle's `version` field identifies the schema. Bumping it when
 * the on-disk shape changes lets a future Import path migrate older
 * exports forward.
 *
 * What we do NOT export:
 *   • asset blob bytes — those are large and the asset records carry
 *     a tenant-internal storage key. Re-uploading is the only way to
 *     reconstitute on import. The export records the asset metadata
 *     so an import can match by slug to assets the user uploads
 *     beforehand.
 *   • templates — they live as `template.contentJson` blobs that are
 *     fairly chunky; we include them so a re-import preserves visual
 *     layouts.
 *   • decks' card list — the DeckCard table is fetched per deck via
 *     getDeck(), which embeds the slot list. The bundle ships those
 *     embedded slots inline so a re-import can rebuild the deck.
 */

export interface ProjectExportBundle {
  /** Schema version — bump when the JSON shape changes. */
  version: 1;
  /** Wall-clock time the export was generated, ISO-8601. */
  exportedAt: string;
  /** Tenant + project identity at export time. */
  project: Pick<Project, "id" | "name" | "slug" | "description" | "status" | "version">;
  cardTypes: unknown[];
  cards: unknown[];
  sets: unknown[];
  blocks: unknown[];
  decks: unknown[];
  boards: unknown[];
  rulesets: unknown[];
  abilities: unknown[];
  factions: unknown[];
  keywords: unknown[];
  lore: unknown[];
  /**
   * Asset metadata only (no blob bytes). On re-import, a future tool
   * can match by `slug` against assets uploaded beforehand.
   */
  assets: Array<{
    id: string;
    name: string;
    slug: string;
    type: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    visibility: string;
    metadataJson: unknown;
  }>;
  /** Counts per resource — useful for at-a-glance summaries on import. */
  counts: Record<string, number>;
}

/**
 * Build the export bundle for a project. Uses Promise.all to fan out
 * concurrent reads against each resource's list endpoint. Decks need a
 * second pass per-deck to grab their card slot lists, since the list
 * endpoint only returns identity + counts.
 */
export async function buildProjectExportBundle(project: Project): Promise<ProjectExportBundle> {
  const [
    cardTypes,
    cards,
    sets,
    blocks,
    decksList,
    boards,
    rulesets,
    abilities,
    factions,
    keywords,
    lore,
    assets,
  ] = await Promise.all([
    api.listCardTypes(project.id),
    api.listCards({ projectId: project.id }),
    api.listSets({ projectId: project.id }),
    api.listBlocks({ projectId: project.id }).catch(() => []),
    api.listDecks({ projectId: project.id }).catch(() => []),
    api.listBoards({ projectId: project.id }).catch(() => []),
    api.listRulesets({ projectId: project.id }).catch(() => []),
    api.listAbilities({ projectId: project.id }).catch(() => []),
    api.listFactions({ projectId: project.id }).catch(() => []),
    api.listKeywords({ projectId: project.id }).catch(() => []),
    api.listLore({ projectId: project.id }).catch(() => []),
    api.listAssets({ projectId: project.id }).catch(() => []),
  ]);

  // Hydrate decks with their slot lists. Sequential to keep memory
  // usage bounded — most projects have < 50 decks; if that grows, we
  // can promote this to a paginated server endpoint.
  const decks = await Promise.all(decksList.map((d) => api.getDeck(d.id).catch(() => d)));

  // Hydrate templates — pull each card type's active template so the
  // visual layout round-trips through the export. We only fetch
  // templates that are actively bound to a card type, since unbound
  // templates are typically work-in-progress drafts the user can
  // re-create from the designer.
  const templates = await Promise.all(
    cardTypes
      .filter((ct) => ct.activeTemplateId)
      .map((ct) =>
        api.getTemplate(ct.activeTemplateId!).catch(() => null),
      ),
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      status: project.status,
      version: project.version,
    },
    cardTypes: cardTypes.map((ct) => {
      const template = templates.find((t) => t && t.id === ct.activeTemplateId);
      return { ...ct, template: template ?? null };
    }),
    cards,
    sets,
    blocks,
    decks,
    boards,
    rulesets,
    abilities,
    factions,
    keywords,
    lore,
    assets: assets.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      type: a.type,
      mimeType: a.mimeType,
      width: a.width,
      height: a.height,
      visibility: a.visibility,
      metadataJson: a.metadataJson,
    })),
    counts: {
      cardTypes: cardTypes.length,
      cards: cards.length,
      sets: sets.length,
      blocks: blocks.length,
      decks: decks.length,
      boards: boards.length,
      rulesets: rulesets.length,
      abilities: abilities.length,
      factions: factions.length,
      keywords: keywords.length,
      lore: lore.length,
      assets: assets.length,
    },
  };
}

/**
 * Trigger a browser download of the bundle as a `.tcgproject.json`
 * file. The filename includes the project's slug + a date stamp for
 * easy at-a-glance identification of multiple snapshots.
 */
export async function downloadProjectExport(project: Project): Promise<void> {
  const bundle = await buildProjectExportBundle(project);
  const json = JSON.stringify(bundle, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeSlug = project.slug.replace(/[^a-z0-9_-]+/gi, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeSlug}.${dateStamp}.tcgproject.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
