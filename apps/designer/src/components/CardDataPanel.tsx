import { useState } from "react";
import { useDesigner } from "@/store/designerStore";

/**
 * Preview Data panel — bottom of the left column.
 *
 * Lets the designer fill in mock card values (faction = Fire, rarity = Mythic,
 * cost = 3) so variant rules on layers (`appliesWhen`) have something to
 * evaluate against. Updating a value re-renders the canvas live.
 *
 * v0 scope:
 *   • One row per key/value pair.
 *   • Values are stored as strings — the variant evaluator does the coercion
 *     (faction = "Fire", cost = "3" both work).
 *   • Card data authoring lives in the dedicated Cards view (top-level view
 *     toggle in the header), not here. Loading a card from that view writes
 *     its dataJson into this same previewData slot, so the canvas renders
 *     real cards through the same pipeline.
 */
export function CardDataPanel() {
  const previewData = useDesigner((s) => s.template.previewData);
  const setPreviewField = useDesigner((s) => s.setPreviewField);
  const removePreviewField = useDesigner((s) => s.removePreviewField);
  const activeCardId = useDesigner((s) => s.activeCardId);
  const cards = useDesigner((s) => s.cards);
  const activeCard = cards.find((c) => c.id === activeCardId) ?? null;

  const entries = Object.entries(previewData ?? {});

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline justify-between border-b border-ink-700 px-3 py-2">
        <h2 className="text-[11px] uppercase tracking-wider text-ink-400">Preview data</h2>
        {activeCard ? (
          <span
            className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-300"
            title={`Showing ${activeCard.name}`}
          >
            {activeCard.name}
          </span>
        ) : (
          <span className="text-[10px] text-ink-500">{entries.length} field{entries.length === 1 ? "" : "s"}</span>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-ink-500">
            No preview data — variant rules will only match layers without conditions.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map(([field, value]) => (
              <PreviewRow
                key={field}
                field={field}
                value={String(value ?? "")}
                onChange={(v) => setPreviewField(field, v)}
                onDelete={() => removePreviewField(field)}
              />
            ))}
          </ul>
        )}
        <AddField onAdd={(field, value) => setPreviewField(field, value)} />
      </div>
    </div>
  );
}

function PreviewRow({
  field,
  value,
  onChange,
  onDelete,
}: {
  field: string;
  value: string;
  onChange: (v: string) => void;
  onDelete: () => void;
}) {
  return (
    <li className="grid grid-cols-[2fr_3fr_auto] items-center gap-1">
      <span className="truncate font-mono text-[10px] text-ink-400" title={field}>
        {field}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
      />
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-danger-500"
        title="Remove field"
      >
        ×
      </button>
    </li>
  );
}

function AddField({ onAdd }: { onAdd: (field: string, value: string) => void }) {
  const [field, setField] = useState("");
  const [value, setValue] = useState("");

  function commit() {
    const k = field.trim();
    if (!k) return;
    onAdd(k, value);
    setField("");
    setValue("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      className="mt-2 grid grid-cols-[2fr_3fr_auto] items-center gap-1 border-t border-ink-800 pt-2"
    >
      <input
        type="text"
        value={field}
        onChange={(e) => setField(e.target.value.replace(/\s+/g, "_"))}
        placeholder="field"
        className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-ink-100 placeholder:text-ink-600"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value"
        className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100 placeholder:text-ink-600"
      />
      <button
        type="submit"
        disabled={!field.trim()}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-300 hover:bg-ink-800 disabled:opacity-30"
        title="Add field"
      >
        +
      </button>
    </form>
  );
}
