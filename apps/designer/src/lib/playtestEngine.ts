/**
 * Generic playtest engine (sec 23).
 *
 * The engine is a pure-functional state machine over a `Session`. It
 * doesn't know anything about Magic, Hearthstone, or any specific game
 * — every game-shaped behavior (how many players, what phases, what
 * actions are available, what counts as winning) lives in the
 * `RulesetConfig`, which is just data.
 *
 * Why pure functions:
 *   • undo/redo becomes free — snapshot the session before each action
 *     and the engine doesn't have to track inverse operations
 *   • testing is trivial: feed in a session + an action, assert the
 *     output. No DOM, no React.
 *   • the same engine can later run server-side for online multiplayer
 *     without porting any UI code.
 *
 * The engine handles:
 *   • turn / phase advancement with auto-actions
 *   • drawing, moving, shuffling cards between zones
 *   • per-player resources (life / mana / hand size limit / etc.)
 *   • per-card mutable state (tapped, face-down, counters)
 *   • win-condition checking
 *   • a structured game log (for replay + UI display)
 *
 * The UI layer in PlaytestView is a thin renderer over Session state,
 * dispatching engine actions through `applyAction(session, action)`.
 */

import type { BoardLayout, Card, Deck, DeckCard } from "@/lib/apiTypes";

/* ---------------------------------------------------------------------- */
/* RulesetConfig — the game definition                                    */
/* ---------------------------------------------------------------------- */

/**
 * Top-level ruleset config. Stored on `Ruleset.configJson` server-side.
 *
 * The shape is intentionally permissive — unknown fields round-trip
 * untouched so authors can stash project-specific data the engine
 * doesn't understand yet.
 */
export interface RulesetConfig {
  /** Player setup — how many seats, what they're called, what they start with. */
  playerSetup: PlayerSetup;
  /** Ordered list of phases in a turn. The engine cycles through these. */
  phases: PhaseDef[];
  /** Win conditions checked after every action. First match ends the game. */
  winConditions: WinCondition[];
  /** Buttons / hotkeys the player can press during their turn. */
  customActions: PlayerActionDef[];
  /** Right-click menu entries on a card. */
  cardActions: CardActionDef[];
  /** When true, the engine auto-runs autoActions when entering a phase. */
  autoAdvancePhases?: boolean;
}

export interface PlayerSetup {
  minPlayers: number;
  maxPlayers: number;
  defaultPlayers: number;
  /**
   * Display labels per seat. If shorter than `defaultPlayers`, the
   * engine extends with "P{n}" automatically.
   */
  seatLabels: string[];
  /**
   * Resources each seat starts with. Map of resource name → starting
   * value. Common keys: "life", "mana", "energy". Authors can add any
   * resource — the playtest UI surfaces them generically as a
   * counter-with-buttons.
   */
  startingResources: Record<string, number>;
  /** Number of cards drawn at game start, per seat. */
  startingHandSize: number;
  /**
   * Turn order convention. "clockwise" = P1, P2, P3, P1, …
   * "active_player_only" = same player keeps acting until manually
   * passing (useful for solo / co-op). "random" = shuffled at game
   * start.
   */
  turnOrder: "clockwise" | "active_player_only" | "random";
}

export interface PhaseDef {
  id: string;
  name: string;
  description?: string;
  /**
   * Scripted actions that run automatically when this phase starts.
   * The engine plays them in order, then waits for user input before
   * advancing (unless `autoAdvancePhases` is set on the ruleset, in
   * which case empty / scripted-only phases tick through immediately).
   */
  autoActions: ScriptedAction[];
  /**
   * Whether this phase is "for the active player only". When false,
   * all players can act during this phase (priority broadcast).
   */
  activePlayerOnly: boolean;
  /**
   * Marks a phase that ends the active player's turn — the engine
   * advances to the next player when this phase completes.
   */
  endsTurn?: boolean;
}

/**
 * A scripted action — declarative description of "what should happen
 * to the game state". The engine's `applyScripted()` is the canonical
 * interpreter; new kinds get added here as authors need them.
 *
 * The shape is parameterized: `kind` discriminates, `params` carries
 * kind-specific args. Targets are resolved relative to the active
 * player unless overridden.
 */
export interface ScriptedAction {
  kind: ScriptedKind;
  /**
   * Who this action affects. Most actions default to the active
   * player; phase-start auto-actions usually want "active_player".
   */
  target?: "active_player" | "all_players" | "each_opponent" | "specific_seat";
  /** When `target === "specific_seat"`, which seat index. */
  seatIndex?: number;
  params?: Record<string, unknown>;
}

export type ScriptedKind =
  /** Draw N cards from a zone of kind X into hand. */
  | "draw_cards"
  /** Shuffle a zone of kind X. */
  | "shuffle_zone"
  /** Set / adjust a player resource. */
  | "set_resource"
  | "increment_resource"
  /** Untap / set tap state on every card in a zone owned by target. */
  | "untap_zone"
  | "tap_zone"
  /** Move all cards from one zone kind to another. */
  | "move_zone_contents"
  /** Reveal the top N cards of a zone (publicizes them temporarily). */
  | "reveal_top"
  /** Add a counter to all cards in a zone. */
  | "increment_card_counter"
  /** Custom — opaque to the engine; logged but no state change. */
  | "custom";

