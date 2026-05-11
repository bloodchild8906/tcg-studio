import { useEffect, useState } from "react";
import { selectActiveCardType, useDesigner } from "@/store/designerStore";

/**
 * Schema editor modal.
 *
 * Edits `cardType.schemaJson.fields` — the list of field shapes that drives
 * the schema-driven Cards form. Backed by `updateActiveCardTypeSchema` in
 * the store, which PATCHes the card type and refreshes the local copy.
 *
 * Each field has:
 *   • key       — lowercase + underscores, the fieldKey used by zone bindings
 *                 and by `card.dataJson[key]`.
 *   • type      — one of text | longText | richText | number | boolean | stat | image
 *   • required  — flag the form will surface with an asterisk + (eventually)
 *                 reject-on-save.
 *   • min / max — only meaningful for number, but kept on the field shape so
 *                 the schema round-trips losslessly.
 *
 * UX:
 *   • Add field appends a blank row with `key = field_N` and type=text.
 *   • Up / Down reorder; trash deletes; click outside closes (no-op without save).
 *   • Save validates (no empty / duplicate keys) before sending.
 */

export interface SchemaField {
  key: string;
  type: FieldType;
  required: boolean;
  min?: number | null;
  max?: number | null;
}

const FIELD_TYPES = [
  "text",
  "longText",
  "richText",
  "number",
  "boolean",
  "stat",
  "image",
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function parseSchema(json: unknown): SchemaField[] {
  if (typeof json !== "object" || json === null) return [];
  const fieldsRaw = (json as { fields?: unknown }).fields;
  if (!Array.isArray(fieldsRaw)) return [];
  const out: SchemaField[] = [];
  for (const raw of fieldsRaw) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.key !== "string" || !r.key) continue;
    const typeStr = typeof r.type === "string" ? (r.type as FieldType) : "text";
    out.push({
      key: r.key,
      type: (FIELD_TYPES as readonly string[]).includes(typeStr) ? typeStr : "text",
      required: typeof r.required === "boolean" ? r.required : false,
      min: typeof r.min === "number" ? r.min : null,
      max: typeof r.max === "number" ? r.max : null,
    });
  }
  return out;
}

function serialize(fields: SchemaField[]): { fields: unknown[] } {
  return {
    fields: fields.map((f) => {
      const out: Record<string, unknown> = {
        key: f.key,
        type: f.type,
        required: f.required,
      };
      if (f.type === "number") {
        if (f.min !== null && f.min !== undefined) out.min = f.min;
        if (f.max !== null && f.max !== undefined) out.max = f.max;
      }
      return out;
    }),
  };
}

function validate(fields: SchemaField[]): string | null {
  const seen = new Set<string>();
  for (const [i, f] of fields.entries()) {
    if (!f.key.trim()) return `Field ${i + 1}: key cannot be empty.`;
    if (!FIELD_KEY_PATTERN.test(f.key)) {
      return `Field ${i + 1}: key "${f.key}" must be lowercase + underscores (a-z, 0-9, _) and start with a letter.`;
    }
    if (seen.has(f.key)) return `Duplicate key "${f.key}".`;
    seen.add(f.key);
  }
  return null;
}

