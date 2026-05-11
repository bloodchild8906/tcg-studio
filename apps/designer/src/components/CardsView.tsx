import { useEffect, useMemo, useState } from "react";
import {
  selectActiveCardType,
  selectActiveProject,
  useDesigner,
} from "@/store/designerStore";
import * as api from "@/lib/api";
import { assetBlobUrl } from "@/lib/api";
import type { Ability, Card, Faction, Keyword } from "@/lib/apiTypes";
import { CardPreview } from "@/components/CardPreview";
import { CardImporter } from "@/components/CardImporter";
import { PrintSheetModal } from "@/components/PrintSheetModal";
import { useAssetPicker } from "@/components/AssetPicker";
import {
  realtime as rt,
  channels as rtChannels,
} from "@/lib/realtime";
import { useContextMenu } from "@/components/ContextMenu";

/**
 * Cards view.
 *
 * Two modes:
 *   • Browse — grid of card preview tiles + "+ New" tile + Import action.
 *   • Edit   — schema-driven editor for a single card, with a "back to grid"
 *              affordance.
 *
 * The store holds the active card id; when it's set we stay in Edit. Coming
 * back to the view from the dashboard / sidebar always lands in Browse.
 *
 * Mode lives in local state (not the store) because it's a per-view UI
 * concern — switching apps shouldn't strand the user mid-edit, but neither
 * should it persist across reloads.
 */