export interface WinCondition {
  /** Display label, e.g. "Reduce opponent to 0 life". */
  label: string;
  kind:
    /** Triggers when a resource hits a threshold (default: <= 0). */
    | "resource_threshold"
    /** Triggers when a zone of kind X is empty for a player. */
    | "zone_empty"
    /** Triggers when a zone of kind X has reached a card count. */
    | "zone_count"
    /** Always loses on phase id (e.g. "decked out at draw step"). */
    | "phase_loss"
    /** Custom — checked manually via "Resolve" buttons in UI. */
    | "custom";
  resource?: string;
  threshold?: number;
  comparator?: "<=" | ">=" | "==";
  zoneKind?: string;
  phaseId?: string;
  /**
   * "loss" = the affected player loses; "win" = the affected player
   * wins. Most win-conditions are "loss" (running out of life, decking
   * out). Use "win" for victory-by-objective rules.
   */
  outcome: "win" | "loss";
}

export interface PlayerActionDef {
  id: string;
  label: string;
  hotkey?: string;
  /** When true, this action is only legal during the active player's turn. */
  activeOnly?: boolean;
  effect: ScriptedAction;
}

export interface CardActionDef {
  id: string;
  label: string;
  /** When true, only show this action for the card's owner. */
  ownerOnly?: boolean;
  /** What this does to the card itself. */
  cardEffect:
    | { kind: "toggle_tapped" }
    | { kind: "toggle_facedown" }
    | { kind: "increment_counter"; counter: string; delta: number }
    | { kind: "set_counter"; counter: string; value: number }
    | { kind: "move_to_zone_kind"; zoneKind: string }
    | { kind: "destroy" };
}

/* ---------------------------------------------------------------------- */
/* Session — runtime state                                                */
/* ---------------------------------------------------------------------- */

export interface PlayerState {
  seatIndex: number;
  label: string;
  /** Map of resource name → current value. */
  resources: Record<string, number>;
  /** Free-form per-player flags / counters not covered by resources. */
  flags: Record<string, unknown>;
  /** True when this player has lost. The game is over when ≤ 1 active. */
  eliminated: boolean;
  /** True when this player has won (rare — most outcomes are "everyone else lost"). */
  won: boolean;
}

export interface PlayCard {
  id: string;
  cardId: string;
  /** Seat index (0-based) of the card's owner. */
  ownerSeat: number;
  /** Zone id within the board. */
  zoneId: string;
  /** Position within the zone, 0-indexed. */
  index: number;
  tapped: boolean;
  faceDown: boolean;
  /** Per-card counter map — "+1/+1", "loyalty", "charge" etc. */
  counters: Record<string, number>;
}

export interface LogEntry {
  /** Wall-clock millis at log time — used for ordering + display. */
  ts: number;
  /** Seat index of the actor, or null for engine events. */
  seat: number | null;
  message: string;
  /** Kind tag for filtering / styling. */
  kind: "system" | "phase" | "action" | "card" | "resource" | "win";
}

export interface Session {
  ruleset: RulesetConfig;
  board: BoardLayout;
  /** Source-of-truth metadata for cards referenced by id. */
  cardById: Map<string, Card>;
  players: PlayerState[];
  cards: PlayCard[];
  /** Active player seat index. */
  activeSeat: number;
  /** Index into `ruleset.phases` for the active phase. */
  phaseIndex: number;
  turn: number;
  log: LogEntry[];
  /** Monotonic id source for newly spawned PlayCards. */
  nextId: number;
  /** Final outcome — null while the game is in progress. */
  outcome: { winners: number[]; reason: string } | null;
}

/* ---------------------------------------------------------------------- */
/* Engine actions — the input alphabet                                    */
/* ---------------------------------------------------------------------- */

/**
 * Every state mutation the UI can trigger, expressed as a discriminated
 * union. `applyAction(session, action)` is the only function that
 * mutates Session — keeping the surface small means undo/redo just
 * snapshots the whole Session before each call.
 */
export type EngineAction =
  | { kind: "next_phase" }
  | { kind: "end_turn" }
  | { kind: "draw_card"; seat: number; fromZoneId?: string }
  | { kind: "move_card"; cardId: string; toZoneId: string; toEnd?: boolean }
  | { kind: "shuffle_zone"; zoneId: string }
  | { kind: "toggle_tapped"; cardId: string }
  | { kind: "toggle_facedown"; cardId: string }
  | { kind: "adjust_counter"; cardId: string; counter: string; delta: number }
  | {
      kind: "adjust_resource";
      seat: number;
      resource: string;
      delta: number;
    }
  | { kind: "set_resource"; seat: number; resource: string; value: number }
  | { kind: "run_player_action"; actionId: string; seat: number }
  | { kind: "run_card_action"; actionId: string; cardId: string }
  | { kind: "concede"; seat: number }
  | { kind: "log_note"; message: string };

