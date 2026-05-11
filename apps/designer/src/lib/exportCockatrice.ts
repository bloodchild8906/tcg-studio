import * as api from "@/lib/api";
import type { Card, CardSet, Deck, Faction, Project } from "@/lib/apiTypes";

/**
 * Cockatrice export.
 *
 * Cockatrice is a popular open-source online card-game playtesting
 * client. It accepts a "custom card database" XML file and per-deck
 * `.cod` files. Authors can drop the generated XML into Cockatrice's
 * `customsets/` directory to load all of a project's cards, then
 * import a `.cod` file to play with a built deck against another
 * person on Cockatrice's free server.
 *
 * Output format: Cockatrice carddatabase XML version 4. The parser is
 * forgiving — extra elements pass through, missing optional fields
 * default. Spec ref: github.com/Cockatrice/Cockatrice (file
 * `oracle/oracle.xsd` and `cockatrice_carddatabase.xsd`).
 *
 * Two outputs:
 *   1. `<project>.cockatrice.xml`  — the carddatabase, all cards in
 *      one file across every set in the project.
 *   2. `<deck>.cod`                — per-deck Cockatrice deck file
 *      (XML, but a different schema). Built from a Deck + its slots.
 *
 * What we map from TCGStudio cards:
 *   • name        ← card.name
 *   • set         ← card.setId (resolved to set code)
 *   • cmc / cost  ← card.dataJson.cost / .mana / .energy (first numeric)
 *   • type        ← card.dataJson.type or card type's name
 *   • pt          ← card.dataJson.power / health combined as "P/T"
 *   • text        ← card.dataJson.rules_text
 *   • color       ← derived from faction color (heuristic — see below)
 *   • rarity      ← card.rarity
 *
 * Color mapping is heuristic because Cockatrice expects single-letter
 * MTG-style codes (W/U/B/R/G). When the faction list maps cleanly we
 * forward the inferred color; otherwise we leave it blank and let the
 * Cockatrice client pick a default.
 */

interface CockatriceExportArgs {
  project: Project;
  /** Optionally pre-loaded; we'll fetch if omitted. */
  cards?: Card[];
  sets?: CardSet[];
  factions?: Faction[];
}