export function CardsView() {
  const activeCardType = useDesigner(selectActiveCardType);
  const cards = useDesigner((s) => s.cards);
  const activeCardId = useDesigner((s) => s.activeCardId);
  const selectCard = useDesigner((s) => s.selectCard);

  const [mode, setMode] = useState<"browse" | "edit">("browse");
  const [importerOpen, setImporterOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);

  // When the active card changes externally, follow it into edit.
  useEffect(() => {
    if (activeCardId) setMode("edit");
  }, [activeCardId]);

  if (!activeCardType) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">
          Pick a card type from the sidebar / Card Types view to see its cards.
        </p>
      </div>
    );
  }

  if (mode === "edit" && activeCardId) {
    const activeCard = cards.find((c) => c.id === activeCardId) ?? null;
    return (
      <CardEditorPage
        card={activeCard}
        onBack={() => {
          selectCard(null);
          setMode("browse");
        }}
      />
    );
  }

  return (
    <>
      <CardGrid
        onPick={(c) => {
          selectCard(c.id);
          setMode("edit");
        }}
        onImport={() => setImporterOpen(true)}
        onPrintSheet={() => setPrintOpen(true)}
      />
      <CardImporter
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        onDone={() => {
          /* store already refreshed by importer */
        }}
      />
      <PrintSheetModal open={printOpen} onClose={() => setPrintOpen(false)} cards={cards} />
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Browse — grid                                                          */
/* ---------------------------------------------------------------------- */

function CardGrid({
  onPick,
  onImport,
  onPrintSheet,
}: {
  onPick: (card: Card) => void;
  onImport: () => void;
  onPrintSheet: () => void;
}) {
  const activeCardType = useDesigner(selectActiveCardType);
  const cards = useDesigner((s) => s.cards);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => {
      if (c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)) {
        return true;
      }
      const data = c.dataJson ?? {};
      for (const v of Object.values(data)) {
        if (typeof v === "string" && v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [cards, query]);

  return (
    <div className="overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-7xl p-6">
        <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">
              Card type: {activeCardType?.name}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-ink-50">Cards</h1>
            <p className="mt-1 text-xs text-ink-400">
              {cards.length} card{cards.length === 1 ? "" : "s"} · click any tile to edit, or import in bulk.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-8 w-48 rounded border border-ink-700 bg-ink-900 px-2 text-xs text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
            />
            <button
              type="button"
              onClick={onImport}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700"
            >
              <ImportIcon /> Import
            </button>
            <button
              type="button"
              onClick={onPrintSheet}
              disabled={cards.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-ink-700 bg-ink-800 px-3 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            >
              <PrintIcon /> Print sheet
            </button>
          </div>
        </header>

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
          <NewCardTile />
          {filtered.map((card) => (
            <CardTile key={card.id} card={card} onPick={() => onPick(card)} />
          ))}
        </ul>

        {cards.length > 0 && filtered.length === 0 && (
          <p className="mt-6 text-center text-sm text-ink-500">
            No cards match “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}

function CardTile({ card, onPick }: { card: Card; onPick: () => void }) {
  // Resolve the set the card belongs to — looked up from the store rather
  // than fetched per tile so render is cheap.
  const set =
    useDesigner((s) => s.sets.find((ss) => ss.id === card.setId) ?? null);
  const deleteCard = useDesigner((s) => s.deleteCard);

  const ctx = useContextMenu(() => [
    { label: "Open", onSelect: onPick },
    {
      label: "Copy slug",
      onSelect: () => {
        void navigator.clipboard.writeText(card.slug);
      },
    },
    { separator: true },
    {
      label: "Duplicate",
      onSelect: async () => {
        // Cheap dup — same card type, " (copy)" appended to the name
        // and a unique -copy- suffix on the slug. The freshly minted
        // card lands in the local store via setState so the grid
        // updates without a refetch round-trip.
        const created = await api.createCard({
          cardTypeId: card.cardTypeId,
          projectId: card.projectId,
          name: `${card.name} (copy)`,
          slug: `${card.slug}-copy-${Date.now().toString(36).slice(-4)}`,
          dataJson: card.dataJson as Record<string, unknown>,
        });
        useDesigner.setState((s) => ({ cards: [created, ...s.cards] }));
      },
    },
    { separator: true },
    {
      label: "Delete",
      danger: true,
      onSelect: async () => {
        if (!confirm(`Delete "${card.name}"?`)) return;
        await deleteCard(card.id);
      },
    },
  ]);

  return (
    <li onContextMenu={ctx.onContextMenu}>
      <button
        type="button"
        onClick={onPick}
        className="group block w-full text-left transition-transform hover:-translate-y-0.5"
      >
        <CardPreview card={card} set={set} />
        <div className="mt-2 px-1">
          <p className="truncate text-xs font-medium text-ink-100" title={card.name}>
            {card.name}
          </p>
          <p className="truncate font-mono text-[10px] text-ink-500" title={card.slug}>
            {card.slug}
          </p>
        </div>
      </button>
      {ctx.element}
    </li>
  );
}

function NewCardTile() {
  const activeCardType = useDesigner(selectActiveCardType);
  const createCardFromPreview = useDesigner((s) => s.createCardFromPreview);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  function autoSlug(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCardType || !name.trim()) return;
    setBusy(true);
    try {
      await createCardFromPreview({
        name: name.trim(),
        slug: autoSlug(name) || "card",
      });
      setName("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!activeCardType}
          className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusIcon />
          <span className="text-xs font-medium">New card</span>
          <span className="text-[10px] text-ink-500">Empty data — edit after</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <form
        onSubmit={submit}
        className="flex aspect-[5/7] w-full flex-col gap-2 rounded-lg border-2 border-dashed border-accent-500/60 bg-accent-500/5 p-3"
      >
        <p className="text-[10px] uppercase tracking-wider text-accent-300">New card</p>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Card name"
          autoFocus
          className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
        />
        <p className="text-[10px] text-ink-500">
          Slug auto-generated. Schema fields filled in the editor.
        </p>
        <div className="mt-auto flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-300 hover:bg-ink-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="flex-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "…" : "Create"}
          </button>
        </div>
      </form>
    </li>
  );
}

/* ---------------------------------------------------------------------- */
/* Edit page                                                              */
/* ---------------------------------------------------------------------- */

function CardEditorPage({
  card,
  onBack,
}: {
  card: Card | null;
  onBack: () => void;
}) {
  const activeCardType = useDesigner(selectActiveCardType);
  const deleteCard = useDesigner((s) => s.deleteCard);
  // Resolve the card's set so the preview pane shows the same badge the
  // grid does.
  const cardSet = useDesigner((s) =>
    card ? s.sets.find((ss) => ss.id === card.setId) ?? null : null,
  );

  const [historyOpen, setHistoryOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  if (!card || !activeCardType) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950">
        <p className="text-sm text-ink-400">Card not found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-3xl p-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100"
        >
          ← Back to grid
        </button>

        <div className="grid grid-cols-[200px_1fr] gap-6">
          <aside className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-ink-700">
              <CardPreview card={card} set={cardSet} />
            </div>
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              title="Comments + approval workflow"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              Review…
            </button>
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              title="View saved revisions for this card"
              className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
            >
              History…
            </button>
            <button
              type="button"
              onClick={async () => {
                if (confirm(`Delete "${card.name}"?`)) {
                  await deleteCard(card.id);
                  onBack();
                }
              }}
              className="w-full rounded border border-transparent px-2 py-1 text-xs text-ink-400 hover:border-danger-500/40 hover:bg-danger-500/10 hover:text-danger-500"
            >
              Delete card
            </button>
          </aside>

          <main>
            <header className="mb-4">
              <h1 className="text-lg font-semibold text-ink-50">{card.name}</h1>
              <p className="font-mono text-[11px] text-ink-500">{card.slug}</p>
            </header>
            <CardEditorForm card={card} schemaJson={activeCardType.schemaJson} />
          </main>
        </div>
      </div>
      {historyOpen && (
        <CardHistoryDrawer card={card} onClose={() => setHistoryOpen(false)} />
      )}
      {reviewOpen && (
        <CardReviewDrawer card={card} onClose={() => setReviewOpen(false)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* History drawer (sec 46)                                                */
/* ---------------------------------------------------------------------- */
//
// Lists the auto-snapshots written by the cards PATCH route. The
// editor opens this on demand — we never preload it, since most edits
// don't need the timeline.
//
// Two affordances:
//   • Click a row → preview that snapshot in the right pane (read-only).
//   • Restore button → POST .../restore. The backend snapshots the
//     current state first so the restore itself is undoable.

function CardHistoryDrawer({
  card,
  onClose,
}: {
  card: Card;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<api.CardVersion[] | null>(null);
  const [active, setActive] = useState<api.CardVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const selectCard = useDesigner((s) => s.selectCard);

  async function load() {
    setErr(null);
    try {
      const list = await api.listCardVersions(card.id);
      setVersions(list);
      setActive(list[0] ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  async function restore(version: api.CardVersion) {
    if (
      !confirm(
        `Restore "${card.name}" to version ${version.versionNum}? Current state will be saved first.`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.restoreCardVersion(card.id, version.id);
      // Patch the local card list so the rest of the UI sees the
      // restored values immediately. We don't need the full project
      // reload — just the one card row.
      useDesigner.setState((s) => ({
        cards: s.cards.map((c) => (c.id === updated.id ? updated : c)),
      }));
      selectCard(card.id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[920px] max-w-full flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-ink-100">
              History — {card.name}
            </h2>
            <p className="text-[11px] text-ink-500">
              Auto-snapshots written before every save. Pick one to preview;
              restore makes it the live version.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
          >
            Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-[280px_1fr] overflow-hidden">
          <aside className="overflow-y-auto border-r border-ink-800 bg-ink-950 p-2 text-xs">
            {!versions ? (
              <p className="px-2 py-3 text-ink-500">Loading…</p>
            ) : versions.length === 0 ? (
              <p className="px-2 py-3 text-ink-500">
                No snapshots yet — make an edit to create the first one.
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => {
                  const isActive = active?.id === v.id;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setActive(v)}
                        className={[
                          "w-full rounded border px-2 py-1.5 text-left",
                          isActive
                            ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
                            : "border-ink-800 bg-ink-900 text-ink-200 hover:bg-ink-800",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[11px]">
                            v{v.versionNum}
                          </span>
                          <span className="text-[10px] text-ink-500">
                            {new Date(v.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-ink-300">
                          {v.name}
                        </div>
                        {v.note && (
                          <div className="text-[10px] text-ink-500">
                            {v.note}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
          <main className="overflow-y-auto p-4 text-xs text-ink-300">
            {!active ? (
              <p className="text-ink-500">
                Pick a version on the left to preview.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-ink-100">
                    Version {active.versionNum} · {active.name}
                  </h3>
                  <button
                    type="button"
                    onClick={() => restore(active)}
                    disabled={busy}
                    className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
                  >
                    {busy ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
                <dl className="grid grid-cols-2 gap-2 rounded border border-ink-800 bg-ink-950 p-2 text-[11px]">
                  <Row label="Slug" value={active.slug} />
                  <Row label="Status" value={active.status} />
                  <Row label="Rarity" value={active.rarity ?? "—"} />
                  <Row
                    label="Collector #"
                    value={
                      active.collectorNumber !== null
                        ? String(active.collectorNumber)
                        : "—"
                    }
                  />
                  <Row label="Card type" value={active.cardTypeId} />
                  <Row label="Set" value={active.setId ?? "—"} />
                </dl>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
                    Data snapshot
                  </p>
                  <pre className="max-h-[40vh] overflow-auto rounded border border-ink-800 bg-ink-950 p-2 font-mono text-[10px] leading-relaxed text-ink-300">
                    {JSON.stringify(active.dataJson, null, 2)}
                  </pre>
                </div>
              </div>
            )}
            {err && (
              <p className="mt-3 text-[11px] text-danger-400">{err}</p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </dt>
      <dd className="font-mono text-ink-200">{value}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Review drawer — comments + approval workflow (sec 18.4)                */
/* ---------------------------------------------------------------------- */
//
// One-stop shop for review on a card:
//
//   • Timeline of comments (chronological, newest at the bottom).
//   • Approval / change-request markers render inline as colored
//     pills — they live in the same table as comments, so the
//     timeline is one narrative.
//   • Reply, resolve, edit, delete on each comment as the author or
//     a tenant admin.
//   • Approve / Request changes buttons that flip the card status
//     and write a marker comment in one round-trip.
//
// Subscribed via the realtime bus (sec 37). The hub fans out
// `card.comment.created`, `card.approved`, and
// `card.changes_requested` events on the per-card channel; we
// trigger a refresh on every event so reviewers see each other's
// notes within ~50ms.

function CardReviewDrawer({
  card,
  onClose,
}: {
  card: Card;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<api.CardComment[] | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<api.CardComment | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [approveOpen, setApproveOpen] = useState<
    "approve" | "request_changes" | null
  >(null);
  const [approvalNote, setApprovalNote] = useState("");
  const currentUser = useDesigner((s) => s.currentUser);

  async function refresh() {
    try {
      const list = await api.listCardComments(card.id);
      setComments(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  // Initial load + realtime subscription on the per-card channel.
  // The unsubscribe drops the WS reference when the drawer closes,
  // so background tabs don't keep streaming.
  useEffect(() => {
    void refresh();
    const tenant = useDesigner.getState().tenants.find(
      (t) => t.slug === useDesigner.getState().activeTenantSlug,
    );
    if (!tenant) return;
    const off = rt.subscribe(rtChannels.card(tenant.id, card.id), () => {
      void refresh();
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createCardComment(card.id, {
        body: trimmed,
        parentId: replyTo?.id ?? null,
      });
      setBody("");
      setReplyTo(null);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(c: api.CardComment) {
    try {
      await api.resolveCardComment(card.id, c.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function unresolve(c: api.CardComment) {
    try {
      await api.unresolveCardComment(card.id, c.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function destroy(c: api.CardComment) {
    if (!confirm("Delete this comment?")) return;
    try {
      await api.deleteCardComment(card.id, c.id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function runApproval(kind: "approve" | "request_changes") {
    setBusy(true);
    setErr(null);
    try {
      const note = approvalNote.trim() || undefined;
      const r =
        kind === "approve"
          ? await api.approveCard(card.id, note)
          : await api.requestCardChanges(card.id, note);
      // Patch the local card in the store so the editor reflects the
      // new status immediately without a project reload.
      useDesigner.setState((s) => ({
        cards: s.cards.map((c) => (c.id === r.card.id ? r.card : c)),
      }));
      setApproveOpen(null);
      setApprovalNote("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Group comments into roots + reply lists for one-level threading.
  const visible = (comments ?? []).filter(
    (c) => showResolved || !c.resolvedAt,
  );
  const roots = visible.filter((c) => !c.parentId);
  const childrenByParent = new Map<string, api.CardComment[]>();
  for (const c of visible) {
    if (!c.parentId) continue;
    const arr = childrenByParent.get(c.parentId) ?? [];
    arr.push(c);
    childrenByParent.set(c.parentId, arr);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-end bg-black/60 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-[min(620px,95vw)] flex-col overflow-hidden border-l border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-ink-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-ink-100">
              Review — {card.name}
            </h2>
            <p className="text-[11px] text-ink-500">
              Status: <code className="text-ink-300">{card.status}</code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-ink-300 hover:bg-ink-700"
          >
            Close
          </button>
        </header>

        <section className="flex items-center gap-2 border-b border-ink-800 bg-ink-950 px-4 py-2">
          <button
            type="button"
            onClick={() => setApproveOpen("approve")}
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => setApproveOpen("request_changes")}
            className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/20"
          >
            Request changes
          </button>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-ink-400">
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
              className="h-3 w-3"
            />
            Show resolved
          </label>
        </section>

        <main className="flex-1 overflow-y-auto px-4 py-3 text-xs text-ink-300">
          {!comments ? (
            <p className="text-ink-500">Loading…</p>
          ) : roots.length === 0 ? (
            <p className="text-ink-500">
              No comments yet. Start a thread or use the approval buttons above.
            </p>
          ) : (
            <ul className="space-y-3">
              {roots.map((root) => (
                <li key={root.id} className="space-y-1.5">
                  <CommentRow
                    comment={root}
                    isAuthor={currentUser?.id === root.userId}
                    onReply={() => setReplyTo(root)}
                    onResolve={() => resolve(root)}
                    onUnresolve={() => unresolve(root)}
                    onDelete={() => destroy(root)}
                  />
                  {(childrenByParent.get(root.id) ?? []).map((reply) => (
                    <div key={reply.id} className="ml-4 border-l border-ink-800 pl-3">
                      <CommentRow
                        comment={reply}
                        isAuthor={currentUser?.id === reply.userId}
                        onReply={() => setReplyTo(root)}
                        onResolve={() => resolve(reply)}
                        onUnresolve={() => unresolve(reply)}
                        onDelete={() => destroy(reply)}
                      />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {err && <p className="mt-3 text-[11px] text-danger-400">{err}</p>}
        </main>

        <footer className="border-t border-ink-800 bg-ink-950 px-4 py-3">
          {replyTo && (
            <p className="mb-1 flex items-center justify-between text-[11px] text-ink-500">
              <span>
                Replying to{" "}
                <span className="text-ink-300">{replyTo.body.slice(0, 60)}</span>
                {replyTo.body.length > 60 && "…"}
              </span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-[10px] uppercase tracking-wider text-ink-500 hover:text-ink-300"
              >
                Cancel reply
              </button>
            </p>
          )}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
            className="w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
          />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[10px] text-ink-500">
              Cmd+Enter to send. Comments are visible to your tenant only.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={busy || !body.trim()}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
            >
              {busy ? "Sending…" : replyTo ? "Reply" : "Comment"}
            </button>
          </div>
        </footer>
      </div>

      {approveOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setApproveOpen(null);
          }}
        >
          <div className="w-[420px] max-w-full overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
            <header className="border-b border-ink-800 px-4 py-3">
              <h3 className="text-sm font-medium text-ink-100">
                {approveOpen === "approve" ? "Approve card" : "Request changes"}
              </h3>
              <p className="text-[11px] text-ink-500">
                {approveOpen === "approve"
                  ? "Marks the card as approved and pings prior reviewers."
                  : "Sends the card back to needs-review with your feedback."}
              </p>
            </header>
            <div className="p-4">
              <textarea
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder={
                  approveOpen === "approve"
                    ? "Optional note (e.g. balance check passed)"
                    : "What needs to change?"
                }
                rows={4}
                className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-xs text-ink-100"
              />
              {err && (
                <p className="mt-2 text-[11px] text-danger-400">{err}</p>
              )}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-ink-800 px-4 py-3">
              <button
                type="button"
                onClick={() => setApproveOpen(null)}
                className="rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-300 hover:bg-ink-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runApproval(approveOpen)}
                disabled={busy}
                className={[
                  "rounded border px-3 py-1 text-xs font-medium disabled:opacity-50",
                  approveOpen === "approve"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                    : "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
                ].join(" ")}
              >
                {busy
                  ? "Saving…"
                  : approveOpen === "approve"
                    ? "Approve"
                    : "Request changes"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentRow({
  comment,
  isAuthor,
  onReply,
  onResolve,
  onUnresolve,
  onDelete,
}: {
  comment: api.CardComment;
  isAuthor: boolean;
  onReply: () => void;
  onResolve: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isMarker = comment.kind !== "comment";
  const tone =
    comment.kind === "approval"
      ? "border-emerald-500/40 bg-emerald-500/5"
      : comment.kind === "change_request"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-ink-800 bg-ink-950";

  return (
    <div
      className={[
        "rounded border px-3 py-2",
        comment.resolvedAt ? "opacity-60" : "",
        tone,
      ].join(" ")}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] text-ink-500">
        <span className="flex items-center gap-2">
          {isMarker && <KindPill kind={comment.kind} />}
          <span className="font-mono text-ink-400">
            {comment.userId.slice(0, 8)}
          </span>
          <span>{new Date(comment.createdAt).toLocaleString()}</span>
          {comment.resolvedAt && (
            <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
              resolved
            </span>
          )}
        </span>
        <span className="flex gap-2 text-[10px]">
          <button
            type="button"
            onClick={onReply}
            className="text-ink-500 hover:text-ink-200"
          >
            Reply
          </button>
          {comment.resolvedAt ? (
            <button
              type="button"
              onClick={onUnresolve}
              className="text-ink-500 hover:text-ink-200"
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={onResolve}
              className="text-ink-500 hover:text-ink-200"
            >
              Resolve
            </button>
          )}
          {isAuthor && (
            <button
              type="button"
              onClick={onDelete}
              className="text-danger-400 hover:text-danger-300"
            >
              Delete
            </button>
          )}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-xs text-ink-200">{comment.body}</p>
    </div>
  );
}

function KindPill({ kind }: { kind: api.CardCommentKind }) {
  if (kind === "comment") return null;
  const palette =
    kind === "approval"
      ? "bg-emerald-500/20 text-emerald-300"
      : "bg-amber-500/20 text-amber-300";
  const label = kind === "approval" ? "approved" : "changes";
  return (
    <span
      className={`rounded px-1.5 py-px text-[9px] uppercase tracking-wider ${palette}`}
    >
      {label}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Schema-driven form                                                     */
/* ---------------------------------------------------------------------- */

interface SchemaField {
  key: string;
  type: string;
  required?: boolean;
  min?: number;
  max?: number;
}

function parseSchema(json: unknown): { fields: SchemaField[] } {
  if (typeof json !== "object" || json === null) return { fields: [] };
  const fieldsRaw = (json as { fields?: unknown }).fields;
  if (!Array.isArray(fieldsRaw)) return { fields: [] };
  const fields: SchemaField[] = [];
  for (const f of fieldsRaw) {
    if (typeof f === "object" && f && typeof (f as { key?: unknown }).key === "string") {
      const obj = f as { key: string; type?: unknown; required?: unknown; min?: unknown; max?: unknown };
      fields.push({
        key: obj.key,
        type: typeof obj.type === "string" ? obj.type : "text",
        required: typeof obj.required === "boolean" ? obj.required : false,
        min: typeof obj.min === "number" ? obj.min : undefined,
        max: typeof obj.max === "number" ? obj.max : undefined,
      });
    }
  }
  return { fields };
}

interface FormState {
  name: string;
  slug: string;
  status: string;
  rarity: string;
  collectorNumber: string;
  /** Empty string means "no set"; a real id means assigned to that set. */
  setId: string;
  data: Record<string, unknown>;
}

function buildFormState(card: Card): FormState {
  return {
    name: card.name,
    slug: card.slug,
    status: card.status,
    rarity: card.rarity ?? "",
    collectorNumber:
      card.collectorNumber === null || card.collectorNumber === undefined
        ? ""
        : String(card.collectorNumber),
    setId: card.setId ?? "",
    data: { ...(card.dataJson ?? {}) },
  };
}

function CardEditorForm({ card, schemaJson }: { card: Card; schemaJson: unknown }) {
  const schema = useMemo(() => parseSchema(schemaJson), [schemaJson]);
  const sets = useDesigner((s) => s.sets);
  const [form, setForm] = useState<FormState>(() => buildFormState(card));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(buildFormState(card));
    setSaveState("idle");
  }, [card]);

  const dirty = JSON.stringify(buildFormState(card)) !== JSON.stringify(form);

  function setData(key: string, value: unknown) {
    setForm((f) => ({ ...f, data: { ...f.data, [key]: value } }));
  }

  async function save() {
    setSaveState("saving");
    setError(null);
    try {
      const coerced: Record<string, unknown> = { ...form.data };
      for (const f of schema.fields) {
        if (f.type === "number" && typeof coerced[f.key] === "string") {
          const v = (coerced[f.key] as string).trim();
          coerced[f.key] = v === "" ? undefined : Number(v);
        }
      }
      const updated = await api.updateCardData(card.id, {
        name: form.name,
        slug: form.slug,
        dataJson: coerced,
        status: form.status,
        rarity: form.rarity ? form.rarity : null,
        collectorNumber: form.collectorNumber === "" ? null : Number(form.collectorNumber),
        setId: form.setId ? form.setId : null,
      });
      useDesigner.setState((s) => ({
        cards: s.cards.map((c) => (c.id === updated.id ? updated : c)),
      }));
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1200);
    } catch (err) {
      setSaveState("error");
      setError(err instanceof Error ? err.message : "save failed");
    }
  }

  const knownKeys = new Set(schema.fields.map((f) => f.key));
  const extraEntries = Object.entries(form.data).filter(([k]) => !knownKeys.has(k));

  return (
    <div className="space-y-6">
      <Section title="Identity">
        <FieldRow label="Name">
          <Input value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
        </FieldRow>
        <FieldRow label="Slug">
          <Input
            value={form.slug}
            mono
            onChange={(v) =>
              setForm((f) => ({ ...f, slug: v.toLowerCase().replace(/[^a-z0-9-]+/g, "-") }))
            }
          />
        </FieldRow>
        <FieldRow label="Rarity">
          <Input
            value={form.rarity}
            onChange={(v) => setForm((f) => ({ ...f, rarity: v }))}
            placeholder="Common, Uncommon, Rare, Mythic…"
          />
        </FieldRow>
        <FieldRow label="Collector #">
          <Input
            value={form.collectorNumber}
            onChange={(v) => setForm((f) => ({ ...f, collectorNumber: v.replace(/[^0-9]/g, "") }))}
            placeholder="optional"
          />
        </FieldRow>
        <FieldRow label="Status">
          <SelectInput
            value={form.status}
            options={[
              "idea",
              "draft",
              "needs_review",
              "rules_review",
              "art_needed",
              "art_complete",
              "balance_testing",
              "approved",
              "released",
              "deprecated",
              "banned",
              "archived",
            ]}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
          />
        </FieldRow>
        <FieldRow label="Set" hint="Group the card into a release.">
          <select
            value={form.setId}
            onChange={(e) => setForm((f) => ({ ...f, setId: e.target.value }))}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          >
            <option value="">— None —</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </FieldRow>
      </Section>

      <Section title="Card data">
        {schema.fields.length === 0 ? (
          <p className="text-[11px] text-ink-500">
            This card type has no schema fields. Add some via the API to get a structured form.
          </p>
        ) : (
          schema.fields.map((field) => (
            <FieldRow
              key={field.key}
              label={`${field.key}${field.required ? " *" : ""}`}
              hint={`type: ${field.type}`}
            >
              <SchemaInput
                field={field}
                value={form.data[field.key]}
                onChange={(v) => setData(field.key, v)}
              />
            </FieldRow>
          ))
        )}

        {extraEntries.length > 0 && (
          <div className="mt-4 border-t border-ink-800 pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-500">
              Extra fields (not in schema)
            </p>
            {extraEntries.map(([key, value]) => (
              <FieldRow key={key} label={key}>
                <Input value={String(value ?? "")} onChange={(v) => setData(key, v)} />
              </FieldRow>
            ))}
          </div>
        )}
      </Section>

      <div className="sticky bottom-0 -mx-6 flex items-center justify-between border-t border-ink-800 bg-ink-950/90 px-6 py-3 backdrop-blur">
        <span className="text-[11px] text-ink-500">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
            ? "Saved."
            : saveState === "error"
            ? `Error: ${error ?? "unknown"}`
            : dirty
            ? "Unsaved changes"
            : "Up to date"}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saveState === "saving"}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function SchemaInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  // Promote certain text-typed fields to richer pickers based on their
  // semantic key. This keeps existing schemas backwards-compatible (no
  // migration needed) while letting card editors get a real UI for
  // faction / keyword / ability selection.
  const semanticType = (() => {
    if (field.type === "abilities") return "abilityChips";
    if (field.type === "text") {
      if (field.key === "abilities") return "abilityChips";
      if (field.key === "faction") return "faction";
      if (field.key === "factions") return "factionMulti";
      if (field.key === "keywords") return "keywordMulti";
    }
    return field.type;
  })();

  switch (semanticType) {
    case "faction":
      return <FactionPicker value={value} onChange={onChange} />;
    case "factionMulti":
      return <FactionPicker value={value} onChange={onChange} multi />;
    case "keywordMulti":
      return <KeywordChips value={value} onChange={onChange} />;
    case "abilityChips":
      return <AbilityChips value={value} onChange={onChange} />;
    case "longText":
    case "richText":
      return (
        <textarea
          value={String(value ?? "")}
          rows={field.type === "richText" ? 5 : 3}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
        />
      );
    case "number":
      return (
        <Input
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(v) => onChange(v.replace(/[^0-9.\-]/g, ""))}
          placeholder={
            field.min !== undefined || field.max !== undefined
              ? `${field.min ?? "−∞"}..${field.max ?? "∞"}`
              : "number"
          }
        />
      );
    case "boolean":
      return (
        <label className="inline-flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-accent-500"
          />
          <span>{Boolean(value) ? "true" : "false"}</span>
        </label>
      );
    case "stat":
      return <Input value={String(value ?? "")} onChange={(v) => onChange(v)} placeholder="e.g. 3 / 4" />;
    case "image":
      return <ImageFieldInput value={value} onChange={onChange} />;
    default:
      return <Input value={String(value ?? "")} onChange={(v) => onChange(v)} />;
  }
}

/**
 * Image-typed schema field. Drives card art: the user picks an asset from
 * the project's library; the value stored in `dataJson[field.key]` is the
 * asset id. CardRender resolves it to a blob URL at preview time.
 */
function ImageFieldInput({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  // Reuse the AssetPicker — already project-scoped, supports inline upload.
  const picker = useAssetPicker((asset) => onChange(asset.id));
  const stored = typeof value === "string" ? value : null;
  const isUrl = stored ? /^(https?:|data:|blob:|\/)/.test(stored) : false;
  const previewUrl = stored ? (isUrl ? stored : assetBlobUrl(stored)) : null;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:8px_8px]">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-ink-600">empty</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {stored ? (
          <p className="truncate font-mono text-[10px] text-ink-400" title={stored}>
            {stored}
          </p>
        ) : (
          <p className="text-[11px] text-ink-500">No image bound.</p>
        )}
      </div>
      <button
        type="button"
        onClick={picker.open}
        className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        {stored ? "Change…" : "Pick…"}
      </button>
      {stored && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded border border-transparent px-1.5 py-1 text-[11px] text-ink-400 hover:border-ink-700 hover:bg-ink-800"
          title="Clear"
        >
          ×
        </button>
      )}
      {picker.element}
    </div>
  );
}

/**
 * Faction picker — populates the dropdown from the project's factions.
 * Falls back to a free-form text input when no factions are defined yet,
 * so the form keeps working in projects that haven't started using the
 * faction system. The single-select form stores `slug`; the multi form
 * stores an array of slugs.
 *
 * Uses a ref-counted in-memory cache keyed by projectId so a card
 * editor with multiple faction fields doesn't trigger one fetch per
 * field. The cache is flushed when the project changes.
 */
function FactionPicker({
  value,
  onChange,
  multi = false,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  multi?: boolean;
}) {
  const factions = useFactionsCache();

  if (factions === null) {
    return <Input value="" onChange={() => {}} placeholder="Loading…" />;
  }

  if (factions.length === 0) {
    // No factions defined — fall back to text so the user still has a way
    // to enter the value while seeding the system.
    return (
      <Input
        value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
        onChange={(v) => onChange(multi ? v.split(",").map((s) => s.trim()).filter(Boolean) : v)}
        placeholder="No factions defined yet — type to set"
      />
    );
  }

  if (multi) {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {factions.map((f) => {
            const selected = arr.includes(f.slug);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  const next = selected
                    ? arr.filter((x) => x !== f.slug)
                    : [...arr, f.slug];
                  onChange(next);
                }}
                className={[
                  "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px]",
                  selected
                    ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                    : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
                ].join(" ")}
              >
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ background: f.color }}
                  aria-hidden="true"
                />
                {f.name}
              </button>
            );
          })}
        </div>
        {arr.length > 0 && (
          <p className="font-mono text-[10px] text-ink-500">{arr.join(", ")}</p>
        )}
      </div>
    );
  }

  const stored = typeof value === "string" ? value : "";
  const matched = factions.find((f) => f.slug === stored);
  return (
    <div className="flex items-center gap-2">
      {matched && (
        <span
          className="inline-block h-3 w-3 shrink-0 rounded"
          style={{ background: matched.color }}
          aria-hidden="true"
        />
      )}
      <select
        value={stored}
        onChange={(e) => onChange(e.target.value || null)}
        className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
      >
        <option value="">— None —</option>
        {factions.map((f) => (
          <option key={f.id} value={f.slug}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Keyword chips — multi-select over the project's keywords. Stores an
 * array of slugs. Same fallback as `FactionPicker` when nothing's defined.
 */
function KeywordChips({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const keywords = useKeywordsCache();
  const arr = Array.isArray(value) ? (value as string[]) : [];

  if (keywords === null) {
    return <Input value="" onChange={() => {}} placeholder="Loading…" />;
  }
  if (keywords.length === 0) {
    return (
      <Input
        value={arr.join(", ")}
        onChange={(v) => onChange(v.split(",").map((s) => s.trim()).filter(Boolean))}
        placeholder="No keywords defined yet — type comma-separated"
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {keywords.map((k) => {
          const selected = arr.includes(k.slug);
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                const next = selected ? arr.filter((x) => x !== k.slug) : [...arr, k.slug];
                onChange(next);
              }}
              className={[
                "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                selected
                  ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                  : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
              ].join(" ")}
              title={k.reminderText || k.rulesDefinition}
            >
              {k.color && (
                <span
                  className="inline-block h-2 w-2 rounded"
                  style={{ background: k.color }}
                  aria-hidden="true"
                />
              )}
              {k.name}
            </button>
          );
        })}
      </div>
      {arr.length > 0 && (
        <p className="font-mono text-[10px] text-ink-500">{arr.join(", ")}</p>
      )}
    </div>
  );
}

// In-memory caches, project-scoped. Pure module state — fine because the
// designer is single-tenant per session, and the cache is invalidated on
// project change automatically by reading projectId from the store.
const _factionCache: { projectId: string | null; data: Faction[] | null } = {
  projectId: null,
  data: null,
};
const _keywordCache: { projectId: string | null; data: Keyword[] | null } = {
  projectId: null,
  data: null,
};

function useFactionsCache(): Faction[] | null {
  const project = useDesigner(selectActiveProject);
  const [data, setData] = useState<Faction[] | null>(null);
  useEffect(() => {
    if (!project) {
      setData([]);
      return;
    }
    if (_factionCache.projectId === project.id && _factionCache.data) {
      setData(_factionCache.data);
      return;
    }
    let cancelled = false;
    void api.listFactions({ projectId: project.id }).then((rows) => {
      if (cancelled) return;
      _factionCache.projectId = project.id;
      _factionCache.data = rows;
      setData(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);
  return data;
}

function useKeywordsCache(): Keyword[] | null {
  const project = useDesigner(selectActiveProject);
  const [data, setData] = useState<Keyword[] | null>(null);
  useEffect(() => {
    if (!project) {
      setData([]);
      return;
    }
    if (_keywordCache.projectId === project.id && _keywordCache.data) {
      setData(_keywordCache.data);
      return;
    }
    let cancelled = false;
    void api.listKeywords({ projectId: project.id }).then((rows) => {
      if (cancelled) return;
      _keywordCache.projectId = project.id;
      _keywordCache.data = rows;
      setData(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);
  return data;
}

const _abilityCache: { projectId: string | null; data: Ability[] | null } = {
  projectId: null,
  data: null,
};

function useAbilitiesCache(): Ability[] | null {
  const project = useDesigner(selectActiveProject);
  const [data, setData] = useState<Ability[] | null>(null);
  useEffect(() => {
    if (!project) {
      setData([]);
      return;
    }
    if (_abilityCache.projectId === project.id && _abilityCache.data) {
      setData(_abilityCache.data);
      return;
    }
    let cancelled = false;
    void api.listAbilities({ projectId: project.id }).then((rows) => {
      if (cancelled) return;
      _abilityCache.projectId = project.id;
      _abilityCache.data = rows;
      setData(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [project]);
  return data;
}

/**
 * Ability chips — multi-select over the project's abilities. Stores an
 * array of ability ids on `dataJson.abilities`. Each chip shows the
 * ability name with a kind-colored dot; hovering surfaces the rules
 * text so the author can pick by content rather than by name alone.
 *
 * Falls back to comma-separated text when no abilities are defined yet —
 * the same pattern as KeywordChips, so a fresh project still functions.
 */
function AbilityChips({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const abilities = useAbilitiesCache();
  const arr = Array.isArray(value) ? (value as string[]) : [];

  if (abilities === null) {
    return <Input value="" onChange={() => {}} placeholder="Loading…" />;
  }
  if (abilities.length === 0) {
    return (
      <Input
        value={arr.join(", ")}
        onChange={(v) =>
          onChange(v.split(",").map((s) => s.trim()).filter(Boolean))
        }
        placeholder="No abilities defined yet — type comma-separated ids"
      />
    );
  }

  // Group by kind so the picker reads as a structured catalog rather
  // than a flat dump. Within each kind we keep the API's sort order.
  const byKind = new Map<string, Ability[]>();
  for (const a of abilities) {
    const arr2 = byKind.get(a.kind);
    if (arr2) arr2.push(a);
    else byKind.set(a.kind, [a]);
  }

  // Color per kind — small visual signal so authors can tell a
  // triggered ability from an activated one at a glance.
  const kindColor: Record<string, string> = {
    static: "#7a7f95",
    triggered: "#d4a24c",
    activated: "#7a4ed1",
    replacement: "#4ed1a2",
    prevention: "#4e8ed1",
    resource: "#d14e7a",
    combat: "#b34a40",
  };

  return (
    <div className="space-y-1.5">
      {Array.from(byKind.entries()).map(([kind, list]) => (
        <div key={kind}>
          <p className="mb-0.5 text-[9px] uppercase tracking-wider text-ink-500">{kind}</p>
          <div className="flex flex-wrap gap-1">
            {list.map((a) => {
              const selected = arr.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    const next = selected ? arr.filter((x) => x !== a.id) : [...arr, a.id];
                    onChange(next);
                  }}
                  title={a.text || a.reminderText || a.name}
                  className={[
                    "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                    selected
                      ? "border-accent-500/60 bg-accent-500/15 text-accent-200"
                      : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
                  ].join(" ")}
                >
                  <span
                    className="inline-block h-2 w-2 rounded"
                    style={{ background: kindColor[a.kind] ?? "#888" }}
                    aria-hidden="true"
                  />
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {arr.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded border border-ink-800 bg-ink-950/40 p-2 text-[11px] text-ink-300">
          {arr.map((id) => {
            const a = abilities.find((x) => x.id === id);
            if (!a) return null;
            return (
              <li key={id} className="flex items-baseline gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded"
                  style={{ background: kindColor[a.kind] ?? "#888" }}
                  aria-hidden="true"
                />
                <span className="font-medium text-ink-100">{a.name}:</span>
                <span className="text-ink-400">{a.text || <em>no text</em>}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Primitives                                                             */
/* ---------------------------------------------------------------------- */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-ink-700 bg-ink-900/60 p-4">
      <h3 className="text-[11px] uppercase tracking-wider text-ink-400">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div>
        <div className="text-[11px] font-medium text-ink-200">{label}</div>
        {hint && <div className="font-mono text-[10px] text-ink-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={[
        "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 placeholder:text-ink-600 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40",
        mono && "font-mono",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function SelectInput({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ImportIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 11V3M5 6l3-3 3 3M3 13h10" />
    </svg>
  );
}
function PrintIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6V2.5h8V6M4 11H2.5v-4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v4H12M4 9h8v4.5H4V9z" />
    </svg>
  );
}