/* ---------------------------------------------------------------------- */
/* Construction                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Build a new Session from a ruleset, board, and decks (one per seat).
 *
 * `decks.length` controls the player count — the caller has already
 * validated against `ruleset.playerSetup.{min,max}Players`. Extra
 * seats beyond decks get empty-deck players (useful for "1 vs the
 * dungeon" scenarios where the dungeon has a fixed deck).
 */
export function newSession(args: {
  ruleset: RulesetConfig;
  board: BoardLayout;
  decks: Array<Deck | null>;
}): Session {
  const { ruleset, board, decks } = args;
  const players: PlayerState[] = [];
  const cards: PlayCard[] = [];
  const cardById = new Map<string, Card>();
  let nextId = 1;

  // Seat labels — extend with "P{n}" if the ruleset doesn't supply
  // enough labels for the actual seat count.
  const seatLabels = decks.map((_, i) => ruleset.playerSetup.seatLabels[i] ?? `P${i + 1}`);

  for (let seat = 0; seat < decks.length; seat++) {
    players.push({
      seatIndex: seat,
      label: seatLabels[seat],
      resources: { ...ruleset.playerSetup.startingResources },
      flags: {},
      eliminated: false,
      won: false,
    });

    const deck = decks[seat];
    if (!deck) continue;

    // Find the deck zone owned by this seat. Boards conventionally use
    // "p1" / "p2" / … owners; we also accept seat indices as fallback.
    const seatLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
    const deckZone = board.zonesJson.find(
      (z) => z.kind === "deck" && (z.owner === seatLabel || z.owner === String(seat)),
    );
    if (!deckZone) continue;

    const slots = (deck.cards ?? []).filter((c) => !c.sideboard);
    const expanded: PlayCard[] = [];
    for (const s of slots) {
      const card = (s as DeckCard).card;
      if (card) cardById.set(card.id, card as Card);
      for (let q = 0; q < s.quantity; q++) {
        expanded.push({
          id: `pc-${nextId++}`,
          cardId: s.cardId,
          ownerSeat: seat,
          zoneId: deckZone.id,
          index: 0,
          tapped: false,
          faceDown: false,
          counters: {},
        });
      }
    }
    shuffle(expanded);
    expanded.forEach((c, i) => (c.index = i));
    cards.push(...expanded);
  }

  // Decide who acts first based on turnOrder.
  const firstSeat =
    ruleset.playerSetup.turnOrder === "random"
      ? Math.floor(Math.random() * Math.max(1, players.length))
      : 0;

  const session: Session = {
    ruleset,
    board,
    cardById,
    players,
    cards,
    activeSeat: firstSeat,
    phaseIndex: 0,
    turn: 1,
    nextId,
    log: [
      {
        ts: Date.now(),
        seat: null,
        message: `Session started — ${players.length} player${players.length === 1 ? "" : "s"}, ${cards.length} cards loaded.`,
        kind: "system",
      },
    ],
    outcome: null,
  };

  // Run the starting-hand draw inline. This is just a draw_cards
  // scripted action against each player — but doing it here keeps the
  // newly-created session ready to play without an extra round-trip.
  for (let seat = 0; seat < players.length; seat++) {
    if (decks[seat]) {
      drawForSeat(session, seat, ruleset.playerSetup.startingHandSize);
    }
  }
  log(session, null, `Each player drew ${ruleset.playerSetup.startingHandSize} cards.`, "system");

  // Execute the first phase's auto-actions so the player lands in a
  // ready-to-act state (e.g. their resources are set, their tapped
  // permanents are untapped) — same as starting any other turn.
  enterPhase(session, 0);

  return session;
}

/* ---------------------------------------------------------------------- */
/* Public entry point — apply an action                                   */
/* ---------------------------------------------------------------------- */

/**
 * Apply an action to the session. Returns a NEW session (immutable —
 * we deep-clone via JSON for the snapshot/diff path so undo gets a
 * stable reference). The Map of cardById is preserved by reference
 * since its values are server-side metadata that don't mutate.
 */
export function applyAction(input: Session, action: EngineAction): Session {
  // Game-over: only allow log_note actions so the user can take notes.
  if (input.outcome && action.kind !== "log_note") return input;

  // Snapshot via structured-cloned plain fields. We carry cardById by
  // reference because Maps don't survive JSON round-trips and the
  // values are immutable for the duration of the session.
  const session: Session = cloneSession(input);

  switch (action.kind) {
    case "next_phase":
      advancePhase(session);
      break;
    case "end_turn":
      endTurn(session);
      break;
    case "draw_card":
      drawForSeat(session, action.seat, 1, action.fromZoneId);
      break;
    case "move_card":
      moveCard(session, action.cardId, action.toZoneId, action.toEnd ?? true);
      break;
    case "shuffle_zone":
      shuffleZoneCards(session, action.zoneId);
      break;
    case "toggle_tapped":
      toggleTapped(session, action.cardId);
      break;
    case "toggle_facedown":
      toggleFaceDown(session, action.cardId);
      break;
    case "adjust_counter":
      adjustCounter(session, action.cardId, action.counter, action.delta);
      break;
    case "adjust_resource":
      adjustResource(session, action.seat, action.resource, action.delta);
      break;
    case "set_resource":
      setResource(session, action.seat, action.resource, action.value);
      break;
    case "run_player_action":
      runPlayerAction(session, action.actionId, action.seat);
      break;
    case "run_card_action":
      runCardAction(session, action.actionId, action.cardId);
      break;
    case "concede":
      concede(session, action.seat);
      break;
    case "log_note":
      log(session, null, action.message, "action");
      break;
  }

  // After every state mutation, check win conditions. The engine
  // marks players eliminated; if exactly one remains, set outcome.
  evaluateWinConditions(session);
  return session;
}

