import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import * as api from "@/lib/api";
import type { Card, Deck, DeckCard, Faction } from "@/lib/apiTypes";
import { downloadCockatriceDeck } from "@/lib/exportCockatrice";

/**
 * Decks view (sec 30).
 *
 * Two modes:
 *   • Browse — grid of decks in the project (name, format, status,
 *     card count). Plus a "+ New deck" tile.
 *   • Edit   — open a single deck for header edits + a card list editor
 *     that lets the user search the project's cards and add/remove
 *     entries with quantities. Also offers a Tabletop Simulator export.
 *
 * The edit form's "Cards" panel is the meaty bit: a left search list
 * over the project's cards, a right deck list grouped by sideboard +
 * category, and per-row quantity steppers. Saving the cards bulk-replaces
 * the deck's slot list via PUT /decks/:id/cards.
 */
export function DecksView() {
  const project = useDesigner(selectActiveProject);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    if (!project) {
      setDecks([]);
      setFactions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [d, f] = await Promise.all([
        api.listDecks({ projectId: project.id }),
        api.listFactions({ projectId: project.id }).catch(() => []),
      ]);
      setDecks(d);
      setFactions(f);
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
        <p className="text-sm text-ink-400">Pick a project to manage its decks.</p>
      </div>
    );
  }

  if (editingId) {
    return (
      <DeckEditor
        deckId={editingId}
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
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Decks</h1>
            <p className="mt-1 text-xs text-ink-400">
              {decks.length} deck{decks.length === 1 ? "" : "s"} · pre-built starters and player builds.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25"
          >
            + New deck
          </button>
        </header>

        {error && (
          <div className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        {creating && (
          <NewDeckForm
            projectId={project.id}
            factions={factions}
            onCancel={() => setCreating(false)}
            onCreated={(d) => {
              setDecks((prev) => [...prev, d]);
              setCreating(false);
              setEditingId(d.id);
            }}
          />
        )}

        {loading && decks.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">Loading…</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {decks.map((d) => (
              <li
                key={d.id}
                className="group flex flex-col rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40"
              >
                <button
                  type="button"
                  onClick={() => setEditingId(d.id)}
                  className="flex flex-1 flex-col gap-2 p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium text-ink-50">{d.name}</h3>
                      <p className="font-mono text-[10px] text-ink-500">{d.slug}</p>
                    </div>
                    <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-300">
                      {d.format}
                    </span>
                  </div>
                  {d.description && (
                    <p className="line-clamp-2 text-[11px] leading-snug text-ink-400">
                      {d.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
                    <span>{d.cardCount ?? 0} card slots</span>
                    <span>·</span>
                    <span className="capitalize">{d.status}</span>
                  </div>
                </button>
                <div className="flex border-t border-ink-800">
                  <button
                    type="button"
                    onClick={() => setEditingId(d.id)}
                    className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm(`Delete deck "${d.name}"?`)) return;
                      try {
                        await api.deleteDeck(d.id);
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
            {!loading && decks.length === 0 && (
              <li className="col-span-full rounded border border-dashed border-ink-700 px-3 py-10 text-center text-xs text-ink-500">
                No decks yet — create one to start building card lists.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* New deck form                                                           */
/* ====================================================================== */

function NewDeckForm({
  projectId,
  factions,
  onCreated,
  onCancel,
}: {
  projectId: string;
  factions: Faction[];
  onCreated: (d: Deck) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [format, setFormat] = useState("constructed");
  const [factionId, setFactionId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touchedSlug, setTouchedSlug] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api.createDeck({
        projectId,
        name,
        slug,
        format,
        factionId: factionId || null,
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
      className="mb-4 grid grid-cols-[1fr_180px_140px_180px_auto_auto] items-end gap-2 rounded border border-accent-500/40 bg-accent-500/5 p-3"
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
          placeholder="Crimson Dawn Constructed"
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
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">Format</span>
        <input
          type="text"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          placeholder="constructed / draft / commander"
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] uppercase tracking-wider text-ink-400">Faction</span>
        <select
          value={factionId}
          onChange={(e) => setFactionId(e.target.value)}
          className="mt-0.5 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        >
          <option value="">— Any —</option>
          {factions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
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

/* ====================================================================== */
/* Deck editor                                                             */
/* ====================================================================== */

function DeckEditor({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const project = useDesigner(selectActiveProject);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [slots, setSlots] = useState<Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard" | "category">>>(
    [],
  );
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.getDeck(deckId),
      project ? api.listCards({ projectId: project.id }) : Promise.resolve([] as Card[]),
    ])
      .then(([d, cards]) => {
        if (cancelled) return;
        setDeck(d);
        setAllCards(cards);
        setSlots(
          (d.cards ?? []).map((c) => ({
            cardId: c.cardId,
            quantity: c.quantity,
            sideboard: c.sideboard,
            category: c.category,
          })),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, project]);

  const cardById = useMemo(() => {
    const m = new Map<string, Card>();
    for (const c of allCards) m.set(c.id, c);
    return m;
  }, [allCards]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allCards;
    return allCards.filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q));
  }, [allCards, search]);

  function setSlotQty(cardId: string, sideboard: boolean, qty: number) {
    setSlots((prev) => {
      // Replace, add, or drop the row depending on the new qty.
      const idx = prev.findIndex((s) => s.cardId === cardId && s.sideboard === sideboard);
      if (qty <= 0) {
        if (idx < 0) return prev;
        return prev.filter((_, i) => i !== idx);
      }
      const clamped = Math.min(99, Math.max(1, qty));
      if (idx >= 0) {
        return prev.map((s, i) => (i === idx ? { ...s, quantity: clamped } : s));
      }
      return [...prev, { cardId, quantity: clamped, sideboard, category: "" }];
    });
  }

  function adjustSlot(cardId: string, sideboard: boolean, delta: number) {
    const existing = slots.find((s) => s.cardId === cardId && s.sideboard === sideboard);
    setSlotQty(cardId, sideboard, (existing?.quantity ?? 0) + delta);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.replaceDeckCards(deckId, slots);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchDeck(p: Partial<Deck>) {
    if (!deck) return;
    try {
      const updated = await api.updateDeck(deck.id, p);
      setDeck(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  if (!deck) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-sm text-ink-500">
        {error ?? "Loading deck…"}
      </div>
    );
  }

  const mainSlots = slots.filter((s) => !s.sideboard);
  const sideSlots = slots.filter((s) => s.sideboard);
  const totalMain = mainSlots.reduce((n, s) => n + s.quantity, 0);
  const totalSide = sideSlots.reduce((n, s) => n + s.quantity, 0);

  return (
    <div className="grid grid-cols-[260px_1fr_360px] overflow-hidden">
      {/* Left — search the project's cards */}
      <aside className="flex flex-col overflow-hidden border-r border-ink-700 bg-ink-900">
        <header className="border-b border-ink-700 px-3 py-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-ink-400 hover:text-ink-100"
          >
            ← Back to decks
          </button>
          <h2 className="mt-2 text-sm font-medium text-ink-50">Card library</h2>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="mt-2 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-500"
          />
        </header>
        <ul className="flex-1 overflow-y-auto py-1">
          {filteredCards.map((c) => {
            const mainQty =
              slots.find((s) => s.cardId === c.id && !s.sideboard)?.quantity ?? 0;
            const sideQty =
              slots.find((s) => s.cardId === c.id && s.sideboard)?.quantity ?? 0;
            return (
              <li
                key={c.id}
                className="flex items-center gap-2 px-2 py-1 text-xs text-ink-100 hover:bg-ink-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{c.name}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-500">
                    {c.slug}
                  </span>
                </span>
                <SlotStepper
                  qty={mainQty}
                  onAdjust={(d) => adjustSlot(c.id, false, d)}
                  label="M"
                />
                <SlotStepper
                  qty={sideQty}
                  onAdjust={(d) => adjustSlot(c.id, true, d)}
                  label="S"
                />
              </li>
            );
          })}
          {filteredCards.length === 0 && (
            <li className="px-3 py-6 text-center text-[11px] text-ink-500">
              No cards match.
            </li>
          )}
        </ul>
      </aside>

      {/* Middle — current deck list */}
      <main className="flex flex-col overflow-hidden bg-ink-950">
        <header className="border-b border-ink-700 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-ink-50">{deck.name}</h1>
              <p className="font-mono text-[11px] text-ink-500">{deck.slug}</p>
            </div>
            <div className="text-[11px] text-ink-400">
              Main: <span className="text-ink-100">{totalMain}</span> · Side:{" "}
              <span className="text-ink-100">{totalSide}</span>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <DeckSection
            title="Main deck"
            slots={mainSlots}
            cardById={cardById}
            onAdjust={(cardId, d) => adjustSlot(cardId, false, d)}
            onRemove={(cardId) => setSlotQty(cardId, false, 0)}
          />
          <div className="mt-4">
            <DeckSection
              title="Sideboard"
              slots={sideSlots}
              cardById={cardById}
              onAdjust={(cardId, d) => adjustSlot(cardId, true, d)}
              onRemove={(cardId) => setSlotQty(cardId, true, 0)}
            />
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-3">
          <span className="text-[11px] text-ink-500">
            {error
              ? <span className="text-danger-500">{error}</span>
              : savedTick
              ? "Saved."
              : `${slots.length} unique slot${slots.length === 1 ? "" : "s"}`}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save deck"}
          </button>
        </footer>
      </main>

      {/* Right — header / metadata */}
      <aside className="flex flex-col gap-3 overflow-y-auto border-l border-ink-700 bg-ink-900 p-4">
        <Field label="Name">
          <Input
            value={deck.name}
            onCommit={(v) => patchDeck({ name: v })}
          />
        </Field>
        <Field label="Format">
          <Input
            value={deck.format}
            onCommit={(v) => patchDeck({ format: v })}
          />
        </Field>
        <Field label="Status">
          <select
            value={deck.status}
            onChange={(e) => void patchDeck({ status: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["draft", "testing", "locked", "published", "archived"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Visibility">
          <select
            value={deck.visibility}
            onChange={(e) => void patchDeck({ visibility: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {["private", "tenant_internal", "project_internal", "public"].map((v) => (
              <option key={v} value={v}>
                {v.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description">
          <textarea
            value={deck.description}
            onChange={(e) => setDeck({ ...deck, description: e.target.value })}
            onBlur={() => patchDeck({ description: deck.description })}
            rows={4}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </Field>

        <div className="mt-2 rounded border border-ink-700 bg-ink-950/40 p-3">
          <h3 className="text-[11px] uppercase tracking-wider text-ink-400">Export</h3>
          <p className="mt-1 text-[11px] text-ink-500">
            Generate a Tabletop Simulator JSON saved-object that imports the deck with
            face images served from the public asset endpoint.
          </p>
          <button
            type="button"
            onClick={() =>
              triggerTtsExport(deck, slots, cardById)
            }
            disabled={slots.length === 0}
            className="mt-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Download TTS JSON
          </button>
          <button
            type="button"
            onClick={() => downloadDeckJson(deck, slots, cardById)}
            className="ml-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            disabled={slots.length === 0}
          >
            Plain JSON
          </button>
          <button
            type="button"
            onClick={() => {
              // Build a transient Deck shape with embedded cards so the
              // exporter has a slot list with name lookups already
              // hydrated from `cardById`. We don't mutate the upstream
              // deck record — `cards` here is a derived projection.
              const hydrated: Deck = {
                ...deck,
                cards: slots.map((s) => {
                  const card = cardById.get(s.cardId);
                  return {
                    id: `${deck.id}-${s.cardId}-${s.sideboard ? "side" : "main"}`,
                    deckId: deck.id,
                    cardId: s.cardId,
                    quantity: s.quantity,
                    sideboard: s.sideboard,
                    category: s.category,
                    card: card
                      ? {
                          id: card.id,
                          name: card.name,
                          slug: card.slug,
                          rarity: card.rarity,
                          cardTypeId: card.cardTypeId,
                          setId: card.setId,
                          dataJson: card.dataJson as Record<string, unknown> | null,
                        }
                      : undefined,
                  };
                }),
              };
              void downloadCockatriceDeck({ deck: hydrated });
            }}
            className="ml-2 inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            disabled={slots.length === 0}
            title="Cockatrice .cod deck file — import directly into Cockatrice's deck builder."
          >
            Cockatrice .cod
          </button>
        </div>
      </aside>
    </div>
  );
}

function DeckSection({
  title,
  slots,
  cardById,
  onAdjust,
  onRemove,
}: {
  title: string;
  slots: Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard" | "category">>;
  cardById: Map<string, Card>;
  onAdjust: (cardId: string, delta: number) => void;
  onRemove: (cardId: string) => void;
}) {
  return (
    <section>
      <h3 className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
        {title}{" "}
        <span className="text-ink-500">({slots.reduce((n, s) => n + s.quantity, 0)})</span>
      </h3>
      {slots.length === 0 ? (
        <p className="rounded border border-dashed border-ink-700 px-3 py-3 text-center text-[11px] text-ink-500">
          Empty.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {slots.map((s) => {
            const c = cardById.get(s.cardId);
            return (
              <li
                key={`${s.cardId}-${s.sideboard}`}
                className="flex items-center gap-2 px-3 py-1.5 text-xs"
              >
                <span className="w-8 shrink-0 text-right font-mono tabular-nums text-ink-300">
                  ×{s.quantity}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-100">
                  {c?.name ?? <span className="text-ink-500">(missing card)</span>}
                </span>
                {c?.rarity && (
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-300">
                    {c.rarity}
                  </span>
                )}
                <SlotStepper qty={s.quantity} onAdjust={(d) => onAdjust(s.cardId, d)} />
                <button
                  type="button"
                  onClick={() => onRemove(s.cardId)}
                  className="text-ink-500 hover:text-danger-500"
                  title="Remove"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function SlotStepper({
  qty,
  onAdjust,
  label,
}: {
  qty: number;
  onAdjust: (delta: number) => void;
  label?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-ink-700 bg-ink-900 text-[10px]">
      <button
        type="button"
        onClick={() => onAdjust(-1)}
        disabled={qty === 0}
        className="px-1 text-ink-400 hover:text-ink-100 disabled:opacity-30"
      >
        −
      </button>
      <span className="w-5 text-center font-mono tabular-nums text-ink-200">{qty}</span>
      <button
        type="button"
        onClick={() => onAdjust(1)}
        className="px-1 text-ink-400 hover:text-ink-100"
      >
        +
      </button>
      {label && <span className="border-l border-ink-700 px-1 text-ink-500">{label}</span>}
    </span>
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

function Input({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/* ====================================================================== */
/* Tabletop Simulator export                                                */
/* ====================================================================== */

/**
 * Build a Tabletop Simulator "saved object" JSON for the deck. TTS
 * imports a `Deck` object as a single tabletop entity that can be
 * dragged into a save. The format isn't formally specified by Berserk
 * Games, but the shape below works with TTS's "Saved Objects" load
 * dialog (and matches TTSCardConverter / Frosthaven Reader exports).
 *
 * Each card needs a unique CardID and a cell index into `CustomDeck`.
 * For MVP we point both face and back at a placeholder image — a
 * future iteration can rasterize each card to a pre-built tile via
 * the same pipeline the print sheet uses, then upload as a public
 * asset and reference here.
 */
function buildTtsDeck(
  deck: Deck,
  slots: Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard">>,
  cardById: Map<string, Card>,
): unknown {
  const main = slots.filter((s) => !s.sideboard);
  // Expand quantities — TTS needs one entry per physical card.
  const expanded: Array<{ cardId: string; idx: number }> = [];
  let idx = 0;
  for (const s of main) {
    for (let q = 0; q < s.quantity; q++) {
      expanded.push({ cardId: s.cardId, idx: idx++ });
    }
  }
  return {
    SaveName: deck.name,
    GameMode: "Custom",
    Date: new Date().toISOString(),
    Table: "",
    ObjectStates: [
      {
        Name: "DeckCustom",
        Transform: { posX: 0, posY: 1, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
        Nickname: deck.name,
        Description: deck.description,
        // CardIDs map into `CustomDeck` entries by their thousands digit.
        // A single CustomDeck (id: 1) is fine for an MVP.
        DeckIDs: expanded.map((_, i) => 100 + i),
        CustomDeck: {
          "1": {
            FaceURL: "https://placeholder.tcgstudio.local/card-face.png",
            BackURL: "https://placeholder.tcgstudio.local/card-back.png",
            NumWidth: Math.max(1, Math.ceil(Math.sqrt(expanded.length))),
            NumHeight: Math.max(1, Math.ceil(expanded.length / Math.max(1, Math.ceil(Math.sqrt(expanded.length))))),
            BackIsHidden: true,
            UniqueBack: false,
            Type: 0,
          },
        },
        ContainedObjects: expanded.map((e, i) => {
          const c = cardById.get(e.cardId);
          return {
            Name: "Card",
            Transform: { posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 180, rotZ: 180, scaleX: 1, scaleY: 1, scaleZ: 1 },
            Nickname: c?.name ?? "Unknown",
            Description: typeof c?.dataJson === "object" && c?.dataJson != null && "rules_text" in c.dataJson
              ? String((c.dataJson as Record<string, unknown>).rules_text ?? "")
              : "",
            CardID: 100 + i,
          };
        }),
      },
    ],
  };
}

function triggerTtsExport(
  deck: Deck,
  slots: Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard" | "category">>,
  cardById: Map<string, Card>,
) {
  const obj = buildTtsDeck(deck, slots, cardById);
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${deck.slug}.tts.json`);
}

function downloadDeckJson(
  deck: Deck,
  slots: Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard" | "category">>,
  cardById: Map<string, Card>,
) {
  const obj = {
    deck: {
      id: deck.id,
      name: deck.name,
      slug: deck.slug,
      format: deck.format,
      description: deck.description,
    },
    main: slots
      .filter((s) => !s.sideboard)
      .map((s) => ({ name: cardById.get(s.cardId)?.name, slug: cardById.get(s.cardId)?.slug, quantity: s.quantity })),
    sideboard: slots
      .filter((s) => s.sideboard)
      .map((s) => ({ name: cardById.get(s.cardId)?.name, slug: cardById.get(s.cardId)?.slug, quantity: s.quantity })),
  };
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  triggerDownload(blob, `${deck.slug}.deck.json`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
