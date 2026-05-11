import * as api from "@/lib/api";
import type { Project } from "@/lib/apiTypes";
import { RULESET_PRESETS } from "@/lib/playtestEngine";
import type { BoardZone } from "@/lib/apiTypes";

/**
 * One-click bootstrap for empty projects.
 *
 * Creates a sensible default trio: a duel-style ruleset, a 1v1 board,
 * and a basic "Card" card type. After this runs, a fresh project goes
 * from "empty shell" to "ready to draft cards and start playtesting"
 * without the user having to know which sub-views to visit first.
 *
 * Why each piece:
 *   • Ruleset → drives the playtest engine. Without one, the playtest
 *     lobby has nothing to pick.
 *   • Board → defines zones (deck / hand / discard / battlefield).
 *     Without one, the playtest engine can't seat any players.
 *   • Card type → the data shape every card snaps to. Without one,
 *     the cards view can't render the schema-driven editor.
 *
 * Idempotent-ish: each step probes for existing entries and skips
 * creation if the project already has one of that resource. Safe to
 * re-run on a partially-bootstrapped project.
 */
export async function bootstrapProject(project: Project): Promise<{
  rulesetId?: string;
  boardId?: string;
  cardTypeId?: string;
  skipped: string[];
  created: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];
  const result: { rulesetId?: string; boardId?: string; cardTypeId?: string; skipped: string[]; created: string[] } = {
    skipped,
    created,
  };

  // -- Ruleset --
  const existingRulesets = await api.listRulesets({ projectId: project.id }).catch(() => []);
  if (existingRulesets.length > 0) {
    skipped.push(`ruleset (${existingRulesets.length} already exist)`);
    result.rulesetId = existingRulesets[0].id;
  } else {
    const preset = RULESET_PRESETS["duel-1v1"];
    const ruleset = await api.createRuleset({
      projectId: project.id,
      name: preset.name,
      slug: "duel",
      description: preset.description,
      configJson: preset.config,
      isDefault: true,
    });
    created.push(`ruleset "${ruleset.name}"`);
    result.rulesetId = ruleset.id;
  }

  // -- Board --
  const existingBoards = await api.listBoards({ projectId: project.id }).catch(() => []);
  if (existingBoards.length > 0) {
    skipped.push(`board (${existingBoards.length} already exist)`);
    result.boardId = existingBoards[0].id;
  } else {
    const board = await api.createBoard({
      projectId: project.id,
      name: "1v1 Standard",
      slug: "1v1-standard",
      description: "Standard 1v1 playmat — battlefield, hand, deck, discard for two seats.",
      width: 1920,
      height: 1080,
      background: "#1a1d2a",
      zonesJson: defaultDuelZones(),
    });
    created.push(`board "${board.name}"`);
    result.boardId = board.id;
  }

  // -- Card type --
  const existingCardTypes = await api.listCardTypes(project.id).catch(() => []);
  if (existingCardTypes.length > 0) {
    skipped.push(`card type (${existingCardTypes.length} already exist)`);
    result.cardTypeId = existingCardTypes[0].id;
  } else {
    const cardType = await api.createCardType({
      projectId: project.id,
      name: "Card",
      slug: "card",
      description: "Default card type — a sensible starter schema.",
      schemaJson: {
        fields: [
          { key: "type", type: "text", required: false },
          { key: "cost", type: "number", required: false },
          { key: "faction", type: "text", required: false },
          { key: "rules_text", type: "longText", required: false },
          { key: "flavor_text", type: "longText", required: false },
          { key: "power", type: "number", required: false },
          { key: "health", type: "number", required: false },
          { key: "keywords", type: "text", required: false },
          { key: "abilities", type: "abilities", required: false },
          { key: "art", type: "image", required: false },
        ],
      },
    });
    created.push(`card type "${cardType.name}"`);
    result.cardTypeId = cardType.id;
  }

  return result;
}

/**
 * Same default zones the BoardsView uses when an author clicks
 * "+ New board" — kept here so quickstart isn't coupled to a UI
 * component for its seed data.
 */
function defaultDuelZones(): BoardZone[] {
  return [
    {
      id: "p1-battlefield",
      name: "P1 Battlefield",
      kind: "battlefield",
      bounds: { x: 80, y: 540, width: 1500, height: 280 },
      owner: "p1",
      visibility: "public",
      stackMode: "spread",
      color: "#3a4258",
    },
    {
      id: "p2-battlefield",
      name: "P2 Battlefield",
      kind: "battlefield",
      bounds: { x: 80, y: 220, width: 1500, height: 280 },
      owner: "p2",
      visibility: "public",
      stackMode: "spread",
      color: "#3a4258",
    },
    {
      id: "p1-hand",
      name: "P1 Hand",
      kind: "hand",
      bounds: { x: 80, y: 860, width: 1500, height: 180 },
      owner: "p1",
      visibility: "owner_only",
      stackMode: "spread",
      color: "#262c3d",
    },
    {
      id: "p1-deck",
      name: "P1 Deck",
      kind: "deck",
      bounds: { x: 1620, y: 540, width: 220, height: 280 },
      owner: "p1",
      visibility: "private",
      stackMode: "stacked",
      color: "#5a3e3e",
    },
    {
      id: "p1-discard",
      name: "P1 Discard",
      kind: "discard",
      bounds: { x: 1620, y: 860, width: 220, height: 180 },
      owner: "p1",
      visibility: "public",
      stackMode: "stacked",
      color: "#3a3a3e",
    },
    {
      id: "p2-deck",
      name: "P2 Deck",
      kind: "deck",
      bounds: { x: 1620, y: 220, width: 220, height: 280 },
      owner: "p2",
      visibility: "private",
      stackMode: "stacked",
      color: "#5a3e3e",
    },
    {
      id: "p2-discard",
      name: "P2 Discard",
      kind: "discard",
      bounds: { x: 1620, y: 40, width: 220, height: 160 },
      owner: "p2",
      visibility: "public",
      stackMode: "stacked",
      color: "#3a3a3e",
    },
  ];
}