/* ---------------------------------------------------------------------- */
/* Phase / turn machinery                                                 */
/* ---------------------------------------------------------------------- */

function enterPhase(session: Session, phaseIndex: number) {
  session.phaseIndex = phaseIndex;
  const phase = session.ruleset.phases[phaseIndex];
  if (!phase) return;
  log(session, session.activeSeat, `Phase: ${phase.name}`, "phase");
  for (const a of phase.autoActions ?? []) {
    applyScripted(session, a);
  }
}

function advancePhase(session: Session) {
  const phases = session.ruleset.phases;
  if (phases.length === 0) return;
  const cur = phases[session.phaseIndex];
  if (cur?.endsTurn) {
    endTurn(session);
    return;
  }
  const next = (session.phaseIndex + 1) % phases.length;
  if (next === 0) {
    // Wrapping back to phase 0 ends the active player's turn.
    endTurn(session);
    return;
  }
  enterPhase(session, next);
}

function endTurn(session: Session) {
  log(session, session.activeSeat, `End of turn ${session.turn}.`, "phase");
  const order = session.ruleset.playerSetup.turnOrder;
  const alive = session.players.filter((p) => !p.eliminated);
  if (alive.length === 0) return;

  if (order === "active_player_only") {
    // Same seat keeps acting; just bump turn counter and re-enter
    // phase 0. Useful for solo / co-op modes.
    session.turn++;
    enterPhase(session, 0);
    return;
  }

  // Find the next non-eliminated seat after the current one.
  const playerCount = session.players.length;
  let next = session.activeSeat;
  for (let i = 0; i < playerCount; i++) {
    next = (next + 1) % playerCount;
    if (!session.players[next].eliminated) break;
  }
  session.activeSeat = next;
  // Increment turn whenever we wrap around — i.e. "round trip"
  // through every player counts as one turn cycle.
  if (next === 0) session.turn++;
  enterPhase(session, 0);
}

/* ---------------------------------------------------------------------- */
/* Card movement                                                          */
/* ---------------------------------------------------------------------- */

function moveCard(
  session: Session,
  cardId: string,
  toZoneId: string,
  toEnd: boolean,
) {
  const card = session.cards.find((c) => c.id === cardId);
  if (!card) return;
  const fromZoneId = card.zoneId;
  const toZone = session.board.zonesJson.find((z) => z.id === toZoneId);
  const fromZone = session.board.zonesJson.find((z) => z.id === fromZoneId);
  card.zoneId = toZoneId;
  card.index = toEnd ? session.cards.filter((c) => c.zoneId === toZoneId).length : 0;
  // Going to a hand zone untaps the card by convention.
  if (toZone?.kind === "hand") card.tapped = false;
  // Compact source zone indexes.
  const sourceCards = session.cards
    .filter((c) => c.zoneId === fromZoneId)
    .sort((a, b) => a.index - b.index);
  sourceCards.forEach((c, i) => (c.index = i));
  log(
    session,
    card.ownerSeat,
    `${cardName(session, card)} moved ${fromZone?.name ?? "?"} → ${toZone?.name ?? "?"}.`,
    "card",
  );
}

function drawForSeat(
  session: Session,
  seat: number,
  count: number,
  fromZoneId?: string,
) {
  const player = session.players[seat];
  if (!player || player.eliminated) return;
  // Find the seat's deck + hand zones.
  const seatLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
  const deckZone =
    (fromZoneId
      ? session.board.zonesJson.find((z) => z.id === fromZoneId)
      : session.board.zonesJson.find(
          (z) => z.kind === "deck" && z.owner === seatLabel,
        )) ?? null;
  const handZone = session.board.zonesJson.find(
    (z) => z.kind === "hand" && z.owner === seatLabel,
  );
  if (!deckZone || !handZone) {
    log(session, seat, `${player.label} can't draw — no deck/hand zone.`, "system");
    return;
  }
  for (let i = 0; i < count; i++) {
    const inZone = session.cards
      .filter((c) => c.zoneId === deckZone.id)
      .sort((a, b) => b.index - a.index);
    const top = inZone[0];
    if (!top) {
      log(session, seat, `${player.label}: ${deckZone.name} is empty.`, "system");
      // Some games end on deck-out — handled by phase_loss / zone_empty
      // win conditions.
      break;
    }
    moveCard(session, top.id, handZone.id, true);
  }
}

