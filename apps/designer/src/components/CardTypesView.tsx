import { useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import type { CardType } from "@/lib/apiTypes";
import { CardTypeThumbnail } from "@/components/CardPreview";

/**
 * Card Types view — the home grid.
 *
 * Shows every card type in the active project as a tile. Click a tile to
 * open the Card Type Designer for that type. The "+ New" tile creates a card
 * type via the API and immediately switches to the designer with a starter
 * template loaded — the user's first Save persists it as a real template.
 *
 * Layout:
 *   ┌───────┬───────┬───────┬───────┐
 *   │  + new│ tile  │ tile  │ tile  │
 *   └───────┴───────┴───────┴───────┘
 *
 * The "+ new" tile is first so it's reachable even when the project has many
 * card types. The new-type form is inline (no modal): less friction, and
 * card-type creation is rapid in early design.
 */
export function CardTypesView() {
  const project = useDesigner(selectActiveProject);
  const cardTypes = useDesigner((s) => s.cardTypes);
  const setView = useDesigner((s) => s.setView);
  const selectCardType = useDesigner((s) => s.selectCardType);

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6">
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            {project ? `Project: ${project.name}` : "No project selected"}
          </p>
          <h1 className="text-xl font-semibold text-ink-50">Card types</h1>
          <p className="mt-1 text-xs text-ink-400">
            Each card type defines a layout, schema, and variants. Click one to open the designer.
          </p>
        </header>

        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
          <NewCardTypeTile />
          {cardTypes.map((c) => (
            <CardTypeTile
              key={c.id}
              cardType={c}
              onOpen={() => {
                void selectCardType(c.id);
                setView("designer");
              }}
              onOpenCards={() => {
                void selectCardType(c.id);
                setView("cards");
              }}
            />
          ))}
        </ul>

        {cardTypes.length === 0 && (
          <p className="mt-6 text-sm text-ink-500">
            No card types yet — create your first one above.
          </p>
        )}
      </div>
    </div>
  );
}

function CardTypeTile({
  cardType,
  onOpen,
  onOpenCards,
}: {
  cardType: CardType;
  onOpen: () => void;
  onOpenCards: () => void;
}) {
  const fieldsCount = (() => {
    const fields = (cardType.schemaJson as { fields?: unknown[] } | null)?.fields;
    return Array.isArray(fields) ? fields.length : 0;
  })();
  const hasTemplate = cardType.activeTemplateId !== null;

  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 transition-colors hover:border-accent-500/40">
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col items-start gap-2 p-4 text-left"
      >
        <div className="flex w-full items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink-50">{cardType.name}</h3>
            <p className="truncate font-mono text-[10px] text-ink-500">{cardType.slug}</p>
          </div>
          <StatusPill status={cardType.status} />
        </div>
        <CardTypePreview cardType={cardType} hasTemplate={hasTemplate} />
        <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-500">
          <span>{fieldsCount} field{fieldsCount === 1 ? "" : "s"}</span>
          <span>·</span>
          <span>{hasTemplate ? "has template" : "no template"}</span>
        </div>
      </button>
      <div className="flex border-t border-ink-800">
        <TileAction onClick={onOpen}>Designer</TileAction>
        <TileAction onClick={onOpenCards}>Cards</TileAction>
      </div>
    </li>
  );
}

function CardTypePreview({
  cardType,
  hasTemplate,
}: {
  cardType: CardType;
  hasTemplate: boolean;
}) {
  // When the card type has a real template (or matches the active editor
  // template), render via CardTypeThumbnail. For untemplated card types
  // we still show the sample as a hint of what the layout *could* look
  // like, with a small overlay so the user knows it's a placeholder.
  return (
    <div className="relative w-full overflow-hidden rounded border border-ink-800 bg-ink-950/40">
      <CardTypeThumbnail cardType={cardType} />
      {!hasTemplate && (
        <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-gradient-to-t from-ink-950/85 via-ink-950/40 to-transparent p-2">
          <span className="rounded bg-ink-900/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400">
            Untemplated · sample shown
          </span>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "border-ink-700 bg-ink-800 text-ink-400",
    review: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    released: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    deprecated: "border-ink-700 bg-ink-800 text-ink-500",
    archived: "border-ink-700 bg-ink-800 text-ink-600",
  };
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider ${
        map[status] ?? map.draft
      }`}
    >
      {status}
    </span>
  );
}

function TileAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-400 hover:bg-ink-800 hover:text-ink-100"
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* + new tile                                                             */
/* ---------------------------------------------------------------------- */

function NewCardTypeTile() {
  const project = useDesigner(selectActiveProject);
  const createCardType = useDesigner((s) => s.createCardType);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);

  function autoSlug(n: string) {
    return n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !name.trim()) return;
    setBusy(true);
    try {
      await createCardType({
        name: name.trim(),
        slug: (slug.trim() || autoSlug(name)) || "type",
      });
      setName("");
      setSlug("");
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
          disabled={!project}
          className="flex aspect-[5/7] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-700 bg-ink-900/40 text-ink-400 transition-colors hover:border-accent-500/60 hover:bg-accent-500/5 hover:text-accent-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusIcon />
          <span className="text-xs font-medium">New card type</span>
          <span className="text-[10px] text-ink-500">Character, Spell, Source, …</span>
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
        <p className="text-[10px] uppercase tracking-wider text-accent-300">
          New card type
        </p>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-ink-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug(autoSlug(e.target.value));
            }}
            placeholder="Spell"
            autoFocus
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-ink-400">Slug</span>
          <input
            type="text"
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))
            }
            placeholder="spell"
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-100"
          />
        </label>
        <p className="text-[10px] text-ink-500">
          Creates the card type, then opens the designer with a starter template.
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
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </li>
  );
}

function PlusIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
