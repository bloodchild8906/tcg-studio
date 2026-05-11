import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { BoardLayout, Deck, Ruleset } from "@/lib/apiTypes";
import {
  applyAction,
  newSession,
  type EngineAction,
  type RulesetConfig,
  type Session,
  type PlayCard,
  DEFAULT_RULESET_CONFIG,
} from "@/lib/playtestEngine";
import { realtime as rt, channels as rtChannels } from "@/lib/realtime";

/**
 * Multiplayer relay state — set when the user has either created a
 * session or joined one by code. Cleared on leave / host-close.
 */
interface MultiplayerState {
  sessionId: string;
  code: string;
  /** True if we created the session ourselves; only the host can
   *  close it. */
  isOwner: boolean;
}

/** Presence row for each connected peer. Pulled off the
 *  `playtest.presence` events fanned out by the backend. */
interface PresenceRow {
  userId: string;
  displayName: string;
  seat?: number | null;
  ts?: number;
}

/**
 * Manual playtest view (sec 30.1) — generic engine.
 *
 * The view is a thin renderer over `Session` state from the playtest
 * engine. The engine is game-agnostic: it consumes a `RulesetConfig`
 * (phases, win conditions, custom actions) so the same view drives
 * Magic-style 1v1, multiplayer FFA, solo dungeon, or any custom rules
 * the project author has defined.
 *
 * Lobby (`session === null`):
 *   • Pick a ruleset (loaded from the project)
 *   • Pick a board
 *   • Configure player count (clamped to ruleset.playerSetup min/max)
 *   • Pick a deck per seat
 *   • Start
 *
 * Session (`session !== null`):
 *   • Board canvas with cards laid out per-zone
 *   • Per-seat resource panel (life / mana / whatever the ruleset declares)
 *   • Phase indicator + "Next phase" / "End turn" buttons
 *   • Custom action buttons (from the ruleset)
 *   • Card right-click → ruleset's card actions
 *   • Drag cards between zones
 *   • Game log (engine-emitted entries)
 *   • Undo (snapshot stack)
 */