function shuffleZoneCards(session: Session, zoneId: string) {
  const inZone = session.cards.filter((c) => c.zoneId === zoneId);
  const reordered = shuffle([...inZone]);
  reordered.forEach((c, i) => {
    const src = session.cards.find((n) => n.id === c.id);
    if (src) src.index = i;
  });
  const zone = session.board.zonesJson.find((z) => z.id === zoneId);
  log(session, null, `Shuffled ${zone?.name ?? zoneId} (${inZone.length} cards).`, "action");
}

/* ---------------------------------------------------------------------- */
/* Card mutation                                                          */
/* ---------------------------------------------------------------------- */

function toggleTapped(session: Session, cardId: string) {
  const card = session.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.tapped = !card.tapped;
  log(
    session,
    card.ownerSeat,
    `${cardName(session, card)} ${card.tapped ? "tapped" : "untapped"}.`,
    "card",
  );
}

function toggleFaceDown(session: Session, cardId: string) {
  const card = session.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.faceDown = !card.faceDown;
  log(
    session,
    card.ownerSeat,
    `${cardName(session, card)} flipped ${card.faceDown ? "face-down" : "face-up"}.`,
    "card",
  );
}

function adjustCounter(
  session: Session,
  cardId: string,
  counter: string,
  delta: number,
) {
  const card = session.cards.find((c) => c.id === cardId);
  if (!card) return;
  const next = (card.counters[counter] ?? 0) + delta;
  if (next === 0) delete card.counters[counter];
  else card.counters[counter] = next;
  log(
    session,
    card.ownerSeat,
    `${cardName(session, card)} ${counter}: ${delta > 0 ? "+" : ""}${delta} → ${next}`,
    "card",
  );
}

/* ---------------------------------------------------------------------- */
/* Resources                                                              */
/* ---------------------------------------------------------------------- */

function adjustResource(
  session: Session,
  seat: number,
  resource: string,
  delta: number,
) {
  const player = session.players[seat];
  if (!player) return;
  const next = (player.resources[resource] ?? 0) + delta;
  player.resources[resource] = next;
  log(
    session,
    seat,
    `${player.label} ${resource}: ${delta > 0 ? "+" : ""}${delta} → ${next}`,
    "resource",
  );
}

function setResource(
  session: Session,
  seat: number,
  resource: string,
  value: number,
) {
  const player = session.players[seat];
  if (!player) return;
  player.resources[resource] = value;
  log(session, seat, `${player.label} ${resource} → ${value}`, "resource");
}

/* ---------------------------------------------------------------------- */
/* Custom actions                                                         */
/* ---------------------------------------------------------------------- */

function runPlayerAction(session: Session, actionId: string, seat: number) {
  const def = session.ruleset.customActions.find((a) => a.id === actionId);
  if (!def) return;
  log(session, seat, `${session.players[seat]?.label ?? "?"} → ${def.label}`, "action");
  applyScripted(session, { ...def.effect, target: def.effect.target ?? "active_player" });
}

function runCardAction(session: Session, actionId: string, cardId: string) {
  const def = session.ruleset.cardActions.find((a) => a.id === actionId);
  const card = session.cards.find((c) => c.id === cardId);
  if (!def || !card) return;
  log(session, card.ownerSeat, `${cardName(session, card)} → ${def.label}`, "card");
  switch (def.cardEffect.kind) {
    case "toggle_tapped":
      card.tapped = !card.tapped;
      break;
    case "toggle_facedown":
      card.faceDown = !card.faceDown;
      break;
    case "increment_counter": {
      const c = def.cardEffect.counter;
      card.counters[c] = (card.counters[c] ?? 0) + def.cardEffect.delta;
      if (card.counters[c] === 0) delete card.counters[c];
      break;
    }
    case "set_counter":
      card.counters[def.cardEffect.counter] = def.cardEffect.value;
      break;
    case "move_to_zone_kind": {
      // Find a zone matching the requested kind, owned by the card's
      // owner (or a shared zone). The double-` === ` chain in the prior
      // version was a copy-paste bug — what we actually want is a plain
      // type-narrowed match against `def.cardEffect.zoneKind`.
      const wantedKind = def.cardEffect.zoneKind;
      const ownerLabel =
        card.ownerSeat === 0
          ? "p1"
          : card.ownerSeat === 1
          ? "p2"
          : `p${card.ownerSeat + 1}`;
      const target = session.board.zonesJson.find(
        (z) => z.kind === wantedKind && (z.owner === ownerLabel || z.owner === "shared"),
      );
      if (target) moveCard(session, card.id, target.id, true);
      break;
    }
    case "destroy":
      session.cards = session.cards.filter((c) => c.id !== card.id);
      break;
  }
}

function concede(session: Session, seat: number) {
  const player = session.players[seat];
  if (!player) return;
  player.eliminated = true;
  log(session, seat, `${player.label} concedes.`, "win");
}