export async function downloadCockatriceCarddatabase(args: CockatriceExportArgs): Promise<void> {
  const { project } = args;
  const [cards, sets, factions] = await Promise.all([
    args.cards ? Promise.resolve(args.cards) : api.listCards({ projectId: project.id }),
    args.sets ? Promise.resolve(args.sets) : api.listSets({ projectId: project.id }),
    args.factions
      ? Promise.resolve(args.factions)
      : api.listFactions({ projectId: project.id }).catch(() => []),
  ]);

  const xml = buildCarddatabaseXml({
    projectName: project.name,
    cards,
    sets,
    factions,
  });

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const safeSlug = project.slug.replace(/[^a-z0-9_-]+/gi, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeSlug}.cockatrice.xml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Per-deck `.cod` export. Reads the deck's slot list, resolves card
 * names from the embedded card metadata, and generates a Cockatrice
 * deck file that an author can hand off to a playtester.
 */
export async function downloadCockatriceDeck(args: {
  deck: Deck;
}): Promise<void> {
  const deck = args.deck;
  // Re-fetch by id to make sure the slot list is embedded — the list
  // endpoint omits cards: DeckCard[].
  const full = deck.cards ? deck : await api.getDeck(deck.id);

  const main = (full.cards ?? []).filter((c) => !c.sideboard);
  const side = (full.cards ?? []).filter((c) => c.sideboard);

  const xml = buildDeckCodXml({
    name: full.name,
    description: full.description ?? "",
    main: main.map((s) => ({
      name: s.card?.name ?? "Unknown",
      qty: s.quantity,
    })),
    side: side.map((s) => ({
      name: s.card?.name ?? "Unknown",
      qty: s.quantity,
    })),
  });

  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const safeSlug = full.slug.replace(/[^a-z0-9_-]+/gi, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeSlug}.cod`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ====================================================================== */
/* XML builders                                                            */
/* ====================================================================== */

function buildCarddatabaseXml(args: {
  projectName: string;
  cards: Card[];
  sets: CardSet[];
  factions: Faction[];
}): string {
  const { projectName, cards, sets, factions } = args;
  const setById = new Map<string, CardSet>();
  for (const s of sets) setById.set(s.id, s);
  const factionBySlug = new Map<string, Faction>();
  for (const f of factions) factionBySlug.set(f.slug, f);

  const setsBlock = sets
    .map(
      (s) => `    <set>
      <name>${esc(s.code)}</name>
      <longname>${esc(s.name)}</longname>
      <settype>Custom</settype>
      <releasedate>${esc(s.releaseDate ? s.releaseDate.slice(0, 10) : "")}</releasedate>
    </set>`,
    )
    .join("\n");

  const cardsBlock = cards
    .map((c) => {
      const set = c.setId ? setById.get(c.setId) : null;
      const data = (c.dataJson as Record<string, unknown> | null) ?? {};
      const type = pickString(data, ["type", "subtype", "card_type"]) || "Card";
      const cost = pickNumeric(data, ["cost", "mana", "energy"]);
      const power = pickNumeric(data, ["power", "attack"]);
      const health = pickNumeric(data, ["health", "toughness", "defense"]);
      const text = pickString(data, ["rules_text", "text", "rulesText"]) || "";
      const flavor = pickString(data, ["flavor_text", "flavor"]);
      const color = inferColor(data, factionBySlug);
      const ptStr = power != null && health != null ? `${power}/${health}` : "";

      // Cockatrice <card> children:
      //   <name>     — required, unique across the database
      //   <text>     — rules text (printed on card)
      //   <set>      — set code reference; can include rarity attr
      //   <color>    — single-letter MTG color (or omitted)
      //   <manacost> — display string (we use the cost number stringified)
      //   <cmc>      — converted mana cost (numeric, used for sorting)
      //   <type>     — type line
      //   <pt>       — power/toughness pair, only for creature-style cards
      //   <tablerow> — recommended battlefield row (1=enchantment, 2=creature, 3=instant/sorcery)
      const rarity = c.rarity ? ` rarity="${esc(c.rarity)}"` : "";
      const setRef = set ? `<set${rarity}>${esc(set.code)}</set>` : "";

      return `    <card>
      <name>${esc(c.name)}</name>
      ${setRef}
      ${color ? `<color>${esc(color)}</color>` : ""}
      ${cost != null ? `<manacost>${cost}</manacost>\n      <cmc>${cost}</cmc>` : ""}
      <type>${esc(type)}</type>
      ${ptStr ? `<pt>${esc(ptStr)}</pt>` : ""}
      <tablerow>${ptStr ? 2 : 1}</tablerow>
      <text>${esc(text)}</text>
      ${flavor ? `<flavor>${esc(flavor)}</flavor>` : ""}
    </card>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<cockatrice_carddatabase version="4">
  <info>
    <author>TCGStudio</author>
    <createdAt>${new Date().toISOString()}</createdAt>
    <sourceUrl>https://tcgstudio.example</sourceUrl>
    <sourceVersion>1</sourceVersion>
  </info>
  <sets>
${setsBlock}
  </sets>
  <cards>
${cardsBlock}
  </cards>
</cockatrice_carddatabase>
`;
}

function buildDeckCodXml(args: {
  name: string;
  description: string;
  main: Array<{ name: string; qty: number }>;
  side: Array<{ name: string; qty: number }>;
}): string {
  const mainBlock = args.main
    .map(
      (e) => `    <card number="${e.qty}" price="0" name="${esc(e.name)}"/>`,
    )
    .join("\n");
  const sideBlock = args.side
    .map(
      (e) => `    <card number="${e.qty}" price="0" name="${esc(e.name)}"/>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<cockatrice_deck version="1">
  <deckname>${esc(args.name)}</deckname>
  <comments>${esc(args.description)}</comments>
  <zone name="main">
${mainBlock}
  </zone>
  <zone name="side">
${sideBlock}
  </zone>
</cockatrice_deck>
`;
}

/* ====================================================================== */
/* Helpers                                                                 */
/* ====================================================================== */

/**
 * XML-escape a string. Cockatrice's parser is XML, not HTML, so we
 * only need the canonical five entities. Most card text is already
 * safe; this guard is for the occasional `&` or smart quote.
 */
function esc(s: string): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pickString(data: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

function pickNumeric(data: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = data[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/**
 * Heuristic faction → MTG color letter mapping. Cockatrice cards use
 * single-letter color codes (W/U/B/R/G) for filtering and grouping in
 * its UI; multi-color cards omit the field.
 *
 * Recognized faction slugs / names map to a color when the project
 * uses MTG-style identities. For everything else we pick a color
 * based on the closest visual match of the faction's color (e.g.
 * red-tinted faction → R).
 *
 * Falls back to "" (no <color>) when nothing can be inferred — that's
 * the right default; Cockatrice happily handles colorless customs.
 */
function inferColor(
  data: Record<string, unknown>,
  factionBySlug: Map<string, Faction>,
): string {
  const slug = typeof data.faction === "string" ? data.faction.toLowerCase() : null;
  // Direct slug match against well-known MTG colors.
  const mtgMap: Record<string, string> = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
  };
  if (slug && mtgMap[slug]) return mtgMap[slug];

  // Try inferring from the faction's hex color.
  if (slug) {
    const f = factionBySlug.get(slug);
    if (f?.color) return colorLetterFromHex(f.color);
  }

  // No mono faction — try multi for the first hit.
  if (Array.isArray(data.factions)) {
    for (const fSlug of data.factions as unknown[]) {
      if (typeof fSlug !== "string") continue;
      if (mtgMap[fSlug.toLowerCase()]) return mtgMap[fSlug.toLowerCase()];
      const f = factionBySlug.get(fSlug.toLowerCase());
      if (f?.color) return colorLetterFromHex(f.color);
    }
  }

  return "";
}

/**
 * Map a hex color to the closest MTG color letter. Quick & dirty —
 * just classifies by RGB dominance. Good enough for grouping cards
 * in Cockatrice's filter UI; authors who want precise mapping can
 * post-edit the XML.
 */
function colorLetterFromHex(hex: string): string {
  const m = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return "";
  const raw = m[1];
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // White: high luminance, low saturation.
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  if (max > 220 && sat < 40) return "W";
  if (max < 60) return "B"; // very dark → black
  if (r >= g && r >= b && r - Math.max(g, b) > 30) return "R";
  if (g >= r && g >= b && g - Math.max(r, b) > 30) return "G";
  if (b >= r && b >= g && b - Math.max(r, g) > 30) return "U";
  return "";
}