export function SchemaEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cardType = useDesigner(selectActiveCardType);
  const updateSchema = useDesigner((s) => s.updateActiveCardTypeSchema);
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset whenever we open or the card type changes.
  useEffect(() => {
    if (open && cardType) {
      setFields(parseSchema(cardType.schemaJson));
      setError(null);
    }
  }, [open, cardType]);

  if (!open || !cardType) return null;

  function setField(i: number, patch: Partial<SchemaField>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function addField() {
    setFields((fs) => {
      // Pick a unique default key — field_1, field_2, …
      const used = new Set(fs.map((f) => f.key));
      let n = fs.length + 1;
      while (used.has(`field_${n}`)) n++;
      return [...fs, { key: `field_${n}`, type: "text", required: false }];
    });
  }

  function moveField(i: number, dir: -1 | 1) {
    setFields((fs) => {
      const j = i + dir;
      if (j < 0 || j >= fs.length) return fs;
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function removeField(i: number) {
    setFields((fs) => fs.filter((_, idx) => idx !== i));
  }

  async function save() {
    const v = validate(fields);
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await updateSchema(serialize(fields));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit schema"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">
              Schema · <span className="text-ink-300">{cardType.name}</span>
            </h2>
            <p className="text-[11px] text-ink-400">
              Define the fields cards of this type will carry. The Cards form
              renders one input per field; zones in the template can bind to
              these field keys.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-3">
          {fields.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-1.5">
              <Header />
              {fields.map((f, i) => (
                <FieldRow
                  key={i}
                  field={f}
                  index={i}
                  total={fields.length}
                  onChange={(patch) => setField(i, patch)}
                  onMoveUp={() => moveField(i, -1)}
                  onMoveDown={() => moveField(i, 1)}
                  onDelete={() => removeField(i)}
                />
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={addField}
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-xs text-ink-100 hover:bg-ink-700"
          >
            + Add field
          </button>
        </div>

        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-ink-700 px-4 py-3">
          <p className="text-[11px] text-ink-500">
            {fields.length} field{fields.length === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
            >
              {saving ? "Saving…" : "Save schema"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Header() {
  return (
    <li className="grid grid-cols-[1fr_140px_70px_140px_auto] items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wider text-ink-500">
      <span>Key</span>
      <span>Type</span>
      <span className="text-center">Required</span>
      <span>Min / Max</span>
      <span></span>
    </li>
  );
}

function FieldRow({
  field,
  index,
  total,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  field: SchemaField;
  index: number;
  total: number;
  onChange: (patch: Partial<SchemaField>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const showRange = field.type === "number";
  return (
    <li className="grid grid-cols-[1fr_140px_70px_140px_auto] items-center gap-2 rounded border border-ink-800 bg-ink-900/40 px-2 py-1.5">
      <input
        type="text"
        value={field.key}
        onChange={(e) =>
          onChange({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]+/g, "_") })
        }
        placeholder="field_key"
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
      />
      <select
        value={field.type}
        onChange={(e) => onChange({ type: e.target.value as FieldType })}
        className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
      >
        {FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <label className="flex items-center justify-center">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
          className="accent-accent-500"
        />
      </label>
      <div className="grid grid-cols-2 gap-1">
        <input
          type="number"
          value={field.min ?? ""}
          onChange={(e) =>
            onChange({ min: e.target.value === "" ? null : Number(e.target.value) })
          }
          placeholder="min"
          disabled={!showRange}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 disabled:opacity-30"
        />
        <input
          type="number"
          value={field.max ?? ""}
          onChange={(e) =>
            onChange({ max: e.target.value === "" ? null : Number(e.target.value) })
          }
          placeholder="max"
          disabled={!showRange}
          className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100 disabled:opacity-30"
        />
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton title="Move up" disabled={index === 0} onClick={onMoveUp}>
          <ArrowUp />
        </IconButton>
        <IconButton title="Move down" disabled={index === total - 1} onClick={onMoveDown}>
          <ArrowDown />
        </IconButton>
        <IconButton title="Remove" danger onClick={onDelete}>
          <Trash />
        </IconButton>
      </div>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-ink-700 px-6 py-10 text-center text-xs text-ink-500">
      <p>No schema fields yet.</p>
      <p className="text-[11px] text-ink-600">
        Add the first field below — start with <code className="text-ink-400">name</code>,{" "}
        <code className="text-ink-400">cost</code>, <code className="text-ink-400">type_line</code>,{" "}
        <code className="text-ink-400">rules_text</code>.
      </p>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-6 w-6 items-center justify-center rounded text-ink-300 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30",
        danger && "hover:!bg-danger-500/20 hover:!text-danger-500",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </button>
  );
}

function ArrowUp() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}
function ArrowDown() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 3v10M4 9l4 4 4-4" />
    </svg>
  );
}
function Trash() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 5h10M6 5V3.5A1 1 0 0 1 7 2.5h2a1 1 0 0 1 1 1V5M5 5l1 8h4l1-8" />
    </svg>
  );
}