/* ---------------------------------------------------------------------- */
/* Scripted action interpreter                                            */
/* ---------------------------------------------------------------------- */

function applyScripted(session: Session, action: ScriptedAction) {
  const targets = resolveTargets(session, action);
  for (const seat of targets) {
    switch (action.kind) {
      case "draw_cards": {
        const n = (action.params?.count as number) ?? 1;
        drawForSeat(session, seat, n);
        break;
      }
      case "shuffle_zone": {
        const zoneKind = action.params?.zoneKind as string | undefined;
        if (!zoneKind) break;
        const ownerLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
        const zone = session.board.zonesJson.find(
          (z) => z.kind === zoneKind && z.owner === ownerLabel,
        );
        if (zone) shuffleZoneCards(session, zone.id);
        break;
      }
      case "set_resource": {
        const r = action.params?.resource as string;
        const v = (action.params?.value as number) ?? 0;
        if (r) setResource(session, seat, r, v);
        break;
      }
      case "increment_resource": {
        const r = action.params?.resource as string;
        const d = (action.params?.delta as number) ?? 1;
        if (r) adjustResource(session, seat, r, d);
        break;
      }
      case "untap_zone":
      case "tap_zone": {
        const zoneKind = action.params?.zoneKind as string | undefined;
        if (!zoneKind) break;
        const ownerLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
        const targetZones = session.board.zonesJson.filter(
          (z) => z.kind === zoneKind && (z.owner === ownerLabel || z.owner === "shared"),
        );
        const targetState = action.kind === "tap_zone";
        for (const z of targetZones) {
          for (const c of session.cards) {
            if (c.zoneId === z.id) c.tapped = targetState;
          }
        }
        log(
          session,
          seat,
          `${action.kind === "tap_zone" ? "Tap" : "Untap"} all in ${zoneKind}.`,
          "phase",
        );
        break;
      }
      case "move_zone_contents": {
        const fromKind = action.params?.fromKind as string;
        const toKind = action.params?.toKind as string;
        if (!fromKind || !toKind) break;
        const ownerLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
        const from = session.board.zonesJson.find(
          (z) => z.kind === fromKind && z.owner === ownerLabel,
        );
        const to = session.board.zonesJson.find(
          (z) => z.kind === toKind && z.owner === ownerLabel,
        );
        if (!from || !to) break;
        const movers = [...session.cards.filter((c) => c.zoneId === from.id)];
        for (const c of movers) moveCard(session, c.id, to.id, true);
        break;
      }
      case "reveal_top": {
        // For MVP we just log — public visibility flip is a future feature.
        const n = (action.params?.count as number) ?? 1;
        log(session, seat, `Reveals top ${n}.`, "card");
        break;
      }
      case "increment_card_counter": {
        const counter = action.params?.counter as string;
        const delta = (action.params?.delta as number) ?? 1;
        const zoneKind = action.params?.zoneKind as string | undefined;
        if (!counter) break;
        const ownerLabel = seat === 0 ? "p1" : seat === 1 ? "p2" : `p${seat + 1}`;
        const zoneIds = zoneKind
          ? session.board.zonesJson
              .filter((z) => z.kind === zoneKind && z.owner === ownerLabel)
              .map((z) => z.id)
          : null;
        for (const c of session.cards) {
          if (c.ownerSeat !== seat) continue;
          if (zoneIds && !zoneIds.includes(c.zoneId)) continue;
          c.counters[counter] = (c.counters[counter] ?? 0) + delta;
          if (c.counters[counter] === 0) delete c.counters[counter];
        }
        break;
      }
      case "custom":
        log(session, seat, `Custom: ${(action.params?.note as string) ?? "(no note)"}`, "action");
        break;
    }
  }
}

function resolveTargets(session: Session, action: ScriptedAction): number[] {
  const target = action.target ?? "active_player";
  switch (target) {
    case "active_player":
      return [session.activeSeat];
    case "all_players":
      return session.players.map((p) => p.seatIndex).filter((s) => !session.players[s].eliminated);
    case "each_opponent":
      return session.players
        .map((p) => p.seatIndex)
        .filter((s) => s !== session.activeSeat && !session.players[s].eliminated);
    case "specific_seat":
      return action.seatIndex != null ? [action.seatIndex] : [];
  }
}

/* ---------------------------------------------------------------------- */
/* Win conditions                                                         */
/* ---------------------------------------------------------------------- */

function evaluateWinConditions(session: Session) {
  if (session.outcome) return;
  for (const p of session.players) {
    if (p.eliminated) continue;
    for (const wc of session.ruleset.winConditions) {
      const triggered = checkWinCondition(session, p, wc);
      if (!triggered) continue;
      if (wc.outcome === "loss") {
        p.eliminated = true;
        log(session, p.seatIndex, `${p.label} eliminated — ${wc.label}.`, "win");
      } else {
        p.won = true;
        log(session, p.seatIndex, `${p.label} wins — ${wc.label}!`, "win");
      }
    }
  }
  // Resolve overall game state: explicit winner > last player standing.
  const winner = session.players.find((p) => p.won);
  if (winner) {
    session.outcome = {
      winners: [winner.seatIndex],
      reason: "Win condition met.",
    };
    return;
  }
  const alive = session.players.filter((p) => !p.eliminated);
  if (alive.length <= 1 && session.players.length > 1) {
    session.outcome = {
      winners: alive.map((p) => p.seatIndex),
      reason: alive.length === 1 ? `${alive[0].label} is the last player standing.` : "Draw.",
    };
  }
}

