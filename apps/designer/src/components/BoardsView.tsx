import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { BoardLayout, BoardZone } from "@/lib/apiTypes";

/**
 * Boards view (sec 26).
 *
 * Two modes mirroring the deck view:
 *   • Browse — grid of board tiles (mini playmat preview).
 *   • Edit   — drag-drop zone designer with a property inspector.
 *
 * Why we don't use Konva for the board canvas (unlike the card type
 * designer): board zones are simple rectangles. SVG handles drag/resize
 * just as well at this scale, with cleaner accessibility, and it
 * avoids loading another Konva instance for a separate workspace.
 *
 * The board canvas is laid out in design-pixel space (e.g. 1920×1080)
 * and scaled to fit the viewport via a CSS transform on the wrapper.
 */
export function BoardsView() {
  const project = useDesigner(selectActiveProject);
  const [boards, setBoards] = useState<BoardLayout[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setBoards([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setBoards(await api.listBoards({ projectId: project.id }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Pick a project to manage its boards.</p>
      </div>
    );
  }

  if (editingId) {
    return (
      <BoardDesigner
        boardId={editingId}
        onClose={() => {
          setEditingId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Project: {project.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Boards</h1>
            <p className="mt-1 text-xs text-ink-400">
              {boards.length} board{boards.length === 1 ? "" : "s"} · play areas with named zones for playtest.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
          >
            + New board
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        {creating && (
          <NewBoardForm
            projectId={project.id}
            onCancel={() => setCreating(false)}
            onCreated={(b) => {
              setBoards((prev) => [...prev, b]);
              setCreating(false);
              setEditingId(b.id);
            }}
          />
        )}

        {loading && boards.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {boards.map((b) => (
              <li
                key={b.id}
                className="group flex flex-col rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40"
              >
                <button
                  type="button"
                  onClick={() => setEditingId(b.id)}
                  className="flex flex-1 flex-col gap-2 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-ink-50">{b.name}</h3>
                      <p className="font-mono text-[10px] text-ink-500">{b.slug}</p>
                    </div>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300">
                      {b.zonesJson.length} zones
                    </span>
                  </div>
                  <BoardThumb board={b} />
                  <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
                    <span>
                      {b.width} × {b.height}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{b.status}</span>
                  </div>
                </button>
                <div className="flex border-t border-ink-800">
                  <button
                    type="button"
                    onClick={() => setEditingId(b.id)}
                    className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete board "${b.name}"?`)) return;
                      try {
                        await api.deleteBoard(b.id);
                        await refresh();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "delete failed");
                      }
                    }}
                    className="flex-1 border-l border-ink-800 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-500 hover:bg-danger-500/10 hover:text-danger-500"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!loading && boards.length === 0 && (
              <li className="col-span-full rounded border border-dashed border-ink-700 px-3 py-10 text-center text-xs text-ink-500">
                No boards yet — create one to define a play area.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Tile preview                                                            */
/* ====================================================================== */

function BoardThumb({ board }: { board: BoardLayout }) {
  // Mini SVG render of the zones at thumbnail scale. The aspect of the
  // board's design canvas drives the viewBox so different sizes (e.g.
  // landscape playmat vs portrait deck) preview at the right ratio.
  return (
    <div className="aspect-[16/9] w-full overflow-hidden rounded border border-ink-700 bg-ink-950">
      <svg
        viewBox={`0 0 ${board.width} ${board.height}`}
        preserveAspectRatio="xMidYMid meet"
        className="block h-full w-full"
      >
        <rect x={0} y={0} width={board.width} height={board.height} fill={board.background} />
        {board.zonesJson.map((z) => (
          <g key={z.id}>
            <rect
              x={z.bounds.x}
              y={z.bounds.y}
              width={z.bounds.width}
              height={z.bounds.height}
              fill={z.color ?? "rgba(212,162,76,0.08)"}
              stroke={z.color ?? "rgba(212,162,76,0.6)"}
              strokeWidth={4}
              strokeDasharray="14 12"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ====================================================================== */
/* New-board form                                                          */
/* ====================================================================== */

function NewBoardForm({
  projectId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  onCreated: (b: BoardLayout) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedSlug, setTouchedSlug] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createBoard({
        projectId,
        name,
        slug,
        // 1860 × 1040 matches the MTG-style strip layout in
        // `defaultZones`. Aspect ≈ 16:9 so it fits standard widescreen
        // playtest sessions without letterboxing the phase strip.
        width: 1860,
        height: 1040,
        // Seed with the MTG-style strip layout so the user lands on
        // a useful starting state instead of a blank canvas.
        zonesJson: defaultZones(),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 grid grid-cols-[1fr_220px_auto_auto] items-end gap-2 rounded border border-accent-500/40 bg-accent-500/5 p-3"
    >
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">Name</span>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            if (!touchedSlug) setSlug(slugify(e.target.value));
          }}
          placeholder="Standard 1v1"
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            setTouchedSlug(true);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"));
          }}
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
        />
      </label>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={busy || !name || !slug}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
      >
        {busy ? "…" : "Create"}
      </button>
      {error && <p className="col-span-full text-[11px] text-danger-500">{error}</p>}
    </form>
  );
}

/**
 * MTG-style default — vertical phase strip on the far left, then
 * horizontal player rows stacked top-to-bottom. Each player row has:
 *   • a thin green priority/turn divider at the top of the row
 *   • a narrow player-info column (avatar + life + mana/poison pips)
 *   • a narrow red library column (deck stack)
 *   • a wide purple battlefield split into a creatures band and a
 *     lands band, separated by a horizontal divider
 *
 * Defaults to 4 player rows so 2-player games show 2 + 2 empty slots
 * ready to fill. Phase strip is shared across all players (it's the
 * turn structure — only one phase is active at a time).
 *
 * Coordinate budget (matches the reference screenshot proportions):
 *   - Board total: 1860 × 1040 (≈ same aspect as the screenshot)
 *   - Phase strip: x ∈ [0, 80]
 *   - Player info:  x ∈ [80, 200]
 *   - Library:      x ∈ [200, 240]
 *   - Battlefield:  x ∈ [240, 1860]
 *   - Each player row gets 248px of vertical space, with an 8px
 *     priority bar (green) at the top and the remainder split between
 *     creatures (upper ~60%) and lands (lower ~40%).
 */
function defaultZones(): BoardZone[] {
  // Phase strip — one zone per phase. Stacked vertically. The playtest
  // engine reads `kind: "phase"` to drive the turn-tracker behavior;
  // see `playtestEngine.ts`'s phase advancement code.
  const phases = [
    { id: "untap", label: "Untap" },
    { id: "upkeep", label: "Upkeep" },
    { id: "draw", label: "Draw" },
    { id: "main1", label: "Main 1" },
    { id: "start-combat", label: "Start Combat" },
    { id: "attack", label: "Attack" },
    { id: "block", label: "Block" },
    { id: "damage", label: "Damage" },
    { id: "end-combat", label: "End Combat" },
    { id: "main2", label: "Main 2" },
    { id: "end", label: "End" },
    { id: "pass", label: "Pass" },
  ];
  const phaseStripX = 0;
  const phaseStripW = 80;
  const phaseBlockH = 80;
  const phaseStrip: BoardZone[] = phases.map((p, i) => ({
    id: `phase-${p.id}`,
    name: p.label,
    kind: "phase",
    bounds: {
      x: phaseStripX,
      y: i * phaseBlockH,
      width: phaseStripW,
      height: phaseBlockH,
    },
    owner: "shared",
    visibility: "public",
    stackMode: "stacked",
    color: "#1d2230",
    phaseId: p.id,
  }));

  // Per-player rows.
  const playerInfoX = phaseStripW;
  const playerInfoW = 120;
  const libraryX = playerInfoX + playerInfoW;
  const libraryW = 40;
  const battlefieldX = libraryX + libraryW;
  const battlefieldW = 1860 - battlefieldX; // 1620

  const rowH = 248;
  const priorityH = 12; // tiny green divider at the top of each row

  function playerRow(playerN: number, rowTop: number): BoardZone[] {
    const owner = `p${playerN}`;
    const creaturesY = rowTop + priorityH;
    const creaturesH = Math.floor((rowH - priorityH) * 0.6);
    const landsY = creaturesY + creaturesH;
    const landsH = rowH - priorityH - creaturesH;

    return [
      {
        id: `${owner}-priority`,
        name: `P${playerN} Priority`,
        kind: "priority",
        bounds: { x: playerInfoX, y: rowTop, width: 1860 - playerInfoX, height: priorityH },
        owner,
        visibility: "public",
        stackMode: "spread",
        color: "#4d6b3c", // muted moss-green divider
      },
      {
        id: `${owner}-info`,
        name: `Player ${playerN}`,
        kind: "player_info",
        bounds: { x: playerInfoX, y: creaturesY, width: playerInfoW, height: creaturesH + landsH },
        owner,
        visibility: "public",
        stackMode: "stacked",
        color: "#2a2f3a", // dark slate for the avatar / counter strip
        // Per-player counter slots — life on top, then a vertical
        // column of mana-style pips (white / blue / black / red /
        // green / colorless). The playtest engine reads these via
        // `kind: "player_info"` + `counters` to render the UI in the
        // screenshot.
        counters: [
          { id: "life", label: "Life", value: 20, color: "#e8c75a" },
          { id: "library", label: "Library", value: 99, color: "#cfcfcf" },
          { id: "poison", label: "Poison", value: 0, color: "#c0c0c0" },
          { id: "mana-w", label: "W", value: 0, color: "#f6e58d" },
          { id: "mana-u", label: "U", value: 0, color: "#5d9cec" },
          { id: "mana-b", label: "B", value: 0, color: "#3a3a3a" },
          { id: "mana-r", label: "R", value: 0, color: "#e85a4f" },
          { id: "mana-g", label: "G", value: 0, color: "#52a85f" },
          { id: "mana-c", label: "C", value: 0, color: "#c8a96a" },
        ],
      },
      {
        id: `${owner}-library`,
        name: `P${playerN} Library`,
        kind: "deck",
        bounds: { x: libraryX, y: creaturesY, width: libraryW, height: creaturesH + landsH },
        owner,
        visibility: "private",
        stackMode: "stacked",
        color: "#7a3535", // brick-red card stack
      },
      {
        id: `${owner}-creatures`,
        name: `P${playerN} Creatures`,
        kind: "battlefield",
        bounds: { x: battlefieldX, y: creaturesY, width: battlefieldW, height: creaturesH },
        owner,
        visibility: "public",
        stackMode: "spread",
        color: "#3a2f5a", // deep purple, brighter when active
        zoneRole: "creatures",
      },
      {
        id: `${owner}-lands`,
        name: `P${playerN} Lands`,
        kind: "battlefield",
        bounds: { x: battlefieldX, y: landsY, width: battlefieldW, height: landsH },
        owner,
        visibility: "public",
        stackMode: "spread",
        color: "#322751", // slightly darker purple for the lands band
        zoneRole: "lands",
      },
    ];
  }

  const players: BoardZone[] = [];
  for (let i = 0; i < 4; i++) {
    players.push(...playerRow(i + 1, i * rowH));
  }

  return [...phaseStrip, ...players];
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/* ====================================================================== */
/* Designer                                                                */
/* ====================================================================== */

function BoardDesigner({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [board, setBoard] = useState<BoardLayout | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .getBoard(boardId)
      .then((b) => !cancelled && setBoard(b))
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function persist(patch: Partial<BoardLayout>) {
    if (!board) return;
    try {
      const updated = await api.updateBoard(board.id, patch);
      setBoard(updated);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  function patchZones(updater: (zones: BoardZone[]) => BoardZone[]) {
    if (!board) return;
    const next = updater(board.zonesJson);
    setBoard({ ...board, zonesJson: next });
  }

  async function saveZones() {
    if (!board) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateBoard(board.id, {
        zonesJson: board.zonesJson,
        width: board.width,
        height: board.height,
        background: board.background,
      });
      setBoard(updated);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  function addZone() {
    if (!board) return;
    const cx = board.width / 2;
    const cy = board.height / 2;
    const id = `zone-${Math.random().toString(36).slice(2, 7)}`;
    const next: BoardZone = {
      id,
      name: "New zone",
      kind: "custom",
      bounds: { x: cx - 150, y: cy - 100, width: 300, height: 200 },
      owner: "shared",
      visibility: "public",
      stackMode: "spread",
      color: "#3a4258",
    };
    patchZones((zs) => [...zs, next]);
    setSelectedId(id);
  }

  function deleteZone(id: string) {
    patchZones((zs) => zs.filter((z) => z.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-sm text-ink-500">
        {error ?? "Loading board…"}
      </div>
    );
  }

  const selected = board.zonesJson.find((z) => z.id === selectedId) ?? null;

  return (
    <div className="grid grid-cols-[1fr_320px] overflow-hidden">
      <main className="flex flex-col overflow-hidden bg-ink-950">
        <header className="flex items-center justify-between border-b border-ink-700 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-ink-400 hover:text-ink-100"
            >
              ← Boards
            </button>
            <h1 className="text-base font-semibold text-ink-50">{board.name}</h1>
            <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300">
              {board.zonesJson.length} zones
            </span>
          </div>
          <div className="flex items-center gap-2">
            {savedTick && <span className="text-[11px] text-emerald-300">Saved.</span>}
            {error && <span className="text-[11px] text-danger-500">{error}</span>}
            <button
              type="button"
              onClick={addZone}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
            >
              + Zone
            </button>
            <button
              type="button"
              onClick={saveZones}
              disabled={busy}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save board"}
            </button>
          </div>
        </header>

        <BoardCanvas
          board={board}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onZonePatch={(id, patch) =>
            patchZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...patch } : z)))
          }
        />
      </main>

      <aside className="overflow-y-auto border-l border-ink-700 bg-ink-900 p-4">
        <Section title="Board">
          <Field label="Name">
            <Input value={board.name} onCommit={(v) => persist({ name: v })} />
          </Field>
          <Field label="Status">
            <select
              value={board.status}
              onChange={(e) => persist({ status: e.target.value })}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
            >
              {["draft", "active", "archived"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Background" hint="Hex color (e.g. #1a1d2a).">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={board.background}
                onChange={(e) => setBoard({ ...board, background: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
              />
              <Input
                value={board.background}
                onCommit={(v) => setBoard({ ...board, background: v })}
              />
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Width">
              <NumberInput
                value={board.width}
                onCommit={(v) => setBoard({ ...board, width: Math.max(64, Math.min(8192, v)) })}
              />
            </Field>
            <Field label="Height">
              <NumberInput
                value={board.height}
                onCommit={(v) => setBoard({ ...board, height: Math.max(64, Math.min(8192, v)) })}
              />
            </Field>
          </div>
        </Section>

        <Section title={selected ? "Zone" : "Zones"}>
          {selected ? (
            <ZoneInspector
              zone={selected}
              onPatch={(patch) =>
                patchZones((zs) => zs.map((z) => (z.id === selected.id ? { ...z, ...patch } : z)))
              }
              onDelete={() => deleteZone(selected.id)}
            />
          ) : (
            <ul className="space-y-1">
              {board.zonesJson.map((z) => (
                <li
                  key={z.id}
                  onClick={() => setSelectedId(z.id)}
                  className="flex cursor-pointer items-center gap-2 rounded border border-ink-800 bg-ink-950/40 px-2 py-1 text-xs hover:border-ink-700 hover:bg-ink-800"
                >
                  <span
                    className="inline-block h-3 w-3 rounded"
                    style={{ background: z.color ?? "#3a4258" }}
                    aria-hidden="true"
                  />
                  <span className="truncate text-ink-100">{z.name}</span>
                  <span className="ml-auto rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] uppercase text-ink-400">
                    {z.kind}
                  </span>
                  <span className="rounded bg-ink-800 px-1 py-0.5 font-mono text-[9px] uppercase text-ink-400">
                    {z.owner}
                  </span>
                </li>
              ))}
              {board.zonesJson.length === 0 && (
                <li className="rounded border border-dashed border-ink-700 px-2 py-3 text-center text-[11px] text-ink-500">
                  No zones — click + Zone in the toolbar.
                </li>
              )}
            </ul>
          )}
        </Section>
      </aside>
    </div>
  );
}

/* ====================================================================== */
/* Canvas                                                                  */
/* ====================================================================== */

function BoardCanvas({
  board,
  selectedId,
  onSelect,
  onZonePatch,
}: {
  board: BoardLayout;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onZonePatch: (id: string, patch: Partial<BoardZone>) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

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

  // Compute the scale that fits the design canvas inside the visible
  // viewport. The board renders at its native pixel dimensions in SVG;
  // this just sets the SVG element's CSS size to land at the right
  // physical size. Drag math converts client px → board px via this
  // scale on each pointer move.
  const scale = useMemo(() => {
    if (box.w === 0 || box.h === 0) return 1;
    return Math.min(box.w / board.width, box.h / board.height);
  }, [box, board.width, board.height]);

  function startDrag(zoneId: string, mode: "move" | "nw" | "ne" | "sw" | "se") {
    return (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.currentTarget as Element;
      target.setPointerCapture?.(e.pointerId);
      const zone = board.zonesJson.find((z) => z.id === zoneId);
      if (!zone) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const start = { ...zone.bounds };

      function onMove(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        let nb = { ...start };
        if (mode === "move") {
          nb.x = clamp(start.x + dx, 0, board.width - start.width);
          nb.y = clamp(start.y + dy, 0, board.height - start.height);
        } else {
          // Resize from a corner — clamp so we don't invert dimensions.
          if (mode === "nw" || mode === "sw") {
            nb.x = clamp(start.x + dx, 0, start.x + start.width - 20);
            nb.width = start.width - (nb.x - start.x);
          }
          if (mode === "ne" || mode === "se") {
            nb.width = clamp(start.width + dx, 20, board.width - start.x);
          }
          if (mode === "nw" || mode === "ne") {
            nb.y = clamp(start.y + dy, 0, start.y + start.height - 20);
            nb.height = start.height - (nb.y - start.y);
          }
          if (mode === "sw" || mode === "se") {
            nb.height = clamp(start.height + dy, 20, board.height - start.y);
          }
        }
        // Round to whole pixels — keeps the saved JSON readable and
        // avoids accumulating floating-point dust over many drags.
        nb = {
          x: Math.round(nb.x),
          y: Math.round(nb.y),
          width: Math.round(nb.width),
          height: Math.round(nb.height),
        };
        onZonePatch(zoneId, { bounds: nb });
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex flex-1 items-center justify-center overflow-hidden p-6"
      onClick={() => onSelect(null)}
    >
      <svg
        viewBox={`0 0 ${board.width} ${board.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: board.width * scale,
          height: board.height * scale,
        }}
        className="rounded-lg border border-ink-700 shadow-2xl"
      >
        <rect x={0} y={0} width={board.width} height={board.height} fill={board.background} />
        {board.zonesJson.map((z) => {
          const sel = z.id === selectedId;
          return (
            <g key={z.id}>
              <rect
                x={z.bounds.x}
                y={z.bounds.y}
                width={z.bounds.width}
                height={z.bounds.height}
                fill={z.color ?? "rgba(212,162,76,0.08)"}
                stroke={sel ? "#d4a24c" : (z.color ?? "rgba(212,162,76,0.6)")}
                strokeWidth={sel ? 4 : 2}
                strokeDasharray={sel ? undefined : "12 8"}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(z.id);
                  startDrag(z.id, "move")(e);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ cursor: "move" }}
              />
              <text
                x={z.bounds.x + 12}
                y={z.bounds.y + 28}
                fill="rgba(255,255,255,0.7)"
                fontSize={Math.max(14, Math.min(28, z.bounds.height * 0.08))}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                pointerEvents="none"
              >
                {z.name}
              </text>
              <text
                x={z.bounds.x + 12}
                y={z.bounds.y + z.bounds.height - 14}
                fill="rgba(255,255,255,0.4)"
                fontSize={12}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                pointerEvents="none"
              >
                {z.kind} · {z.owner} · {z.visibility}
              </text>
              {/* Resize handles — only render when selected. */}
              {sel && (
                <>
                  <ResizeHandle x={z.bounds.x} y={z.bounds.y} cursor="nw-resize" onDown={startDrag(z.id, "nw")} />
                  <ResizeHandle x={z.bounds.x + z.bounds.width} y={z.bounds.y} cursor="ne-resize" onDown={startDrag(z.id, "ne")} />
                  <ResizeHandle x={z.bounds.x} y={z.bounds.y + z.bounds.height} cursor="sw-resize" onDown={startDrag(z.id, "sw")} />
                  <ResizeHandle x={z.bounds.x + z.bounds.width} y={z.bounds.y + z.bounds.height} cursor="se-resize" onDown={startDrag(z.id, "se")} />
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ResizeHandle({
  x,
  y,
  cursor,
  onDown,
}: {
  x: number;
  y: number;
  cursor: string;
  onDown: (e: React.PointerEvent) => void;
}) {
  const size = 12;
  return (
    <rect
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      fill="#d4a24c"
      stroke="#1a1d2a"
      strokeWidth={1}
      style={{ cursor }}
      onPointerDown={onDown}
    />
  );
}

/* ====================================================================== */
/* Zone inspector                                                          */
/* ====================================================================== */

function ZoneInspector({
  zone,
  onPatch,
  onDelete,
}: {
  zone: BoardZone;
  onPatch: (patch: Partial<BoardZone>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input value={zone.name} onCommit={(v) => onPatch({ name: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Kind">
          <select
            value={zone.kind}
            onChange={(e) => onPatch({ kind: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {[
              "deck",
              "hand",
              "discard",
              "exile",
              "battlefield",
              "resource",
              "command",
              "sideboard",
              "shared",
              "token",
              "custom",
            ].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <select
            value={zone.owner}
            onChange={(e) => onPatch({ owner: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["p1", "p2", "shared"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Visibility">
          <select
            value={zone.visibility}
            onChange={(e) => onPatch({ visibility: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["public", "private", "owner_only"].map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stack mode">
          <select
            value={zone.stackMode}
            onChange={(e) => onPatch({ stackMode: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["stacked", "spread", "row", "grid", "fan"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Color" hint="Hex; tints the zone's background.">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={zone.color ?? "#3a4258"}
            onChange={(e) => onPatch({ color: e.target.value })}
            className="h-7 w-10 cursor-pointer rounded border border-ink-700 bg-ink-900"
          />
          <Input value={zone.color ?? ""} onCommit={(v) => onPatch({ color: v || undefined })} />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="X">
          <NumberInput value={zone.bounds.x} onCommit={(v) => onPatch({ bounds: { ...zone.bounds, x: v } })} />
        </Field>
        <Field label="Y">
          <NumberInput value={zone.bounds.y} onCommit={(v) => onPatch({ bounds: { ...zone.bounds, y: v } })} />
        </Field>
        <Field label="W">
          <NumberInput
            value={zone.bounds.width}
            onCommit={(v) => onPatch({ bounds: { ...zone.bounds, width: Math.max(20, v) } })}
          />
        </Field>
        <Field label="H">
          <NumberInput
            value={zone.bounds.height}
            onCommit={(v) => onPatch({ bounds: { ...zone.bounds, height: Math.max(20, v) } })}
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-1.5 text-xs text-danger-500 hover:bg-danger-500/20"
      >
        Delete zone
      </button>
    </div>
  );
}

/* ====================================================================== */
/* Bits                                                                    */
/* ====================================================================== */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 space-y-3 rounded border border-ink-700 bg-ink-900/40 p-3">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-400">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Input({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
    />
  );
}

function NumberInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="number"
      value={draft}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) setDraft(n);
      }}
      onBlur={() => {
        if (draft !== value) onCommit(Math.round(draft));
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
    />
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