export function PlaytestView() {
  const project = useDesigner(selectActiveProject);
  const currentUser = useDesigner((s) => s.currentUser);
  const activeTenant = useDesigner((s) =>
    s.tenants.find((t) => t.slug === s.activeTenantSlug) ?? null,
  );
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [boards, setBoards] = useState<BoardLayout[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]); // history stack for undo
  const [error, setError] = useState<string | null>(null);

  // Multiplayer relay state. When `multiplayer` is set, every local
  // dispatch is also forwarded to peers; remote actions arriving on
  // the channel are applied to the local session via the same engine.
  const [multiplayer, setMultiplayer] = useState<MultiplayerState | null>(null);
  const [presence, setPresence] = useState<Array<PresenceRow>>([]);
  /** Monotonic local sequence so peers can break ties on simultaneous
   *  optimistic actions later (v0 just trusts the relay order). */
  const seqRef = useRef(0);
  /** Set of seqs we already applied locally — guards against the
   *  server bouncing our own action back to us. */
  const ownSeqs = useRef<Set<number>>(new Set());

  const session = sessions[sessions.length - 1] ?? null;

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void Promise.all([
      api.listRulesets({ projectId: project.id }),
      api.listBoards({ projectId: project.id }),
      api.listDecks({ projectId: project.id }),
    ])
      .then(([r, b, d]) => {
        if (cancelled) return;
        setRulesets(r);
        setBoards(b);
        setDecks(d);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [project]);

  const dispatch = useCallback(
    (action: EngineAction) => {
      if (!session) return;
      const next = applyAction(session, action);
      setSessions((prev) => [...prev, next].slice(-50)); // cap history

      // Multiplayer: forward this action to peers. We tag it with a
      // local seq so the receive handler can dedupe the bounce-back.
      if (multiplayer) {
        const seq = ++seqRef.current;
        ownSeqs.current.add(seq);
        void api
          .relayPlaytestAction(multiplayer.sessionId, {
            action: action as unknown as Record<string, unknown>,
            seq,
          })
          .catch((err) => {
            // Relay failures don't roll back the local state — the
            // user can keep playing solo. We just surface the error
            // so they know peers may diverge.
            setError(err instanceof Error ? err.message : "relay failed");
          });
      }
    },
    [session, multiplayer],
  );

  function undo() {
    setSessions((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }

  // Subscribe to the playtest channel while multiplayer is active.
  // Remote actions get applied via `applyAction` so peers stay in
  // lockstep. Presence pings flow through the same channel and feed
  // the lobby roster.
  useEffect(() => {
    if (!multiplayer || !activeTenant) return;
    const channel = rtChannels.playtest(activeTenant.id, multiplayer.sessionId);
    const off = rt.subscribe(channel, (event) => {
      if (event.kind === "playtest.action") {
        const payload = event.payload as
          | { action?: Record<string, unknown>; seq?: number; actorId?: string }
          | null;
        if (!payload?.action) return;
        // Skip our own bounce-backs.
        if (
          typeof payload.seq === "number" &&
          ownSeqs.current.has(payload.seq) &&
          payload.actorId === currentUser?.id
        ) {
          ownSeqs.current.delete(payload.seq);
          return;
        }
        // Apply the remote action through the same reducer the local
        // dispatch uses. The optimistic-application model means both
        // peers converge as long as no one disagrees on the engine
        // determinism — which our v0 engine is.
        setSessions((prev) => {
          const last = prev[prev.length - 1];
          if (!last) return prev;
          const next = applyAction(last, payload.action as EngineAction);
          return [...prev, next].slice(-50);
        });
      } else if (event.kind === "playtest.presence") {
        const p = event.payload as PresenceRow | null;
        if (!p) return;
        setPresence((prev) => {
          const idx = prev.findIndex((x) => x.userId === p.userId);
          if (idx >= 0) {
            const next = prev.slice();
            next[idx] = p;
            return next;
          }
          return [...prev, p];
        });
      } else if (event.kind === "playtest.closed") {
        setError("Host ended the multiplayer session.");
        setMultiplayer(null);
        setPresence([]);
      }
    });
    return () => off();
  }, [multiplayer, activeTenant, currentUser]);

  // Re-announce presence on join + every 2 minutes so peers know
  // we're still here. Covers the case where someone joined late and
  // we haven't introduced ourselves yet.
  useEffect(() => {
    if (!multiplayer || !currentUser) return;
    const announce = () => {
      void api
        .announcePlaytestPresence(multiplayer.sessionId, {
          displayName:
            (currentUser.displayName as string | undefined) ??
            (currentUser.email as string | undefined) ??
            "Player",
        })
        .catch(() => {
          /* presence is best-effort */
        });
    };
    announce();
    const t = setInterval(announce, 120_000);
    return () => clearInterval(t);
  }, [multiplayer, currentUser]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to start a playtest.</p>
      </div>
    );
  }

  if (!session) {
    return (
      <PlaytestLobby
        rulesets={rulesets}
        boards={boards}
        decks={decks}
        error={error}
        onStart={(s) => setSessions([s])}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MultiplayerPanel
        multiplayer={multiplayer}
        presence={presence}
        onCreate={async () => {
          try {
            const r = await api.createPlaytestSession({});
            setMultiplayer({
              sessionId: r.session.id,
              code: r.session.code,
              isOwner: true,
            });
            setPresence([]);
          } catch (err) {
            setError(err instanceof Error ? err.message : "create failed");
          }
        }}
        onJoin={async (code) => {
          try {
            const r = await api.findPlaytestSessionByCode(code);
            setMultiplayer({
              sessionId: r.session.id,
              code: r.session.code,
              isOwner: r.session.ownerId === currentUser?.id,
            });
            setPresence([]);
          } catch (err) {
            setError(err instanceof Error ? err.message : "join failed");
          }
        }}
        onLeave={async () => {
          if (multiplayer?.isOwner) {
            try {
              await api.closePlaytestSession(multiplayer.sessionId);
            } catch {
              /* ignore — we still want to leave locally */
            }
          }
          setMultiplayer(null);
          setPresence([]);
        }}
      />
      <div className="flex-1 overflow-hidden">
        <PlaytestSession
          session={session}
          dispatch={dispatch}
          onUndo={undo}
          canUndo={sessions.length > 1}
          onExit={() => setSessions([])}
        />
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Multiplayer panel (sec 30 + 37.2)                                      */
/* ====================================================================== */

function MultiplayerPanel({
  multiplayer,
  presence,
  onCreate,
  onJoin,
  onLeave,
}: {
  multiplayer: MultiplayerState | null;
  presence: PresenceRow[];
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  if (multiplayer) {
    return (
      <header className="flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2 text-xs text-ink-300">
        <div className="flex items-center gap-3">
          <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-300">
            Live
          </span>
          <div>
            <p className="text-ink-100">
              Session{" "}
              <code className="font-mono text-accent-300">
                {multiplayer.code}
              </code>
            </p>
            <p className="text-[10px] text-ink-500">
              {multiplayer.isOwner ? "You're hosting" : "Joined as guest"} ·{" "}
              {presence.length} {presence.length === 1 ? "peer" : "peers"} online
            </p>
          </div>
          {presence.length > 0 && (
            <ul className="flex flex-wrap gap-1">
              {presence.map((p) => (
                <li
                  key={p.userId}
                  className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px]"
                >
                  {p.displayName}
                  {p.seat != null && (
                    <span className="ml-1 text-ink-500">seat {p.seat}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(multiplayer.code).catch(() => {});
              }
            }}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
          >
            Copy code
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20"
          >
            {multiplayer.isOwner ? "End session" : "Leave"}
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between gap-3 border-b border-ink-800 bg-ink-900 px-4 py-2 text-xs text-ink-300">
      <div>
        <p className="text-ink-100">Multiplayer (beta)</p>
        <p className="text-[10px] text-ink-500">
          Both players run the same engine locally; the relay forwards each
          action over WebSocket so you stay in lockstep.
        </p>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          setBusy(true);
          try {
            onJoin(code.trim().toUpperCase());
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="JOIN CODE"
          maxLength={8}
          className="w-28 rounded border border-ink-700 bg-ink-950 px-2 py-1 text-center font-mono text-[11px] uppercase tracking-widest text-ink-100"
        />
        <button
          type="submit"
          disabled={!code.trim() || busy}
          className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700 disabled:opacity-50"
        >
          Join
        </button>
        <span className="text-ink-500">or</span>
        <button
          type="button"
          onClick={() => {
            setBusy(true);
            try {
              onCreate();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
        >
          Host new
        </button>
      </form>
    </header>
  );
}

/* ====================================================================== */
/* Lobby                                                                   */
/* ====================================================================== */

function PlaytestLobby({
  rulesets,
  boards,
  decks,
  error,
  onStart,
}: {
  rulesets: Ruleset[];
  boards: BoardLayout[];
  decks: Deck[];
  error: string | null;
  onStart: (s: Session) => void;
}) {
  // Pick a default ruleset: the one marked default, else the first.
  const defaultRulesetId = rulesets.find((r) => r.isDefault)?.id ?? rulesets[0]?.id ?? "";
  const [rulesetId, setRulesetId] = useState<string>(defaultRulesetId);
  useEffect(() => setRulesetId(defaultRulesetId), [defaultRulesetId]);

  const activeRuleset = rulesets.find((r) => r.id === rulesetId) ?? null;
  const config: RulesetConfig = activeRuleset
    ? coerceConfig(activeRuleset.configJson)
    : DEFAULT_RULESET_CONFIG;

  const [playerCount, setPlayerCount] = useState<number>(config.playerSetup.defaultPlayers);
  const [boardId, setBoardId] = useState<string>("");
  const [seatDecks, setSeatDecks] = useState<Array<string>>([]);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  // When the ruleset changes, snap player count back into the new range.
  useEffect(() => {
    setPlayerCount((cur) =>
      Math.max(
        config.playerSetup.minPlayers,
        Math.min(config.playerSetup.maxPlayers, cur || config.playerSetup.defaultPlayers),
      ),
    );
  }, [rulesetId]);

  // Seat-deck array length tracks player count.
  useEffect(() => {
    setSeatDecks((prev) => {
      const next = prev.slice(0, playerCount);
      while (next.length < playerCount) next.push("");
      return next;
    });
  }, [playerCount]);

  async function start() {
    setLocalErr(null);
    if (!activeRuleset) {
      setLocalErr("Pick a ruleset.");
      return;
    }
    if (!boardId) {
      setLocalErr("Pick a board.");
      return;
    }
    setBusy(true);
    try {
      const board = await api.getBoard(boardId);
      const seatDeckObjs = await Promise.all(
        seatDecks.map((id) => (id ? api.getDeck(id) : Promise.resolve(null))),
      );
      const session = newSession({
        ruleset: config,
        board,
        decks: seatDeckObjs,
      });
      onStart(session);
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "couldn't start session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-y-auto bg-ink-950 p-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">Playtest</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">New session</h1>
          <p className="mt-1 text-sm text-ink-400">
            Pick a ruleset to drive turn structure and win conditions, a board for the play
            area, and a deck for each seat. The engine handles the rest.
          </p>
        </header>

        {(error || localErr) && (
          <div className="mb-4 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error ?? localErr}
          </div>
        )}

        <div className="space-y-4 rounded border border-ink-700 bg-ink-900 p-5">
          <Field label="Ruleset">
            <select
              value={rulesetId}
              onChange={(e) => setRulesetId(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="">— Pick a ruleset —</option>
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </Field>

          {activeRuleset && (
            <div className="rounded border border-ink-800 bg-ink-950/60 p-3 text-[11px] text-ink-400">
              {activeRuleset.description || (
                <em className="text-ink-500">No description.</em>
              )}
              <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px]">
                <span>
                  Players: {config.playerSetup.minPlayers}–{config.playerSetup.maxPlayers}
                </span>
                <span>Phases: {config.phases.length}</span>
                <span>Win conds: {config.winConditions.length}</span>
              </div>
            </div>
          )}

          <Field label="Board layout">
            <select
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="">— Pick a board —</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.zonesJson.length} zones)
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Players (${config.playerSetup.minPlayers}–${config.playerSetup.maxPlayers})`}>
            <input
              type="number"
              min={config.playerSetup.minPlayers}
              max={config.playerSetup.maxPlayers}
              value={playerCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  setPlayerCount(
                    Math.max(
                      config.playerSetup.minPlayers,
                      Math.min(config.playerSetup.maxPlayers, Math.round(n)),
                    ),
                  );
                }
              }}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm tabular-nums text-ink-100"
            />
          </Field>

          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-400">Seats</p>
            {Array.from({ length: playerCount }).map((_, i) => {
              const seatLabel = config.playerSetup.seatLabels[i] ?? `P${i + 1}`;
              return (
                <div key={i} className="grid grid-cols-[80px_1fr] items-center gap-2">
                  <span className="text-xs text-ink-300">{seatLabel}</span>
                  <select
                    value={seatDecks[i] ?? ""}
                    onChange={(e) => {
                      setSeatDecks((prev) => prev.map((d, j) => (j === i ? e.target.value : d)));
                    }}
                    className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
                  >
                    <option value="">— No deck (empty seat) —</option>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.cardCount ?? 0} slots)
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={start}
            disabled={busy || !rulesetId || !boardId}
            className="w-full rounded border border-accent-500/40 bg-accent-500/15 px-3 py-2 text-sm font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
          >
            {busy ? "Starting…" : "Start session"}
          </button>
        </div>

        {rulesets.length === 0 && (
          <p className="mt-4 text-[11px] text-ink-500">
            No rulesets in this project — head to the Rulesets view to clone a preset.
          </p>
        )}
        {boards.length === 0 && (
          <p className="mt-2 text-[11px] text-ink-500">
            No boards in this project — head to Boards to define a play area.
          </p>
        )}
        {decks.length === 0 && (
          <p className="mt-2 text-[11px] text-ink-500">
            No decks in this project — head to Decks to build one.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
    </label>
  );
}

/* ====================================================================== */
/* Session UI                                                              */
/* ====================================================================== */

function PlaytestSession({
  session,
  dispatch,
  onUndo,
  canUndo,
  onExit,
}: {
  session: Session;
  dispatch: (action: EngineAction) => void;
  onUndo: () => void;
  canUndo: boolean;
  onExit: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { cardId: string; clientX: number; clientY: number }
    | null
  >(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (box.w === 0 || box.h === 0) return 1;
    return Math.min(box.w / session.board.width, box.h / session.board.height);
  }, [box, session.board.width, session.board.height]);

  const phase = session.ruleset.phases[session.phaseIndex];
  const activePlayer = session.players[session.activeSeat];

  function startCardDrag(cardId: string) {
    return (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      setDraggingCardId(cardId);
      const onUp = (ev: PointerEvent) => {
        const localPt = clientToBoardCoord(wrapRef.current, ev.clientX, ev.clientY, scale, session.board);
        if (localPt) {
          const target = session.board.zonesJson.find(
            (z) =>
              localPt.x >= z.bounds.x &&
              localPt.x <= z.bounds.x + z.bounds.width &&
              localPt.y >= z.bounds.y &&
              localPt.y <= z.bounds.y + z.bounds.height,
          );
          if (target) {
            const card = session.cards.find((c) => c.id === cardId);
            if (card && card.zoneId !== target.id) {
              dispatch({ kind: "move_card", cardId, toZoneId: target.id });
            }
          }
        }
        setDraggingCardId(null);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointerup", onUp);
    };
  }

  // Hotkey handling for ruleset.customActions.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) return;
      // Match by hotkey string. We support single-letter hotkeys for MVP.
      for (const a of session.ruleset.customActions) {
        if (a.hotkey && a.hotkey.toLowerCase() === e.key.toLowerCase()) {
          e.preventDefault();
          dispatch({ kind: "run_player_action", actionId: a.id, seat: session.activeSeat });
          return;
        }
      }
      // Built-ins
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        dispatch({ kind: "next_phase" });
      } else if (e.key === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (canUndo) onUndo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, canUndo, dispatch, onUndo]);

  return (
    <div
      className="grid h-full grid-cols-[1fr_320px] overflow-hidden"
      onClick={() => setContextMenu(null)}
    >
      <main className="flex flex-col overflow-hidden bg-ink-950">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onExit}
              className="text-[11px] text-ink-400 hover:text-ink-100"
            >
              ← End session
            </button>
            <div>
              <h1 className="text-sm font-semibold text-ink-50">{session.board.name}</h1>
              <p className="text-[10px] text-ink-500">
                Turn {session.turn} · {activePlayer?.label ?? "?"} · {phase?.name ?? "?"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700 disabled:opacity-40"
              title="Undo (Ctrl+Z)"
            >
              ↶ Undo
            </button>
            <button
              type="button"
              onClick={() => dispatch({ kind: "next_phase" })}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
              title="Next phase (N)"
            >
              Next phase →
            </button>
            <button
              type="button"
              onClick={() => dispatch({ kind: "end_turn" })}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
            >
              End turn
            </button>
          </div>
        </header>

        {/* Phase strip */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-3 py-1.5">
          {session.ruleset.phases.map((p, i) => (
            <span
              key={p.id}
              className={[
                "rounded border px-2 py-0.5 text-[11px]",
                i === session.phaseIndex
                  ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                  : "border-ink-800 bg-ink-900 text-ink-400",
              ].join(" ")}
            >
              {p.name}
            </span>
          ))}
        </div>

        {/* Custom action toolbar */}
        {session.ruleset.customActions.length > 0 && (
          <div className="flex items-center gap-1 overflow-x-auto border-b border-ink-700 bg-ink-900 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wider text-ink-500">Actions:</span>
            {session.ruleset.customActions.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() =>
                  dispatch({
                    kind: "run_player_action",
                    actionId: a.id,
                    seat: session.activeSeat,
                  })
                }
                className="rounded border border-ink-700 bg-ink-800 px-2 py-0.5 text-[11px] text-ink-100 hover:bg-ink-700"
                title={a.hotkey ? `Hotkey: ${a.hotkey.toUpperCase()}` : undefined}
              >
                {a.label}
                {a.hotkey && (
                  <span className="ml-1 font-mono text-[9px] text-ink-500">
                    [{a.hotkey.toUpperCase()}]
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {session.outcome && (
          <div className="border-b border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
            <strong>Game over —</strong>{" "}
            {session.outcome.winners.length === 0
              ? "Draw."
              : `${session.outcome.winners.map((s) => session.players[s]?.label ?? s).join(", ")} wins.`}{" "}
            <span className="text-emerald-400/70">{session.outcome.reason}</span>
          </div>
        )}

        <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
          <svg
            viewBox={`0 0 ${session.board.width} ${session.board.height}`}
            preserveAspectRatio="xMidYMid meet"
            style={{
              width: session.board.width * scale,
              height: session.board.height * scale,
            }}
            className="rounded-lg border border-ink-700 shadow-2xl"
          >
            <rect
              x={0}
              y={0}
              width={session.board.width}
              height={session.board.height}
              fill={session.board.background}
            />
            {session.board.zonesJson.map((zone) => (
              <ZoneSvg
                key={zone.id}
                zone={zone}
                session={session}
                draggingCardId={draggingCardId}
                onZoneClick={(z) => {
                  if (z.kind === "deck") {
                    // Map zone owner back to seat index.
                    const seat = z.owner === "p1" ? 0 : z.owner === "p2" ? 1 : 0;
                    dispatch({ kind: "draw_card", seat, fromZoneId: z.id });
                  }
                }}
                onZoneShuffle={(z) => dispatch({ kind: "shuffle_zone", zoneId: z.id })}
                onCardClick={(c, e) => {
                  if (e.shiftKey) dispatch({ kind: "toggle_tapped", cardId: c.id });
                }}
                onCardDragStart={startCardDrag}
                onCardContextMenu={(c, e) => {
                  e.preventDefault();
                  setContextMenu({ cardId: c.id, clientX: e.clientX, clientY: e.clientY });
                }}
              />
            ))}
          </svg>

          {contextMenu && (
            <CardContextMenu
              session={session}
              cardId={contextMenu.cardId}
              x={contextMenu.clientX}
              y={contextMenu.clientY}
              onAction={(actionId) => {
                dispatch({ kind: "run_card_action", actionId, cardId: contextMenu.cardId });
                setContextMenu(null);
              }}
              onTapToggle={() => {
                dispatch({ kind: "toggle_tapped", cardId: contextMenu.cardId });
                setContextMenu(null);
              }}
              onCounter={(counter, delta) => {
                dispatch({ kind: "adjust_counter", cardId: contextMenu.cardId, counter, delta });
                setContextMenu(null);
              }}
              onClose={() => setContextMenu(null)}
            />
          )}
        </div>
      </main>

      <aside className="flex flex-col overflow-hidden border-l border-ink-700 bg-ink-900">
        <PlayerPanels session={session} dispatch={dispatch} />
        <div className="flex-1 overflow-y-auto border-t border-ink-700 p-3 text-[11px] text-ink-300">
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">Game log</h3>
          <ul>
            {session.log
              .slice()
              .reverse()
              .map((entry, i) => (
                <li
                  key={`${entry.ts}-${i}`}
                  className={[
                    "border-b border-ink-800 px-1 py-1 last:border-0",
                    entry.kind === "win" && "text-emerald-300",
                    entry.kind === "phase" && "text-accent-300",
                    entry.kind === "system" && "text-ink-500",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {entry.message}
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/* ====================================================================== */
/* Player panels (resources)                                               */
/* ====================================================================== */

function PlayerPanels({
  session,
  dispatch,
}: {
  session: Session;
  dispatch: (action: EngineAction) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-ink-700 p-3">
      {session.players.map((p) => {
        const active = p.seatIndex === session.activeSeat;
        return (
          <div
            key={p.seatIndex}
            className={[
              "rounded border p-2",
              active
                ? "border-accent-500/40 bg-accent-500/10"
                : "border-ink-800 bg-ink-950/40",
              p.eliminated && "opacity-40",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink-100">
                {p.label}
                {p.eliminated && <span className="ml-1 text-[10px] text-danger-500">eliminated</span>}
                {p.won && <span className="ml-1 text-[10px] text-emerald-300">winner</span>}
              </span>
              <button
                type="button"
                onClick={() => dispatch({ kind: "concede", seat: p.seatIndex })}
                disabled={p.eliminated}
                className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-danger-500/30 hover:bg-danger-500/10 hover:text-danger-500 disabled:opacity-30"
              >
                concede
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {Object.entries(p.resources).map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center gap-1 rounded border border-ink-800 bg-ink-900 px-1.5 py-1"
                >
                  <span className="flex-1 text-[10px] uppercase tracking-wider text-ink-500">
                    {key}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        kind: "adjust_resource",
                        seat: p.seatIndex,
                        resource: key,
                        delta: -1,
                      })
                    }
                    className="px-1 text-ink-300 hover:text-ink-100"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-semibold tabular-nums text-ink-100">
                    {value}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      dispatch({
                        kind: "adjust_resource",
                        seat: p.seatIndex,
                        resource: key,
                        delta: 1,
                      })
                    }
                    className="px-1 text-ink-300 hover:text-ink-100"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ====================================================================== */
/* Card context menu                                                       */
/* ====================================================================== */

function CardContextMenu({
  session,
  cardId,
  x,
  y,
  onAction,
  onTapToggle,
  onCounter,
  onClose,
}: {
  session: Session;
  cardId: string;
  x: number;
  y: number;
  onAction: (actionId: string) => void;
  onTapToggle: () => void;
  onCounter: (counter: string, delta: number) => void;
  onClose: () => void;
}) {
  const card = session.cards.find((c) => c.id === cardId);
  if (!card) return null;
  // Position the menu near the click; clamp to viewport bounds.
  const style: React.CSSProperties = {
    left: Math.max(4, Math.min(x, window.innerWidth - 220)),
    top: Math.max(4, Math.min(y, window.innerHeight - 320)),
  };
  return (
    <div
      role="menu"
      style={style}
      className="fixed z-50 w-56 overflow-hidden rounded border border-ink-700 bg-ink-900 shadow-2xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="border-b border-ink-800 px-3 py-1.5 text-[11px] text-ink-400">
        {session.cardById.get(card.cardId)?.name ?? "Card"}
      </div>
      <button
        type="button"
        onClick={onTapToggle}
        className="block w-full px-3 py-1.5 text-left text-xs text-ink-100 hover:bg-ink-800"
      >
        {card.tapped ? "Untap" : "Tap"}
      </button>
      {session.ruleset.cardActions.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onAction(a.id)}
          className="block w-full px-3 py-1.5 text-left text-xs text-ink-100 hover:bg-ink-800"
        >
          {a.label}
        </button>
      ))}
      <div className="border-t border-ink-800 px-3 py-1 text-[10px] uppercase tracking-wider text-ink-500">
        Counters
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-1 px-3 py-1">
        <span className="text-[11px] text-ink-300">+1/+1</span>
        <button
          type="button"
          onClick={() => onCounter("+1/+1", -1)}
          className="rounded border border-ink-700 bg-ink-800 px-1.5 text-xs text-ink-100"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => onCounter("+1/+1", 1)}
          className="rounded border border-ink-700 bg-ink-800 px-1.5 text-xs text-ink-100"
        >
          +
        </button>
      </div>
      {Object.entries(card.counters).map(([k, v]) => (
        <div key={k} className="grid grid-cols-[1fr_auto_auto_28px] items-center gap-1 px-3 py-1">
          <span className="text-[11px] text-ink-300">
            {k}: <span className="tabular-nums text-ink-100">{v}</span>
          </span>
          <button
            type="button"
            onClick={() => onCounter(k, -1)}
            className="rounded border border-ink-700 bg-ink-800 px-1.5 text-xs text-ink-100"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => onCounter(k, 1)}
            className="rounded border border-ink-700 bg-ink-800 px-1.5 text-xs text-ink-100"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onCounter(k, -v)}
            className="rounded border border-ink-700 bg-ink-900 text-ink-500 hover:text-danger-500"
            title="Clear counter"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={onClose}
        className="block w-full border-t border-ink-800 px-3 py-1.5 text-left text-[11px] text-ink-500 hover:bg-ink-800"
      >
        Close
      </button>
    </div>
  );
}

/* ====================================================================== */
/* Zone rendering                                                          */
/* ====================================================================== */

function ZoneSvg({
  zone,
  session,
  draggingCardId,
  onZoneClick,
  onZoneShuffle,
  onCardClick,
  onCardDragStart,
  onCardContextMenu,
}: {
  zone: Session["board"]["zonesJson"][number];
  session: Session;
  draggingCardId: string | null;
  onZoneClick: (z: Session["board"]["zonesJson"][number]) => void;
  onZoneShuffle: (z: Session["board"]["zonesJson"][number]) => void;
  onCardClick: (c: PlayCard, e: React.MouseEvent) => void;
  onCardDragStart: (cardId: string) => (e: React.PointerEvent) => void;
  onCardContextMenu: (c: PlayCard, e: React.MouseEvent) => void;
}) {
  const cardsInZone = useMemo(
    () =>
      session.cards
        .filter((c) => c.zoneId === zone.id)
        .sort((a, b) => a.index - b.index),
    [session.cards, zone.id],
  );

  const cardW = Math.min(zone.bounds.width / 4, 180);
  const cardH = cardW * 1.4;
  const positions = useMemo(() => {
    const out: Array<{ x: number; y: number; w: number; h: number }> = [];
    if (zone.stackMode === "stacked") {
      for (let i = 0; i < cardsInZone.length; i++) {
        out.push({
          x: zone.bounds.x + 8 + Math.min(i, 6),
          y: zone.bounds.y + 8 + Math.min(i, 6),
          w: cardW,
          h: cardH,
        });
      }
    } else {
      const innerW = Math.max(0, zone.bounds.width - 16);
      const step =
        cardsInZone.length > 1 ? Math.min(cardW + 6, innerW / cardsInZone.length) : 0;
      for (let i = 0; i < cardsInZone.length; i++) {
        out.push({
          x: zone.bounds.x + 8 + i * step,
          y: zone.bounds.y + (zone.bounds.height - cardH) / 2,
          w: cardW,
          h: cardH,
        });
      }
    }
    return out;
  }, [
    cardsInZone,
    zone.bounds.x,
    zone.bounds.y,
    zone.bounds.width,
    zone.bounds.height,
    zone.stackMode,
    cardW,
    cardH,
  ]);

  const facedown =
    zone.visibility === "private" ||
    (zone.visibility === "owner_only" && zone.kind === "deck");

  return (
    <g>
      <rect
        x={zone.bounds.x}
        y={zone.bounds.y}
        width={zone.bounds.width}
        height={zone.bounds.height}
        fill={zone.color ?? "rgba(0,0,0,0.2)"}
        stroke="rgba(212,162,76,0.3)"
        strokeWidth={2}
        strokeDasharray="14 12"
        onClick={() => onZoneClick(zone)}
        style={{ cursor: zone.kind === "deck" ? "pointer" : "default" }}
      />
      <text
        x={zone.bounds.x + 12}
        y={zone.bounds.y + 28}
        fill="rgba(255,255,255,0.7)"
        fontSize={Math.max(14, Math.min(28, zone.bounds.height * 0.07))}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        pointerEvents="none"
      >
        {zone.name}
      </text>
      <text
        x={zone.bounds.x + zone.bounds.width - 12}
        y={zone.bounds.y + 28}
        fill="rgba(255,255,255,0.5)"
        fontSize={14}
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        textAnchor="end"
        pointerEvents="none"
      >
        {cardsInZone.length}
      </text>
      {(zone.kind === "deck" || zone.kind === "discard") && cardsInZone.length > 1 && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            onZoneShuffle(zone);
          }}
          style={{ cursor: "pointer" }}
        >
          <rect
            x={zone.bounds.x + zone.bounds.width - 86}
            y={zone.bounds.y + 8}
            width={70}
            height={22}
            rx={4}
            fill="rgba(0,0,0,0.4)"
            stroke="rgba(212,162,76,0.6)"
          />
          <text
            x={zone.bounds.x + zone.bounds.width - 51}
            y={zone.bounds.y + 24}
            fill="#d4a24c"
            fontSize={12}
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            textAnchor="middle"
            pointerEvents="none"
          >
            shuffle
          </text>
        </g>
      )}

      {cardsInZone.map((c, i) => {
        const pos = positions[i];
        if (!pos) return null;
        const card = session.cardById.get(c.cardId);
        const isDragging = c.id === draggingCardId;
        return (
          <g
            key={c.id}
            transform={c.tapped ? `rotate(90 ${pos.x + pos.w / 2} ${pos.y + pos.h / 2})` : undefined}
            opacity={isDragging ? 0.4 : 1}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              onCardDragStart(c.id)(e);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onCardClick(c, e);
            }}
            onContextMenu={(e) => onCardContextMenu(c, e)}
            style={{ cursor: "grab" }}
          >
            <rect
              x={pos.x}
              y={pos.y}
              width={pos.w}
              height={pos.h}
              rx={6}
              fill={facedown ? "#1a1d2a" : "#262c3d"}
              stroke="#d4a24c"
              strokeWidth={1.5}
            />
            {!facedown && card && (
              <text
                x={pos.x + 8}
                y={pos.y + 22}
                fill="#ebd198"
                fontSize={Math.max(11, pos.w * 0.08)}
                fontFamily="serif"
                pointerEvents="none"
              >
                {truncate(card.name, Math.floor(pos.w / 8))}
              </text>
            )}
            {facedown && (
              <text
                x={pos.x + pos.w / 2}
                y={pos.y + pos.h / 2 + 4}
                fill="rgba(212,162,76,0.4)"
                fontSize={pos.w * 0.18}
                fontFamily="serif"
                fontStyle="italic"
                textAnchor="middle"
                pointerEvents="none"
              >
                ?
              </text>
            )}
            {/* Counter badges — show up to 3 stacked at the bottom-right. */}
            {Object.entries(c.counters).slice(0, 3).map(([k, v], j) => (
              <g key={k}>
                <rect
                  x={pos.x + pos.w - 38}
                  y={pos.y + pos.h - 16 - j * 16}
                  width={32}
                  height={14}
                  rx={4}
                  fill="rgba(0,0,0,0.6)"
                  stroke="#d4a24c"
                  strokeWidth={0.75}
                />
                <text
                  x={pos.x + pos.w - 22}
                  y={pos.y + pos.h - 6 - j * 16}
                  fill="#ebd198"
                  fontSize={9}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {k}:{v}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

/* ====================================================================== */
/* Helpers                                                                 */
/* ====================================================================== */

function clientToBoardCoord(
  wrap: HTMLElement | null,
  clientX: number,
  clientY: number,
  scale: number,
  board: { width: number; height: number },
): { x: number; y: number } | null {
  if (!wrap) return null;
  const r = wrap.getBoundingClientRect();
  const svgW = board.width * scale;
  const svgH = board.height * scale;
  const ox = (r.width - svgW) / 2;
  const oy = (r.height - svgH) / 2;
  const x = (clientX - r.left - ox) / scale;
  const y = (clientY - r.top - oy) / scale;
  if (x < 0 || y < 0 || x > board.width || y > board.height) return null;
  return { x, y };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, Math.max(1, n - 1))}…`;
}

function coerceConfig(input: unknown): RulesetConfig {
  const def = DEFAULT_RULESET_CONFIG;
  if (!input || typeof input !== "object") return def;
  const c = input as Partial<RulesetConfig>;
  return {
    playerSetup: { ...def.playerSetup, ...(c.playerSetup ?? {}) },
    phases: Array.isArray(c.phases) ? c.phases : def.phases,
    winConditions: Array.isArray(c.winConditions) ? c.winConditions : def.winConditions,
    customActions: Array.isArray(c.customActions) ? c.customActions : def.customActions,
    cardActions: Array.isArray(c.cardActions) ? c.cardActions : def.cardActions,
    autoAdvancePhases: c.autoAdvancePhases ?? def.autoAdvancePhases,
  };
}