function checkWinCondition(session: Session, player: PlayerState, wc: WinCondition): boolean {
  switch (wc.kind) {
    case "resource_threshold": {
      if (!wc.resource) return false;
      const v = player.resources[wc.resource] ?? 0;
      const t = wc.threshold ?? 0;
      const cmp = wc.comparator ?? "<=";
      if (cmp === "<=") return v <= t;
      if (cmp === ">=") return v >= t;
      return v === t;
    }
    case "zone_empty": {
      if (!wc.zoneKind) return false;
      const seatLabel =
        player.seatIndex === 0 ? "p1" : player.seatIndex === 1 ? "p2" : `p${player.seatIndex + 1}`;
      const zone = session.board.zonesJson.find(
        (z) => z.kind === wc.zoneKind && z.owner === seatLabel,
      );
      if (!zone) return false;
      const inZone = session.cards.some((c) => c.zoneId === zone.id);
      return !inZone;
    }
    case "zone_count": {
      if (!wc.zoneKind || wc.threshold == null) return false;
      const seatLabel =
        player.seatIndex === 0 ? "p1" : player.seatIndex === 1 ? "p2" : `p${player.seatIndex + 1}`;
      const zone = session.board.zonesJson.find(
        (z) => z.kind === wc.zoneKind && z.owner === seatLabel,
      );
      if (!zone) return false;
      const count = session.cards.filter((c) => c.zoneId === zone.id).length;
      const cmp = wc.comparator ?? ">=";
      if (cmp === ">=") return count >= wc.threshold;
      if (cmp === "<=") return count <= wc.threshold;
      return count === wc.threshold;
    }
    case "phase_loss":
      // Triggered by the engine when entering a specific phase — but we
      // check it here too for safety. The phase listener path is in
      // `enterPhase` if ever needed.
      return wc.phaseId === session.ruleset.phases[session.phaseIndex]?.id;
    case "custom":
      return false; // Manual resolve only.
  }
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

function log(
  session: Session,
  seat: number | null,
  message: string,
  kind: LogEntry["kind"],
) {
  session.log.push({ ts: Date.now(), seat, message, kind });
  // Cap log so we don't grow unbounded across long sessions.
  if (session.log.length > 500) session.log.splice(0, session.log.length - 500);
}

function cardName(session: Session, card: PlayCard): string {
  return session.cardById.get(card.cardId)?.name ?? `card ${card.cardId.slice(0, 6)}`;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Snapshot the session for the engine's pure-function contract. We
 * deep-clone primitive fields via JSON; the cardById Map is preserved
 * by reference (its values are server-side cards which don't mutate).
 */
function cloneSession(s: Session): Session {
  return {
    ruleset: s.ruleset, // immutable for the duration of the session
    board: s.board, // immutable
    cardById: s.cardById, // shared reference — values don't mutate
    players: s.players.map((p) => ({
      ...p,
      resources: { ...p.resources },
      flags: { ...p.flags },
    })),
    cards: s.cards.map((c) => ({ ...c, counters: { ...c.counters } })),
    activeSeat: s.activeSeat,
    phaseIndex: s.phaseIndex,
    turn: s.turn,
    log: s.log.slice(),
    nextId: s.nextId,
    outcome: s.outcome ? { ...s.outcome, winners: [...s.outcome.winners] } : null,
  };
}

/* ---------------------------------------------------------------------- */
/* Built-in ruleset presets                                               */
/* ---------------------------------------------------------------------- */

/**
 * A handful of sensible defaults so a new project can start playtesting
 * without writing a ruleset from scratch. The Rulesets view exposes
 * these as "Clone preset" buttons.
 */
export const RULESET_PRESETS: Record<string, { name: string; description: string; config: RulesetConfig }> = {
  "duel-1v1": {
    name: "Duel (1v1)",
    description:
      "Two players, 20 starting life, 7 starting hand. Untap → Draw → Main → End. Lose at 0 life.",
    config: {
      playerSetup: {
        minPlayers: 2,
        maxPlayers: 2,
        defaultPlayers: 2,
        seatLabels: ["P1", "P2"],
        startingResources: { life: 20 },
        startingHandSize: 7,
        turnOrder: "clockwise",
      },
      phases: [
        {
          id: "untap",
          name: "Untap",
          description: "All your tapped permanents untap.",
          activePlayerOnly: true,
          autoActions: [
            { kind: "untap_zone", target: "active_player", params: { zoneKind: "battlefield" } },
          ],
        },
        {
          id: "draw",
          name: "Draw",
          description: "Active player draws a card.",
          activePlayerOnly: true,
          autoActions: [{ kind: "draw_cards", target: "active_player", params: { count: 1 } }],
        },
        {
          id: "main",
          name: "Main",
          description: "Play cards and activate abilities.",
          activePlayerOnly: false,
          autoActions: [],
        },
        {
          id: "end",
          name: "End",
          description: "End-of-turn triggers resolve. Hand size enforced.",
          activePlayerOnly: true,
          autoActions: [],
          endsTurn: true,
        },
      ],
      winConditions: [
        {
          label: "Reduced to 0 life",
          kind: "resource_threshold",
          resource: "life",
          threshold: 0,
          comparator: "<=",
          outcome: "loss",
        },
        {
          label: "Decked out",
          kind: "zone_empty",
          zoneKind: "deck",
          outcome: "loss",
        },
      ],
      customActions: [
        {
          id: "mulligan",
          label: "Mulligan",
          activeOnly: false,
          effect: { kind: "shuffle_zone", target: "active_player", params: { zoneKind: "deck" } },
        },
      ],
      cardActions: [
        { id: "tap", label: "Tap / Untap", cardEffect: { kind: "toggle_tapped" } },
        { id: "flip", label: "Flip face down", cardEffect: { kind: "toggle_facedown" } },
        {
          id: "discard",
          label: "Move to discard",
          cardEffect: { kind: "move_to_zone_kind", zoneKind: "discard" },
        },
        {
          id: "exile",
          label: "Move to exile",
          cardEffect: { kind: "move_to_zone_kind", zoneKind: "exile" },
        },
        {
          id: "destroy",
          label: "Destroy",
          cardEffect: { kind: "destroy" },
        },
      ],
      autoAdvancePhases: false,
    },
  },

  "multiplayer-ffa": {
    name: "Multiplayer Free-For-All",
    description:
      "Up to 4 players in a clockwise turn order. 30 starting life. Last player standing wins.",
    config: {
      playerSetup: {
        minPlayers: 2,
        maxPlayers: 4,
        defaultPlayers: 4,
        seatLabels: ["P1", "P2", "P3", "P4"],
        startingResources: { life: 30 },
        startingHandSize: 7,
        turnOrder: "clockwise",
      },
      phases: [
        {
          id: "untap",
          name: "Untap",
          activePlayerOnly: true,
          autoActions: [
            { kind: "untap_zone", target: "active_player", params: { zoneKind: "battlefield" } },
          ],
        },
        {
          id: "draw",
          name: "Draw",
          activePlayerOnly: true,
          autoActions: [{ kind: "draw_cards", target: "active_player", params: { count: 1 } }],
        },
        {
          id: "main",
          name: "Main",
          activePlayerOnly: false,
          autoActions: [],
        },
        {
          id: "end",
          name: "End",
          activePlayerOnly: true,
          autoActions: [],
          endsTurn: true,
        },
      ],
      winConditions: [
        {
          label: "Reduced to 0 life",
          kind: "resource_threshold",
          resource: "life",
          threshold: 0,
          comparator: "<=",
          outcome: "loss",
        },
      ],
      customActions: [],
      cardActions: [
        { id: "tap", label: "Tap / Untap", cardEffect: { kind: "toggle_tapped" } },
        {
          id: "discard",
          label: "Move to discard",
          cardEffect: { kind: "move_to_zone_kind", zoneKind: "discard" },
        },
      ],
    },
  },

  "solo-dungeon": {
    name: "Solo Dungeon",
    description:
      "Single player vs a fixed encounter deck. 25 life. Draw 1 each turn. Win by emptying the dungeon.",
    config: {
      playerSetup: {
        minPlayers: 1,
        maxPlayers: 1,
        defaultPlayers: 1,
        seatLabels: ["You"],
        startingResources: { life: 25, energy: 3 },
        startingHandSize: 5,
        turnOrder: "active_player_only",
      },
      phases: [
        {
          id: "draw",
          name: "Draw",
          activePlayerOnly: true,
          autoActions: [
            { kind: "draw_cards", target: "active_player", params: { count: 1 } },
            { kind: "set_resource", target: "active_player", params: { resource: "energy", value: 3 } },
          ],
        },
        {
          id: "main",
          name: "Main",
          activePlayerOnly: false,
          autoActions: [],
        },
        {
          id: "end",
          name: "End",
          activePlayerOnly: true,
          autoActions: [],
          endsTurn: true,
        },
      ],
      winConditions: [
        {
          label: "Reduced to 0 life",
          kind: "resource_threshold",
          resource: "life",
          threshold: 0,
          comparator: "<=",
          outcome: "loss",
        },
      ],
      customActions: [],
      cardActions: [
        { id: "tap", label: "Tap / Untap", cardEffect: { kind: "toggle_tapped" } },
        {
          id: "discard",
          label: "Discard",
          cardEffect: { kind: "move_to_zone_kind", zoneKind: "discard" },
        },
      ],
    },
  },
};

export const DEFAULT_RULESET_CONFIG: RulesetConfig = RULESET_PRESETS["duel-1v1"].config;
