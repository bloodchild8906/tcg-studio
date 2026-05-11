import { useEffect, useState } from "react";
import { useDesigner, selectSelectedLayer } from "@/store/designerStore";
import type {
  AppliesWhenRule,
  Layer,
  LayerVariant,
  NineSlice,
  TwentyFiveSlice,
  VariantCondition,
  VariantOperator,
} from "@/types";
import { useAssetPicker } from "@/components/AssetPicker";
import { SpriteCellPicker } from "@/components/SpriteCellPicker";
import { assetBlobUrl, getAsset as apiGetAsset } from "@/lib/api";
import type { Asset } from "@/lib/apiTypes";
import { describeOperator, evaluateApplies, matchesVariant } from "@/lib/variants";

/**
 * Properties inspector (right panel).
 *
 * Renders different field groups based on the selected layer's type. Common
 * fields (name, position, size, rotation, visibility, lock, opacity) appear at
 * the top; type-specific fields below.
 *
 * Each input writes back through `updateLayer`. We don't debounce here — the
 * store mutations are cheap and the canvas re-render is a single Konva.draw().
 *
 * Why string→number coercion is centralized: HTML number inputs can produce
 * empty strings during edits. Treating those as "leave the value alone" stops
 * a user mid-typing from accidentally clearing a value.
 */
export function Inspector() {
  const layer = useDesigner(selectSelectedLayer);
  const updateLayer = useDesigner((s) => s.updateLayer);
  const commit = useDesigner((s) => s.commit);
  const selectedCount = useDesigner((s) => s.selectedLayerIds.length);

  if (!layer) {
    return <PageSetupPanel />;
  }

  function patch(p: Partial<Layer>) {
    if (!layer) return;
    updateLayer(layer.id, p);
  }

  return (
    <div className="flex h-full flex-col" onFocusCapture={(e) => {
      // Snapshot history once when the user starts interacting with this panel.
      // Capture phase fires before the focused element's own onFocus, and the
      // event bubbles up here from any nested input. We snapshot only when
      // the focus moves *into* an editable element from outside the panel.
      const target = e.target as HTMLElement | null;
      const related = e.relatedTarget as HTMLElement | null;
      const wasOutside = !related || !e.currentTarget.contains(related);
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "SELECT" ||
        target?.tagName === "TEXTAREA";
      if (wasOutside && isEditable) commit();
    }}>
      <PanelHeader title="Inspector" subtitle={layer.type} />
      {selectedCount > 1 && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[10px] text-amber-300">
          {selectedCount} layers selected — editing primary; transforms apply to all.
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <FieldGroup title="Layer">
          <Field label="Name">
            <TextInput
              value={layer.name}
              onChange={(v) => patch({ name: v } as Partial<Layer>)}
            />
          </Field>
          <Field label="Type">
            <ReadOnly value={layer.type} />
          </Field>
        </FieldGroup>

        <FieldGroup title="Transform">
          <Row>
            <Field label="X">
              <NumberInput
                value={layer.bounds.x}
                onChange={(v) =>
                  patch({ bounds: { ...layer.bounds, x: v } } as Partial<Layer>)
                }
              />
            </Field>
            <Field label="Y">
              <NumberInput
                value={layer.bounds.y}
                onChange={(v) =>
                  patch({ bounds: { ...layer.bounds, y: v } } as Partial<Layer>)
                }
              />
            </Field>
          </Row>
          <Row>
            <Field label="W">
              <NumberInput
                value={layer.bounds.width}
                min={1}
                onChange={(v) =>
                  patch({
                    bounds: { ...layer.bounds, width: Math.max(1, v) },
                  } as Partial<Layer>)
                }
              />
            </Field>
            <Field label="H">
              <NumberInput
                value={layer.bounds.height}
                min={1}
                onChange={(v) =>
                  patch({
                    bounds: { ...layer.bounds, height: Math.max(1, v) },
                  } as Partial<Layer>)
                }
              />
            </Field>
          </Row>
          <Row>
            <Field label="Rotation°">
              <NumberInput
                value={layer.rotation}
                onChange={(v) => patch({ rotation: v } as Partial<Layer>)}
              />
            </Field>
            <Field label="Opacity">
              <NumberInput
                value={layer.opacity}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) =>
                  patch({ opacity: Math.max(0, Math.min(1, v)) } as Partial<Layer>)
                }
              />
            </Field>
          </Row>
          <Row>
            <Toggle
              label="Visible"
              checked={layer.visible}
              onChange={(v) => patch({ visible: v } as Partial<Layer>)}
            />
            <Toggle
              label="Locked"
              checked={layer.locked}
              onChange={(v) => patch({ locked: v } as Partial<Layer>)}
            />
          </Row>
        </FieldGroup>

        <AppliesWhenFields layer={layer} patch={patch} />

        {layer.type === "rect" && <RectFields layer={layer} patch={patch} />}
        {layer.type === "text" && <TextFields layer={layer} patch={patch} />}
        {layer.type === "image" && <ImageFields layer={layer} patch={patch} />}
        {layer.type === "zone" && <ZoneFields layer={layer} patch={patch} />}

        <VariantsFields layer={layer} patch={patch} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Per-layer variant overrides                                            */
/* ---------------------------------------------------------------------- */

function VariantsFields({
  layer,
  patch,
}: {
  layer: Layer;
  patch: (p: Partial<Layer>) => void;
}) {
  const previewData = useDesigner((s) => s.template.previewData ?? {});
  const variants = layer.variants ?? [];

  function setVariants(next: LayerVariant[]) {
    patch({ variants: next.length === 0 ? undefined : next } as Partial<Layer>);
  }

  function addVariant() {
    setVariants([
      ...variants,
      {
        name: `Variant ${variants.length + 1}`,
        match: "all",
        conditions: [{ field: "faction", op: "equals", value: "" }],
        overrides: {},
      },
    ]);
  }

  function patchVariant(i: number, p: Partial<LayerVariant>) {
    setVariants(variants.map((v, idx) => (idx === i ? { ...v, ...p } : v)));
  }

  function moveVariant(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= variants.length) return;
    const next = [...variants];
    [next[i], next[j]] = [next[j], next[i]];
    setVariants(next);
  }

  function removeVariant(i: number) {
    setVariants(variants.filter((_, idx) => idx !== i));
  }

  return (
    <FieldGroup title={`Variants (${variants.length})`}>
      <p className="text-[10px] text-ink-500">
        First-match-wins. Each variant overrides specific properties when its
        rule matches the current preview / card data.
      </p>
      {variants.length === 0 ? (
        <p className="px-1 text-[11px] text-ink-500">No variants on this layer.</p>
      ) : (
        <ul className="space-y-2">
          {variants.map((v, i) => {
            const matching = matchesVariant(v, previewData);
            return (
              <VariantRow
                key={i}
                variant={v}
                index={i}
                total={variants.length}
                matching={matching}
                layer={layer}
                onChange={(p) => patchVariant(i, p)}
                onMoveUp={() => moveVariant(i, -1)}
                onMoveDown={() => moveVariant(i, 1)}
                onDelete={() => removeVariant(i)}
              />
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={addVariant}
        className="mt-1 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
      >
        + Add variant
      </button>
    </FieldGroup>
  );
}

function VariantRow({
  variant,
  index,
  total,
  matching,
  layer,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  variant: LayerVariant;
  index: number;
  total: number;
  matching: boolean;
  layer: Layer;
  onChange: (p: Partial<LayerVariant>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  function setConditions(conditions: VariantCondition[]) {
    onChange({ conditions });
  }
  function setOverride(key: string, value: unknown) {
    const overrides = { ...variant.overrides };
    if (value === undefined || value === "" || value === null) {
      delete overrides[key];
    } else {
      overrides[key] = value;
    }
    onChange({ overrides });
  }
  // Multi-key version — necessary for the asset picker which writes
  // `assetId` + slice + slice25 + pixelsPerUnit in one transaction.
  // Calling setOverride sequentially would race because each call
  // captures `variant.overrides` from its own closure.
  function setOverrides(patch: Record<string, unknown>) {
    const overrides = { ...variant.overrides };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === null) delete overrides[k];
      else overrides[k] = v;
    }
    onChange({ overrides });
  }

  const overrideKeys = Object.keys(variant.overrides);

  return (
    <li className="space-y-1.5 rounded border border-ink-700 bg-ink-900/40 p-2">
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={variant.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={`Variant ${index + 1}`}
          className="flex-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100"
        />
        <span
          className={[
            "rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
            matching
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-ink-700 bg-ink-800 text-ink-400",
          ].join(" ")}
          title={matching ? "Active under current preview data" : "Not matching"}
        >
          {matching ? "active" : "—"}
        </span>
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30"
          title="Move up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === total - 1}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-50 disabled:opacity-30"
          title="Move down"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-danger-500/20 hover:text-danger-500"
          title="Delete"
        >
          ×
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-500">When</span>
          <select
            value={variant.match}
            onChange={(e) => onChange({ match: e.target.value as "all" | "any" })}
            className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0 text-[10px] text-ink-100"
          >
            <option value="all">all of</option>
            <option value="any">any of</option>
          </select>
        </div>
        <ul className="space-y-1">
          {variant.conditions.map((cond, i) => (
            <ConditionRow
              key={i}
              cond={cond}
              onChange={(next) => {
                const list = [...variant.conditions];
                list[i] = next;
                setConditions(list);
              }}
              onDelete={() =>
                setConditions(variant.conditions.filter((_, j) => j !== i))
              }
            />
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            setConditions([
              ...variant.conditions,
              { field: "faction", op: "equals", value: "" },
            ])
          }
          className="mt-1 rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-100 hover:bg-ink-700"
        >
          + condition
        </button>
      </div>

      <div className="border-t border-ink-800 pt-1.5">
        <p className="mb-1 text-[10px] uppercase tracking-wider text-ink-500">
          Then override
        </p>
        <OverrideEditor
          layer={layer}
          overrides={variant.overrides}
          onChange={setOverride}
          onChangeBatch={setOverrides}
        />
        {overrideKeys.length === 0 && (
          <p className="mt-1 text-[10px] text-ink-600">
            No overrides yet — variant matches but renders the base layer.
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Layer-type-aware override editor. Surfaces the most useful properties
 * per layer type instead of a generic "key/value" form. Picking a value
 * sets the override; clearing it removes the key.
 */
function OverrideEditor({
  layer,
  overrides,
  onChange,
  onChangeBatch,
}: {
  layer: Layer;
  overrides: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** Single-transaction multi-key setter — used by the asset picker
   *  so swapping the asset id ALSO writes the asset's slice / slice25
   *  / pixelsPerUnit metadata into the variant override. Without this
   *  the picker would race against itself if it called onChange three
   *  times in a row (each call captures stale overrides). */
  onChangeBatch?: (patch: Record<string, unknown>) => void;
}) {
  // Variant-override asset picker — mirrors the layer-level picker's
  // auto-apply behavior so a faction-driven frame swap (e.g. "Fire →
  // fire-frame.png") carries the frame asset's 9-slice / 25-slice /
  // PPU into the override. Without this, the resolved layer would
  // keep the BASE layer's slice config and render the new frame with
  // the wrong insets.
  const picker = useAssetPicker((asset) => {
    const meta = (asset.metadataJson ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { assetId: asset.id };
    // 25-slice wins over 9-slice (renderer prefers it; keeping both
    // in the override record would be confusing).
    const meta25 = meta.slice25 as Record<string, unknown> | undefined;
    const meta9 = meta.slice as Record<string, unknown> | undefined;
    if (meta25 && typeof meta25 === "object") {
      patch.slice25 = {
        outerTop: Number(meta25.outerTop) || 0,
        outerRight: Number(meta25.outerRight) || 0,
        outerBottom: Number(meta25.outerBottom) || 0,
        outerLeft: Number(meta25.outerLeft) || 0,
        innerTop: Number(meta25.innerTop) || 0,
        innerRight: Number(meta25.innerRight) || 0,
        innerBottom: Number(meta25.innerBottom) || 0,
        innerLeft: Number(meta25.innerLeft) || 0,
        ...(typeof meta25.maxStretchX === "number"
          ? { maxStretchX: meta25.maxStretchX }
          : {}),
        ...(typeof meta25.maxStretchY === "number"
          ? { maxStretchY: meta25.maxStretchY }
          : {}),
      };
      patch.slice = null;
    } else if (meta9 && typeof meta9 === "object") {
      patch.slice = {
        top: Number(meta9.top) || 0,
        right: Number(meta9.right) || 0,
        bottom: Number(meta9.bottom) || 0,
        left: Number(meta9.left) || 0,
      };
      patch.slice25 = null;
    } else {
      // Asset has no slice metadata — clear any stale slice on the
      // override so it doesn't leak from a prior asset pick.
      patch.slice = null;
      patch.slice25 = null;
    }
    // Apply via batch so it's a single state update.
    if (onChangeBatch) onChangeBatch(patch);
    else onChange("assetId", asset.id);
  });
  const get = (k: string) => overrides[k];

  if (layer.type === "image") {
    const assetId = typeof get("assetId") === "string" ? (get("assetId") as string) : null;
    const src = typeof get("src") === "string" ? (get("src") as string) : "";
    return (
      <div className="space-y-1.5">
        <Field label="Asset id (frame art)">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:6px_6px]">
              {assetId && (
                <img src={assetBlobUrl(assetId)} alt="" className="max-h-full max-w-full object-contain" />
              )}
            </div>
            <button
              type="button"
              onClick={picker.open}
              className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
            >
              {assetId ? "Change…" : "Pick…"}
            </button>
            {assetId && (
              <button
                type="button"
                onClick={() => onChange("assetId", undefined)}
                className="rounded border border-transparent px-1.5 py-1 text-[10px] text-ink-400 hover:border-ink-700 hover:bg-ink-800"
              >
                clear
              </button>
            )}
            {picker.element}
          </div>
        </Field>
        <Field label="External URL (overrides asset)">
          <TextInput
            value={src}
            placeholder="https://…"
            onChange={(v) => onChange("src", v.trim() || undefined)}
          />
        </Field>
      </div>
    );
  }

  if (layer.type === "rect") {
    return (
      <div className="space-y-1.5">
        <Field label="Fill">
          <ColorOverride
            value={typeof get("fill") === "string" ? (get("fill") as string) : ""}
            onChange={(v) => onChange("fill", v || undefined)}
          />
        </Field>
        <Field label="Stroke">
          <ColorOverride
            value={typeof get("stroke") === "string" ? (get("stroke") as string) : ""}
            onChange={(v) => onChange("stroke", v || undefined)}
          />
        </Field>
        <Field label="Stroke width">
          <NumberOverride
            value={typeof get("strokeWidth") === "number" ? (get("strokeWidth") as number) : ""}
            onChange={(v) => onChange("strokeWidth", v)}
          />
        </Field>
      </div>
    );
  }

  if (layer.type === "text") {
    return (
      <div className="space-y-1.5">
        <Field label="Text">
          <TextInput
            value={typeof get("text") === "string" ? (get("text") as string) : ""}
            onChange={(v) => onChange("text", v || undefined)}
          />
        </Field>
        <Field label="Color">
          <ColorOverride
            value={typeof get("fill") === "string" ? (get("fill") as string) : ""}
            onChange={(v) => onChange("fill", v || undefined)}
          />
        </Field>
        <Field label="Font size">
          <NumberOverride
            value={typeof get("fontSize") === "number" ? (get("fontSize") as number) : ""}
            onChange={(v) => onChange("fontSize", v)}
          />
        </Field>
      </div>
    );
  }

  if (layer.type === "zone") {
    return (
      <div className="space-y-1.5">
        <Field label="Placeholder">
          <TextInput
            value={typeof get("placeholder") === "string" ? (get("placeholder") as string) : ""}
            onChange={(v) => onChange("placeholder", v || undefined)}
          />
        </Field>
        <Field label="Color">
          <ColorOverride
            value={typeof get("fill") === "string" ? (get("fill") as string) : ""}
            onChange={(v) => onChange("fill", v || undefined)}
          />
        </Field>
      </div>
    );
  }

  return null;
}

function ColorOverride({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5"
      />
      <input
        type="text"
        value={value}
        placeholder="(unchanged)"
        onChange={(e) => onChange(e.target.value)}
        className="block flex-1 rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[11px] text-ink-100"
      />
    </div>
  );
}

function NumberOverride({
  value,
  onChange,
}: {
  value: number | "";
  onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      value={value === "" ? "" : value}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? undefined : Number(v));
      }}
      placeholder="(unchanged)"
      className="block w-full rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-xs text-ink-100"
    />
  );
}

/* ---------------------------------------------------------------------- */
/* Variant rule editor                                                    */
/* ---------------------------------------------------------------------- */

const OPERATORS: VariantOperator[] = [
  "equals",
  "not_equals",
  "in",
  "not_in",
  "exists",
  "missing",
];

function AppliesWhenFields({
  layer,
  patch,
}: {
  layer: Layer;
  patch: (p: Partial<Layer>) => void;
}) {
  const previewData = useDesigner((s) => s.template.previewData ?? {});
  const rule: AppliesWhenRule | null = layer.appliesWhen ?? null;
  const enabled = !!rule;
  const matches = evaluateApplies(rule, previewData);

  function setRule(next: AppliesWhenRule | null) {
    patch({ appliesWhen: next } as Partial<Layer>);
  }

  function setConditions(conditions: VariantCondition[]) {
    if (!rule) return;
    setRule({ ...rule, conditions });
  }

  return (
    <FieldGroup title="Applies when">
      <div className="flex items-center gap-2">
        <Toggle
          label={enabled ? "Conditional" : "Always visible"}
          checked={enabled}
          onChange={(v) =>
            setRule(v ? { match: "all", conditions: [] } : null)
          }
        />
        {enabled && (
          <span
            className={[
              "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
              matches
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-ink-700 bg-ink-800 text-ink-400",
            ].join(" ")}
            title={matches ? "Layer is rendering with current preview data." : "Layer is hidden by its rule."}
          >
            {matches ? "matches" : "no match"}
          </span>
        )}
      </div>

      {enabled && rule && (
        <>
          <Field label="Match">
            <Select
              value={rule.match}
              options={["all", "any"]}
              onChange={(v) => setRule({ ...rule, match: v as "all" | "any" })}
            />
          </Field>

          <ul className="space-y-1">
            {rule.conditions.length === 0 && (
              <li className="text-[11px] text-ink-500">No conditions yet — layer always applies.</li>
            )}
            {rule.conditions.map((cond, i) => (
              <ConditionRow
                key={i}
                cond={cond}
                onChange={(next) => {
                  const list = [...rule.conditions];
                  list[i] = next;
                  setConditions(list);
                }}
                onDelete={() => {
                  const list = rule.conditions.filter((_, j) => j !== i);
                  setConditions(list);
                }}
              />
            ))}
          </ul>

          <button
            type="button"
            onClick={() =>
              setConditions([
                ...rule.conditions,
                { field: "faction", op: "equals", value: "" },
              ])
            }
            className="mt-1 inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
          >
            + Add condition
          </button>
        </>
      )}
    </FieldGroup>
  );
}

function ConditionRow({
  cond,
  onChange,
  onDelete,
}: {
  cond: VariantCondition;
  onChange: (next: VariantCondition) => void;
  onDelete: () => void;
}) {
  // For exists/missing, no value input is shown — the field name is enough.
  const wantsValue = cond.op !== "exists" && cond.op !== "missing";
  const wantsList = cond.op === "in" || cond.op === "not_in";

  return (
    <li className="grid grid-cols-[3fr_2fr_3fr_auto] items-center gap-1">
      <input
        type="text"
        value={cond.field}
        onChange={(e) => onChange({ ...cond, field: e.target.value.replace(/\s+/g, "_") })}
        placeholder="field"
        className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-ink-100 placeholder:text-ink-600"
      />
      <select
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as VariantOperator })}
        className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] text-ink-100"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {describeOperator(op)}
          </option>
        ))}
      </select>
      {wantsValue ? (
        <input
          type="text"
          value={
            wantsList
              ? Array.isArray(cond.value)
                ? cond.value.join(", ")
                : ""
              : String(cond.value ?? "")
          }
          onChange={(e) =>
            onChange({
              ...cond,
              value: wantsList
                ? e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean)
                : e.target.value,
            })
          }
          placeholder={wantsList ? "Fire, Water, …" : "value"}
          className="rounded border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[11px] text-ink-100 placeholder:text-ink-600"
        />
      ) : (
        <span className="text-[10px] text-ink-500">—</span>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:bg-ink-800 hover:text-danger-500"
        title="Remove"
      >
        ×
      </button>
    </li>
  );
}

/* ---------------------------------------------------------------------- */
/* Type-specific groups                                                   */
/* ---------------------------------------------------------------------- */

function RectFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "rect" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  return (
    <FieldGroup title="Rectangle">
      <Field label="Fill">
        <ColorInput value={layer.fill} onChange={(v) => patch({ fill: v } as Partial<Layer>)} />
      </Field>
      <Field label="Stroke">
        <ColorInput
          value={layer.stroke ?? "#000000"}
          onChange={(v) => patch({ stroke: v } as Partial<Layer>)}
        />
      </Field>
      <Row>
        <Field label="Stroke W">
          <NumberInput
            value={layer.strokeWidth}
            min={0}
            onChange={(v) => patch({ strokeWidth: Math.max(0, v) } as Partial<Layer>)}
          />
        </Field>
        <Field label="Corner R">
          <NumberInput
            value={layer.cornerRadius}
            min={0}
            onChange={(v) => patch({ cornerRadius: Math.max(0, v) } as Partial<Layer>)}
          />
        </Field>
      </Row>
    </FieldGroup>
  );
}

function TextFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "text" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  return (
    <FieldGroup title="Text">
      <Field label="Content">
        <TextArea value={layer.text} onChange={(v) => patch({ text: v } as Partial<Layer>)} />
      </Field>
      <Field label="Font family">
        <TextInput
          value={layer.fontFamily}
          onChange={(v) => patch({ fontFamily: v } as Partial<Layer>)}
        />
      </Field>
      <Row>
        <Field label="Size">
          <NumberInput
            value={layer.fontSize}
            min={1}
            onChange={(v) => patch({ fontSize: Math.max(1, v) } as Partial<Layer>)}
          />
        </Field>
        <Field label="Style">
          <Select
            value={layer.fontStyle}
            options={["normal", "italic", "bold", "bold italic"]}
            onChange={(v) => patch({ fontStyle: v as typeof layer.fontStyle } as Partial<Layer>)}
          />
        </Field>
      </Row>
      <Row>
        <Field label="Align">
          <Select
            value={layer.align}
            options={["left", "center", "right"]}
            onChange={(v) => patch({ align: v as typeof layer.align } as Partial<Layer>)}
          />
        </Field>
        <Field label="V-align">
          <Select
            value={layer.verticalAlign}
            options={["top", "middle", "bottom"]}
            onChange={(v) =>
              patch({ verticalAlign: v as typeof layer.verticalAlign } as Partial<Layer>)
            }
          />
        </Field>
      </Row>
      <Row>
        <Field label="Color">
          <ColorInput value={layer.fill} onChange={(v) => patch({ fill: v } as Partial<Layer>)} />
        </Field>
        <Toggle
          label="Wrap"
          checked={layer.wrap}
          onChange={(v) => patch({ wrap: v } as Partial<Layer>)}
        />
      </Row>
      <TextPathFields layer={layer} patch={patch} />
    </FieldGroup>
  );
}

/**
 * Text-along-path controls (sec-19 stretch).
 *
 * When `pathData` is set, both renderers flow the text along the
 * supplied SVG path instead of drawing it horizontally. The user can
 * either type / paste an SVG `d` string or pick from a small set of
 * presets calibrated to the layer's bounds (so an arc preset fills the
 * width of the layer regardless of how big it is).
 *
 * Toggle off (clear path) ⇒ falls back to the regular text renderer.
 */
function TextPathFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "text" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const enabled = !!layer.pathData;
  const w = Math.max(1, Math.round(layer.bounds.width));
  const h = Math.max(1, Math.round(layer.bounds.height));

  const presets: Array<{ label: string; build: () => string }> = [
    {
      label: "Arc up",
      // Quadratic upward curve from left-baseline to right-baseline,
      // peaking at the top of the layer.
      build: () => `M 0 ${h} Q ${w / 2} 0 ${w} ${h}`,
    },
    {
      label: "Arc down",
      build: () => `M 0 0 Q ${w / 2} ${h} ${w} 0`,
    },
    {
      label: "Wave",
      build: () => `M 0 ${h / 2} Q ${w / 4} 0 ${w / 2} ${h / 2} T ${w} ${h / 2}`,
    },
    {
      label: "Circle",
      // SVG arc trick: a 360° arc requires two semicircles because a
      // single rx,ry,_,_,sweep,_ arc with start==end paints nothing.
      // Two halves with the same radius traces a full circle clockwise.
      build: () => {
        const r = Math.min(w, h) / 2 - 2;
        const cx = w / 2;
        const cy = h / 2;
        return `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`;
      },
    },
    {
      label: "Diagonal",
      build: () => `M 0 ${h} L ${w} 0`,
    },
  ];

  return (
    <div className="mt-2 rounded border border-ink-700 bg-ink-900/40 p-3">
      <label className="flex items-center gap-2 text-xs text-ink-100">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (!e.target.checked) {
              patch({ pathData: null } as Partial<Layer>);
            } else {
              // Default to the Arc-up preset so toggling on yields a
              // visible curve immediately rather than silently failing.
              patch({ pathData: presets[0].build() } as Partial<Layer>);
            }
          }}
          className="h-3 w-3 cursor-pointer accent-accent-500"
        />
        <span>Flow along path</span>
      </label>
      <p className="mt-1 text-[11px] text-ink-500">
        Sigil text, oath captions, level bars — text follows an SVG path inside the layer
        bounds.
      </p>

      {enabled && (
        <div className="mt-3 space-y-2">
          <Field label="Path data" hint="SVG `d` string in layer-local coords.">
            <TextArea
              value={layer.pathData ?? ""}
              onChange={(v) => patch({ pathData: v.trim() === "" ? null : v } as Partial<Layer>)}
            />
          </Field>
          <Row>
            <Field label="Side">
              <Select
                value={layer.pathSide ?? "left"}
                options={["left", "right"]}
                onChange={(v) =>
                  patch({ pathSide: v as "left" | "right" } as Partial<Layer>)
                }
              />
            </Field>
            <Field label="Start %" hint="Offset along path; 0–100.">
              <NumberInput
                value={layer.pathStartOffset ?? 0}
                onChange={(v) =>
                  patch({
                    pathStartOffset: Math.max(0, Math.min(100, v)),
                  } as Partial<Layer>)
                }
              />
            </Field>
          </Row>
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => patch({ pathData: p.build() } as Partial<Layer>)}
                className="rounded border border-ink-700 bg-ink-900 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-300 hover:bg-ink-800"
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-ink-500">
            Presets recompute against the current layer size (
            <span className="text-ink-300">
              {w} × {h}
            </span>
            ) — resize the layer first, then click a preset to refit.
          </p>
        </div>
      )}
    </div>
  );
}

function ImageFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  // The picker writes both `assetId` and `src` (a fully-qualified blob URL),
  // so the canvas can render whichever happens to be there. When the user
  // clears the asset, both clear together — no half-bound state.
  //
  // Auto-apply slice + PPU metadata so frame assets "just work":
  //   • 25-slice wins over 9-slice when both are present on the asset
  //     (matches the canvas renderer's preference). We also clear the
  //     opposite slice config on the layer so a previously-picked
  //     9-slice asset doesn't leak its insets onto a 25-slice frame.
  //   • The user can override or clear either later via Inspector
  //     fields.
  const picker = useAssetPicker((asset) => {
    // Cache the freshly-picked asset so the AssetSizingFields section
    // doesn't have to re-fetch a moment later.
    _assetMetaCache.set(asset.id, asset);

    const meta = asset.metadataJson ?? {};
    const meta25 = meta.slice25;
    const meta9 = meta.slice;

    // 25-slice path. When the asset carries an 8-inset 25-slice config
    // we apply it to `slice25` AND wipe `slice` so the layer never
    // holds both — the renderer prefers 25 when both are set, but
    // keeping the dead-9-slice around would confuse the Inspector.
    let slicePatch: Partial<Layer> = {};
    if (meta25 && typeof meta25 === "object") {
      slicePatch = {
        slice25: {
          outerTop: Number(meta25.outerTop) || 0,
          outerRight: Number(meta25.outerRight) || 0,
          outerBottom: Number(meta25.outerBottom) || 0,
          outerLeft: Number(meta25.outerLeft) || 0,
          innerTop: Number(meta25.innerTop) || 0,
          innerRight: Number(meta25.innerRight) || 0,
          innerBottom: Number(meta25.innerBottom) || 0,
          innerLeft: Number(meta25.innerLeft) || 0,
        },
        slice: null,
      } as Partial<Layer>;
    } else if (meta9 && typeof meta9 === "object") {
      // 9-slice path — same as before, but now also clear any stale
      // 25-slice on the layer so the configs can't bleed into each
      // other across asset swaps.
      slicePatch = {
        slice: {
          top: Number(meta9.top) || 0,
          right: Number(meta9.right) || 0,
          bottom: Number(meta9.bottom) || 0,
          left: Number(meta9.left) || 0,
        },
        slice25: null,
      } as Partial<Layer>;
    } else {
      // Asset has no slice metadata — clear any slice carried over
      // from the previously-picked asset so we don't render a frame's
      // insets on a non-frame image.
      slicePatch = { slice: null, slice25: null } as Partial<Layer>;
    }

    patch({
      assetId: asset.id,
      src: assetBlobUrl(asset.id),
      ...slicePatch,
    } as Partial<Layer>);
  });

  return (
    <FieldGroup title="Image">
      <Field label="Asset" hint="Stored in the project's asset library.">
        <div className="space-y-2">
          {layer.assetId ? (
            <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(rgba(255,255,255,0.05)_0%_25%,transparent_0%_50%)] [background-size:8px_8px]">
                <img
                  src={assetBlobUrl(layer.assetId)}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[10px] text-ink-300">{layer.assetId}</p>
              </div>
              <button
                type="button"
                onClick={() => patch({ assetId: null, src: null } as Partial<Layer>)}
                className="rounded border border-transparent px-1.5 py-0.5 text-[10px] text-ink-300 hover:border-ink-600 hover:bg-ink-800"
                title="Detach asset"
              >
                Detach
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-ink-500">No asset bound.</p>
          )}
          <button
            type="button"
            onClick={picker.open}
            className="inline-flex items-center gap-1.5 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700"
          >
            {layer.assetId ? "Change asset…" : "Pick asset…"}
          </button>
          {picker.element}
        </div>
      </Field>
      <Field
        label="External URL"
        hint="Use to point at images outside the asset library."
      >
        <TextInput
          value={layer.assetId ? "" : layer.src ?? ""}
          placeholder={layer.assetId ? "(using asset)" : "https://…"}
          onChange={(v) =>
            patch({
              src: v.trim() === "" ? null : v,
              assetId: null, // pasting a URL detaches the asset to keep state coherent
            } as Partial<Layer>)
          }
        />
      </Field>
      <Field
        label="Fit"
        hint={
          layer.slice25
            ? "(ignored — 25-slice in use)"
            : layer.slice
              ? "(ignored — 9-slice in use)"
              : undefined
        }
      >
        <Select
          value={layer.fit}
          options={["contain", "cover", "fill", "repeat"]}
          onChange={(v) => patch({ fit: v as typeof layer.fit } as Partial<Layer>)}
        />
      </Field>
      <ImageOffsetFields layer={layer} patch={patch} />
      <ImageCropFields layer={layer} patch={patch} />
      {layer.fit === "repeat" && <ImageTileScaleFields layer={layer} patch={patch} />}
      <AssetSizingFields layer={layer} patch={patch} />
      <NineSliceFields layer={layer} patch={patch} />
      <TwentyFiveSliceFields layer={layer} patch={patch} />
    </FieldGroup>
  );
}

/**
 * Asset sizing helpers — pixels-per-unit consumers.
 *
 * When the bound asset has PPU configured (sec 20.x metadata), the user
 * can:
 *   • see the asset's natural size in source pixels and in logical units
 *   • snap the layer's bounds to the natural source size (1:1 pixel)
 *   • snap the layer's bounds to the nearest multiple of PPU
 *   • size by an integer unit count (e.g. "this layer is 4 × 6 units")
 *
 * The asset metadata is fetched lazily when this section mounts with an
 * assetId. Cached in a module-scoped Map so a card with multiple image
 * layers doesn't trigger N requests.
 */
function AssetSizingFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const meta = useAssetMeta(layer.assetId);
  if (!layer.assetId) return null;

  const ppu = meta?.metadataJson?.pixelsPerUnit;
  const naturalW = meta?.width ?? null;
  const naturalH = meta?.height ?? null;

  const setBounds = (w: number, h: number) => {
    patch({
      bounds: { ...layer.bounds, width: Math.round(w), height: Math.round(h) },
    } as Partial<Layer>);
  };

  const widthInUnits = ppu && ppu > 0 ? layer.bounds.width / ppu : null;
  const heightInUnits = ppu && ppu > 0 ? layer.bounds.height / ppu : null;

  return (
    <Field label="Asset sizing" hint="Sized off the bound asset's metadata.">
      <div className="space-y-2 rounded border border-ink-700 bg-ink-900/40 p-2">
        {meta === null ? (
          <p className="text-[11px] text-ink-500">Loading asset…</p>
        ) : meta === undefined ? (
          <p className="text-[11px] text-ink-500">Asset not found.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 font-mono text-[10px] text-ink-400">
              <span>
                Source:{" "}
                <span className="text-ink-200">
                  {naturalW && naturalH ? `${naturalW} × ${naturalH} px` : "—"}
                </span>
              </span>
              <span>
                PPU:{" "}
                <span className="text-ink-200">{ppu && ppu > 0 ? ppu : "unset"}</span>
              </span>
            </div>
            {ppu && ppu > 0 && widthInUnits !== null && heightInUnits !== null && (
              <p className="font-mono text-[10px] text-ink-400">
                Layer in units:{" "}
                <span className="text-ink-200">
                  {widthInUnits.toFixed(2)} × {heightInUnits.toFixed(2)} u
                </span>
              </p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {naturalW != null && naturalH != null && (
                <button
                  type="button"
                  title="Resize the layer to the asset's natural pixel size."
                  onClick={() => setBounds(naturalW, naturalH)}
                  className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700"
                >
                  Natural size
                </button>
              )}
              {ppu && ppu > 0 && (
                <button
                  type="button"
                  title="Round width / height to nearest multiple of PPU."
                  onClick={() => {
                    const w = Math.max(ppu, Math.round(layer.bounds.width / ppu) * ppu);
                    const h = Math.max(ppu, Math.round(layer.bounds.height / ppu) * ppu);
                    setBounds(w, h);
                  }}
                  className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700"
                >
                  Snap to PPU
                </button>
              )}
              {ppu && ppu > 0 && naturalW != null && naturalH != null && (
                <>
                  <button
                    type="button"
                    title="Resize layer to 2× the natural unit count."
                    onClick={() => setBounds(naturalW * 2, naturalH * 2)}
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700"
                  >
                    2×
                  </button>
                  <button
                    type="button"
                    title="Resize layer to 4× the natural unit count."
                    onClick={() => setBounds(naturalW * 4, naturalH * 4)}
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-100 hover:bg-ink-700"
                  >
                    4×
                  </button>
                </>
              )}
            </div>
            {(ppu == null || ppu <= 0) && (
              <p className="text-[10px] text-ink-500">
                Set Pixels Per Unit on the asset (Assets view → Edit) to enable PPU snapping.
              </p>
            )}
          </>
        )}
      </div>
    </Field>
  );
}

/**
 * Project-scoped asset metadata cache. The hook returns:
 *   • `null`   — fetching in progress
 *   • `undefined` — asset not found / load failed
 *   • Asset    — fresh metadata from the API
 *
 * The cache is keyed by assetId. We invalidate when the assetId changes
 * (i.e. the user re-picks). Stale data after an external edit is
 * acceptable — the user can detach + re-pick to refresh, and the asset
 * editor's own save flow stays authoritative for the source of truth.
 */
const _assetMetaCache = new Map<string, Asset>();
function useAssetMeta(assetId: string | null): Asset | null | undefined {
  const [data, setData] = useState<Asset | null | undefined>(null);
  useEffect(() => {
    if (!assetId) {
      setData(undefined);
      return;
    }
    const cached = _assetMetaCache.get(assetId);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setData(null);
    void apiGetAsset(assetId)
      .then((asset) => {
        if (cancelled) return;
        _assetMetaCache.set(assetId, asset);
        setData(asset);
      })
      .catch(() => {
        if (cancelled) return;
        setData(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  return data;
}

/**
 * Pan offset in destination pixels — applied AFTER fit. Positive X moves
 * the image right, positive Y moves it down. Useful for nudging "cover"-
 * fitted art so the focal point lands where the user wants without having
 * to re-crop the source.
 */
function ImageOffsetFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const ox = layer.offset?.x ?? 0;
  const oy = layer.offset?.y ?? 0;
  const set = (next: { x?: number; y?: number }) => {
    const merged = { x: ox, y: oy, ...next };
    // Treat 0,0 as "unset" so the JSON stays clean — the renderer
    // already defaults missing offsets to zero.
    if (merged.x === 0 && merged.y === 0) {
      patch({ offset: undefined } as Partial<Layer>);
    } else {
      patch({ offset: merged } as Partial<Layer>);
    }
  };
  return (
    <Field label="Offset (px)" hint="Pan the image inside its bounds.">
      <div className="grid grid-cols-2 gap-2">
        <NumberInputLabeled label="X" value={ox} onChange={(v) => set({ x: v })} />
        <NumberInputLabeled label="Y" value={oy} onChange={(v) => set({ y: v })} />
      </div>
    </Field>
  );
}

/**
 * Source-image crop rectangle. Toggling on starts with a sensible default
 * (left/top = 0, width/height = the asset's natural dimensions if known,
 * else 1024×1024 — the renderer clamps anyway). Toggling off removes the
 * crop entirely so the layer goes back to using the full image.
 */
function ImageCropFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const enabled = layer.crop != null;
  const c = layer.crop ?? { x: 0, y: 0, width: 256, height: 256 };
  const setCrop = (next: Partial<typeof c>) => {
    patch({ crop: { ...c, ...next } } as Partial<Layer>);
  };

  // Lazy-fetch the layer's asset so we can detect sprite-sheet
  // metadata and offer the cell picker. Only runs when an assetId is
  // bound; refetches when the binding changes.
  const [asset, setAsset] = useState<Asset | null>(null);
  const [pickingCell, setPickingCell] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!layer.assetId) {
      setAsset(null);
      return;
    }
    apiGetAsset(layer.assetId)
      .then((a) => {
        if (alive) setAsset(a);
      })
      .catch(() => {
        if (alive) setAsset(null);
      });
    return () => {
      alive = false;
    };
  }, [layer.assetId]);
  const isSheet = Boolean(
    (asset?.metadataJson as { sheet?: unknown } | null)?.sheet,
  );

  return (
    <Field
      label="Source crop"
      hint="Use only a region of the source image (e.g. a sprite cell)."
    >
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              if (!e.target.checked) {
                patch({ crop: null } as Partial<Layer>);
              } else {
                patch({ crop: c } as Partial<Layer>);
              }
            }}
            className="h-3 w-3 cursor-pointer accent-accent-500"
          />
          <span>{enabled ? "Cropping" : "Use full image"}</span>
        </label>
        {isSheet && (
          <div className="rounded border border-accent-500/30 bg-accent-500/5 p-2 text-[11px] text-ink-300">
            <p>
              This asset is a spritesheet — pick a cell to populate the crop
              automatically.
            </p>
            <button
              type="button"
              onClick={() => setPickingCell(true)}
              className="mt-1 rounded border border-accent-500/40 bg-accent-500/15 px-2 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25"
            >
              {enabled ? "Change cell" : "Pick a cell"}
            </button>
          </div>
        )}
        {enabled && (
          <div className="grid grid-cols-2 gap-2">
            <NumberInputLabeled label="X" value={c.x} onChange={(v) => setCrop({ x: v })} />
            <NumberInputLabeled label="Y" value={c.y} onChange={(v) => setCrop({ y: v })} />
            <NumberInputLabeled
              label="W"
              value={c.width}
              onChange={(v) => setCrop({ width: Math.max(1, v) })}
            />
            <NumberInputLabeled
              label="H"
              value={c.height}
              onChange={(v) => setCrop({ height: Math.max(1, v) })}
            />
          </div>
        )}
      </div>
      <SpriteCellPicker
        asset={asset}
        open={pickingCell}
        onClose={() => setPickingCell(false)}
        onPick={(ref) => {
          // Translate the picker's {x,y,w,h} into the layer's crop
          // shape ({x,y,width,height}). Same data, different field names.
          patch({
            crop: { x: ref.x, y: ref.y, width: ref.w, height: ref.h },
          } as Partial<Layer>);
        }}
      />
    </Field>
  );
}

/**
 * Tile size multiplier when fit === "repeat". 1 = natural source size;
 * smaller → smaller (denser) tiles; larger → bigger tiles.
 */
function ImageTileScaleFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const sx = layer.tileScale?.x ?? 1;
  const sy = layer.tileScale?.y ?? 1;
  const set = (next: { x?: number; y?: number }) => {
    const merged = { x: sx, y: sy, ...next };
    patch({ tileScale: merged } as Partial<Layer>);
  };
  return (
    <Field label="Tile scale" hint="Multiplier on tile size; 1 = natural.">
      <div className="grid grid-cols-2 gap-2">
        <NumberInputLabeled
          label="X"
          step={0.1}
          value={sx}
          onChange={(v) => set({ x: Math.max(0.05, v) })}
        />
        <NumberInputLabeled
          label="Y"
          step={0.1}
          value={sy}
          onChange={(v) => set({ y: Math.max(0.05, v) })}
        />
      </div>
    </Field>
  );
}

/**
 * Compact labelled number input — used by the offset / crop / tile-scale
 * sections so each pair of X/Y inputs share the same look without two
 * <Field>s competing for one row.
 */
function NumberInputLabeled({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900 pl-2">
      <span className="text-[10px] uppercase tracking-wider text-ink-400">{label}</span>
      <input
        type="number"
        step={step ?? 1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") return;
          const n = Number(v);
          if (Number.isFinite(n)) onChange(step ? n : Math.round(n));
        }}
        className="block w-full rounded-r border-l border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
      />
    </label>
  );
}

function NineSliceFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const slice = layer.slice ?? null;
  const enabled = !!slice;

  function setSlice(next: NineSlice | null) {
    patch({ slice: next } as Partial<Layer>);
  }

  function setInset(key: keyof NineSlice, value: number) {
    if (!slice) return;
    setSlice({ ...slice, [key]: Math.max(0, Math.round(value)) });
  }

  return (
    <div className="rounded border border-ink-700 bg-ink-900/40 p-2">
      <Toggle
        label="9-slice"
        checked={enabled}
        onChange={(v) =>
          setSlice(v ? { top: 24, right: 24, bottom: 24, left: 24 } : null)
        }
      />
      {enabled && slice && (
        <>
          <p className="mt-1.5 text-[10px] text-ink-500">
            Insets are in <em>source-image</em> px. Corners stay at their original
            size; edges and center stretch.
          </p>

          <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <NineSlicePreview slice={slice} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Top">
                <NumberInput
                  value={slice.top}
                  min={0}
                  onChange={(v) => setInset("top", v)}
                />
              </Field>
              <Field label="Right">
                <NumberInput
                  value={slice.right}
                  min={0}
                  onChange={(v) => setInset("right", v)}
                />
              </Field>
              <Field label="Bottom">
                <NumberInput
                  value={slice.bottom}
                  min={0}
                  onChange={(v) => setInset("bottom", v)}
                />
              </Field>
              <Field label="Left">
                <NumberInput
                  value={slice.left}
                  min={0}
                  onChange={(v) => setInset("left", v)}
                />
              </Field>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Tiny visual indicator showing the four slice lines on a card-shaped frame. */
function NineSlicePreview({ slice }: { slice: NineSlice }) {
  // The preview is purely indicative — it shows where the cuts land in
  // proportion to the maximum inset (capped at 50% of the box).
  const W = 64;
  const H = 64;
  const cap = 30; // cap insets to keep the preview readable
  const t = Math.min(cap, slice.top);
  const r = Math.min(cap, slice.right);
  const b = Math.min(cap, slice.bottom);
  const l = Math.min(cap, slice.left);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 rounded border border-ink-700 bg-ink-900"
      aria-hidden="true"
    >
      {/* Card outline */}
      <rect x="2" y="2" width={W - 4} height={H - 4} fill="none" stroke="#3a4258" strokeWidth="1" />
      {/* Slice lines */}
      <line
        x1={2}
        x2={W - 2}
        y1={2 + t}
        y2={2 + t}
        stroke="#d4a24c"
        strokeWidth="1"
        strokeDasharray="2 1"
      />
      <line
        x1={2}
        x2={W - 2}
        y1={H - 2 - b}
        y2={H - 2 - b}
        stroke="#d4a24c"
        strokeWidth="1"
        strokeDasharray="2 1"
      />
      <line
        x1={2 + l}
        x2={2 + l}
        y1={2}
        y2={H - 2}
        stroke="#d4a24c"
        strokeWidth="1"
        strokeDasharray="2 1"
      />
      <line
        x1={W - 2 - r}
        x2={W - 2 - r}
        y1={2}
        y2={H - 2}
        stroke="#d4a24c"
        strokeWidth="1"
        strokeDasharray="2 1"
      />
      {/* Corner markers */}
      <rect x="2" y="2" width={l} height={t} fill="rgba(212,162,76,0.18)" />
      <rect x={W - 2 - r} y="2" width={r} height={t} fill="rgba(212,162,76,0.18)" />
      <rect x="2" y={H - 2 - b} width={l} height={b} fill="rgba(212,162,76,0.18)" />
      <rect x={W - 2 - r} y={H - 2 - b} width={r} height={b} fill="rgba(212,162,76,0.18)" />
    </svg>
  );
}

/**
 * 25-slice editor — sibling of NineSliceFields with 8 inputs (outer +
 * inner per side). Toggling it on auto-promotes from the layer's
 * existing 9-slice by mapping `top → outerTop = innerTop`, etc., so
 * the user can start from familiar values and split them apart.
 * Enabling 25-slice clears the 9-slice config since the renderer
 * picks 25-slice over 9 when both are set (clearing avoids stale
 * data lingering in storage).
 */
function TwentyFiveSliceFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "image" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  const slice = layer.slice25 ?? null;
  const enabled = !!slice;

  function setSlice(next: TwentyFiveSlice | null) {
    if (next) {
      // Enabling 25-slice clears 9-slice so we don't store both.
      patch({ slice25: next, slice: null } as Partial<Layer>);
    } else {
      patch({ slice25: null } as Partial<Layer>);
    }
  }

  function promoteFromNineSlice(): TwentyFiveSlice {
    // Pull outer band widths from the existing 9-slice if present,
    // otherwise fall back to 16px. Inner band starts one step inside
    // the outer (3/2 default) so the user immediately sees a sensible
    // two-band split rather than zeros everywhere.
    const n = layer.slice ?? { top: 16, right: 16, bottom: 16, left: 16 };
    return {
      outerTop: n.top,
      outerRight: n.right,
      outerBottom: n.bottom,
      outerLeft: n.left,
      innerTop: Math.round(n.top * 1.5),
      innerRight: Math.round(n.right * 1.5),
      innerBottom: Math.round(n.bottom * 1.5),
      innerLeft: Math.round(n.left * 1.5),
    };
  }

  function setInset(key: keyof TwentyFiveSlice, value: number) {
    if (!slice) return;
    const next = { ...slice, [key]: Math.max(0, Math.round(value)) };
    // Inner must be ≥ outer on the same side. If the user drags inner
    // below outer (or outer above inner), nudge the partner so they
    // don't end up with an invalid config that the renderer refuses.
    if (key === "outerTop" && next.outerTop > next.innerTop) next.innerTop = next.outerTop;
    if (key === "outerRight" && next.outerRight > next.innerRight) next.innerRight = next.outerRight;
    if (key === "outerBottom" && next.outerBottom > next.innerBottom) next.innerBottom = next.outerBottom;
    if (key === "outerLeft" && next.outerLeft > next.innerLeft) next.innerLeft = next.outerLeft;
    if (key === "innerTop" && next.innerTop < next.outerTop) next.outerTop = next.innerTop;
    if (key === "innerRight" && next.innerRight < next.outerRight) next.outerRight = next.innerRight;
    if (key === "innerBottom" && next.innerBottom < next.outerBottom) next.outerBottom = next.innerBottom;
    if (key === "innerLeft" && next.innerLeft < next.outerLeft) next.outerLeft = next.innerLeft;
    setSlice(next);
  }

  return (
    <div className="rounded border border-ink-700 bg-ink-900/40 p-2">
      <Toggle
        label="25-slice"
        checked={enabled}
        onChange={(v) => setSlice(v ? promoteFromNineSlice() : null)}
      />
      {enabled && slice && (
        <>
          <p className="mt-1.5 text-[10px] text-ink-500">
            Two cuts per side. 4 outer corners + 4 mid-edge centers
            stay static; inner stripes + the dead center stretch. Use
            for frames with decorative corners and plain straight
            rails between them.
          </p>
          <div className="mb-2 grid grid-cols-2 gap-2">
            <Field label="Max X" hint="0 = no cap. Caps stripe width in destination px; additional ornaments tile.">
              <NumberInput
                value={slice.maxStretchX ?? 0}
                min={0}
                onChange={(v) => setSlice({ ...slice, maxStretchX: Math.max(0, Math.round(v)) })}
              />
            </Field>
            <Field label="Max Y" hint="0 = no cap.">
              <NumberInput
                value={slice.maxStretchY ?? 0}
                min={0}
                onChange={(v) => setSlice({ ...slice, maxStretchY: Math.max(0, Math.round(v)) })}
              />
            </Field>
          </div>

          <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-3">
            <TwentyFiveSlicePreview slice={slice} />
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-ink-500">Top</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Outer">
                  <NumberInput
                    value={slice.outerTop}
                    min={0}
                    onChange={(v) => setInset("outerTop", v)}
                  />
                </Field>
                <Field label="Inner">
                  <NumberInput
                    value={slice.innerTop}
                    min={0}
                    onChange={(v) => setInset("innerTop", v)}
                  />
                </Field>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-ink-500">Right</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Outer">
                  <NumberInput
                    value={slice.outerRight}
                    min={0}
                    onChange={(v) => setInset("outerRight", v)}
                  />
                </Field>
                <Field label="Inner">
                  <NumberInput
                    value={slice.innerRight}
                    min={0}
                    onChange={(v) => setInset("innerRight", v)}
                  />
                </Field>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-ink-500">Bottom</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Outer">
                  <NumberInput
                    value={slice.outerBottom}
                    min={0}
                    onChange={(v) => setInset("outerBottom", v)}
                  />
                </Field>
                <Field label="Inner">
                  <NumberInput
                    value={slice.innerBottom}
                    min={0}
                    onChange={(v) => setInset("innerBottom", v)}
                  />
                </Field>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-ink-500">Left</p>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Outer">
                  <NumberInput
                    value={slice.outerLeft}
                    min={0}
                    onChange={(v) => setInset("outerLeft", v)}
                  />
                </Field>
                <Field label="Inner">
                  <NumberInput
                    value={slice.innerLeft}
                    min={0}
                    onChange={(v) => setInset("innerLeft", v)}
                  />
                </Field>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 25-slice mini-preview — paints the 5×5 grid with the fixed cells
 * highlighted (4 outer corners + 4 inner corners + dead center) and
 * the stretch cells left blank. The outer + inner cut lines are
 * dashed so the user can see where each pair lives relative to the
 * frame edge. Proportional, not pixel-accurate; just a quick visual
 * confirmation that the values look right.
 */
function TwentyFiveSlicePreview({ slice }: { slice: TwentyFiveSlice }) {
  const W = 84;
  const H = 84;
  const cap = 30; // cap each inset so the preview stays readable
  const ot = Math.min(cap, slice.outerTop);
  const it = Math.min(cap, slice.innerTop);
  const or = Math.min(cap, slice.outerRight);
  const ir = Math.min(cap, slice.innerRight);
  const ob = Math.min(cap, slice.outerBottom);
  const ib = Math.min(cap, slice.innerBottom);
  const ol = Math.min(cap, slice.outerLeft);
  const il = Math.min(cap, slice.innerLeft);

  // Compute column / row pixel positions for each of the 5 bands.
  const xs = [2, 2 + ol, 2 + il, W - 2 - ir, W - 2 - or, W - 2];
  const ys = [2, 2 + ot, 2 + it, H - 2 - ib, H - 2 - ob, H - 2];

  // Static cells (drawn at source size, never stretched): 4 outer
  // corners + 4 mid-edge centers. The dead center (2,2) stretches.
  const fixedCells: Array<[number, number]> = [
    [0, 0], [0, 2], [0, 4],
    [2, 0],         [2, 4],
    [4, 0], [4, 2], [4, 4],
  ];

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="shrink-0 rounded border border-ink-700 bg-ink-900"
      aria-hidden="true"
    >
      {/* Card outline */}
      <rect
        x="2"
        y="2"
        width={W - 4}
        height={H - 4}
        fill="none"
        stroke="#3a4258"
        strokeWidth="1"
      />
      {/* Fixed-cell highlights */}
      {fixedCells.map(([r, c]) => {
        const x = xs[c];
        const y = ys[r];
        const w = Math.max(0, xs[c + 1] - x);
        const h = Math.max(0, ys[r + 1] - y);
        return (
          <rect
            key={`${r}-${c}`}
            x={x}
            y={y}
            width={w}
            height={h}
            fill="rgba(212,162,76,0.18)"
          />
        );
      })}
      {/* Outer cut lines — dashed */}
      {[ot, H - 2 - ob].map((y, i) => (
        <line
          key={`outerY-${i}`}
          x1={2}
          x2={W - 2}
          y1={y === H - 2 - ob ? y : 2 + y}
          y2={y === H - 2 - ob ? y : 2 + y}
          stroke="#d4a24c"
          strokeWidth="1"
          strokeDasharray="3 2"
        />
      ))}
      {[ol, W - 2 - or].map((x, i) => (
        <line
          key={`outerX-${i}`}
          x1={x === W - 2 - or ? x : 2 + x}
          x2={x === W - 2 - or ? x : 2 + x}
          y1={2}
          y2={H - 2}
          stroke="#d4a24c"
          strokeWidth="1"
          strokeDasharray="3 2"
        />
      ))}
      {/* Inner cut lines — thinner dashes */}
      <line
        x1={2}
        x2={W - 2}
        y1={2 + it}
        y2={2 + it}
        stroke="#ebd198"
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />
      <line
        x1={2}
        x2={W - 2}
        y1={H - 2 - ib}
        y2={H - 2 - ib}
        stroke="#ebd198"
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />
      <line
        x1={2 + il}
        x2={2 + il}
        y1={2}
        y2={H - 2}
        stroke="#ebd198"
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />
      <line
        x1={W - 2 - ir}
        x2={W - 2 - ir}
        y1={2}
        y2={H - 2}
        stroke="#ebd198"
        strokeWidth="0.5"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

function ZoneFields({
  layer,
  patch,
}: {
  layer: Extract<Layer, { type: "zone" }>;
  patch: (p: Partial<Layer>) => void;
}) {
  return (
    <FieldGroup title="Zone (data-bound)">
      <Field label="Field key" hint="Schema field this zone binds to (e.g. name, cost, rules_text).">
        <TextInput
          value={layer.fieldKey}
          onChange={(v) => patch({ fieldKey: v.replace(/\s+/g, "_") } as Partial<Layer>)}
        />
      </Field>
      <Field label="Binding">
        <Select
          value={layer.binding}
          options={["text", "richText", "number", "image", "icon", "stat"]}
          onChange={(v) => patch({ binding: v as typeof layer.binding } as Partial<Layer>)}
        />
      </Field>
      <Field label="Placeholder">
        <TextInput
          value={layer.placeholder}
          onChange={(v) => patch({ placeholder: v } as Partial<Layer>)}
        />
      </Field>
      <Field label="Font family">
        <TextInput
          value={layer.fontFamily}
          onChange={(v) => patch({ fontFamily: v } as Partial<Layer>)}
        />
      </Field>
      <Row>
        <Field label="Size">
          <NumberInput
            value={layer.fontSize}
            min={1}
            onChange={(v) => patch({ fontSize: Math.max(1, v) } as Partial<Layer>)}
          />
        </Field>
        <Field label="Align">
          <Select
            value={layer.align}
            options={["left", "center", "right"]}
            onChange={(v) => patch({ align: v as typeof layer.align } as Partial<Layer>)}
          />
        </Field>
      </Row>
      <Field label="Color">
        <ColorInput value={layer.fill} onChange={(v) => patch({ fill: v } as Partial<Layer>)} />
      </Field>
    </FieldGroup>
  );
}

/* ---------------------------------------------------------------------- */
/* Page Setup — shown when no layer is selected (sec 19.3)                */
/* ---------------------------------------------------------------------- */
//
// Editor for the template's print-side metadata: physical size, bleed,
// safe zone, DPI, background. These drive the canvas guides and the
// PDF print export.
//
// Each field commits one history step on change so the user can undo
// their way back through experiments. We don't debounce — these
// updates are cheap and the canvas redraws in one frame.

const COMMON_SIZES: Array<{
  label: string;
  width: number;
  height: number;
  dpi: number;
}> = [
  // 2.5" × 3.5" — standard poker / TCG size
  { label: 'Poker · 2.5" × 3.5" @ 300dpi', width: 750, height: 1050, dpi: 300 },
  { label: 'Poker · 2.5" × 3.5" @ 600dpi', width: 1500, height: 2100, dpi: 600 },
  // 2.75" × 3.75" — bridge / Magic
  { label: 'Bridge · 2.75" × 3.75" @ 300dpi', width: 825, height: 1125, dpi: 300 },
  // 2.25" × 3.5" — Tarot
  { label: 'Tarot · 2.25" × 3.5" @ 300dpi', width: 675, height: 1050, dpi: 300 },
  // 70 × 120 mm — Saga: Tales Unchained
  { label: 'Mini · 63 × 88 mm @ 300dpi', width: 744, height: 1039, dpi: 300 },
  // Square format
  { label: "Square 1024² @ 300dpi", width: 1024, height: 1024, dpi: 300 },
];

function PageSetupPanel() {
  const template = useDesigner((s) => s.template);
  const patchMeta = useDesigner((s) => s.patchTemplateMeta);
  const overlays = useDesigner((s) => s.overlays);
  const toggleOverlay = useDesigner((s) => s.toggleOverlay);

  const dpi = template.dpi ?? 300;

  function applyPreset(idx: number) {
    const p = COMMON_SIZES[idx];
    if (!p) return;
    patchMeta({ size: { width: p.width, height: p.height }, dpi: p.dpi });
  }

  // Convert px → inches for the live readout. We round to 2 decimals
  // because exact fractional inches don't add information at this scale.
  const inchW = (template.size.width / dpi).toFixed(2);
  const inchH = (template.size.height / dpi).toFixed(2);
  const mmW = ((template.size.width / dpi) * 25.4).toFixed(1);
  const mmH = ((template.size.height / dpi) * 25.4).toFixed(1);

  // Quick warnings inline so the user catches issues without opening
  // the validation panel.
  const lowDpi = dpi < 250;
  const noBleed = template.bleed === 0;
  const safeOverlap = template.safeZone * 2 >= Math.min(template.size.width, template.size.height);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Page setup" subtitle="card type" />
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <FieldGroup title="Identity">
          <Field label="Name">
            <TextInput
              value={template.name}
              onChange={(v) => patchMeta({ name: v })}
            />
          </Field>
          <Field label="Description">
            <TextInput
              value={template.description}
              onChange={(v) => patchMeta({ description: v })}
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Size + DPI">
          <Field label="Preset">
            <select
              onChange={(e) => {
                const idx = Number(e.target.value);
                if (Number.isFinite(idx) && idx >= 0) applyPreset(idx);
              }}
              defaultValue="-1"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 focus:border-accent-500/60"
            >
              <option value="-1">Apply preset…</option>
              {COMMON_SIZES.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Row>
            <Field label="Width (px)">
              <NumberInput
                value={template.size.width}
                min={1}
                onChange={(v) =>
                  patchMeta({
                    size: { width: v, height: template.size.height },
                  })
                }
              />
            </Field>
            <Field label="Height (px)">
              <NumberInput
                value={template.size.height}
                min={1}
                onChange={(v) =>
                  patchMeta({
                    size: { width: template.size.width, height: v },
                  })
                }
              />
            </Field>
          </Row>
          <Field label="DPI" hint={`= ${inchW}″ × ${inchH}″ · ${mmW} × ${mmH} mm`}>
            <NumberInput
              value={dpi}
              min={72}
              onChange={(v) => patchMeta({ dpi: v })}
            />
          </Field>
          {lowDpi && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
              DPI is below 250 — print output may look blurry. 300 is the
              industry minimum for cards.
            </p>
          )}
        </FieldGroup>

        <FieldGroup title="Bleed + safe zone">
          <Row>
            <Field label="Bleed (px)" hint={`${(template.bleed / dpi * 25.4).toFixed(1)} mm`}>
              <NumberInput
                value={template.bleed}
                min={0}
                onChange={(v) => patchMeta({ bleed: v })}
              />
            </Field>
            <Field
              label="Safe zone (px)"
              hint={`${(template.safeZone / dpi * 25.4).toFixed(1)} mm`}
            >
              <NumberInput
                value={template.safeZone}
                min={0}
                onChange={(v) => patchMeta({ safeZone: v })}
              />
            </Field>
          </Row>
          {noBleed && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300">
              No bleed — printers usually require at least 36px (3 mm at 300dpi).
            </p>
          )}
          {safeOverlap && (
            <p className="rounded border border-danger-500/40 bg-danger-500/10 px-2 py-1 text-[10px] text-danger-400">
              Safe zone is wider than half the card — content has nowhere to live.
            </p>
          )}
        </FieldGroup>

        <FieldGroup title="Background">
          <Field label="Color">
            <input
              type="color"
              value={template.background || "#000000"}
              onChange={(e) => patchMeta({ background: e.target.value })}
              className="h-7 w-full rounded border border-ink-700 bg-ink-900"
            />
          </Field>
        </FieldGroup>

        <FieldGroup title="Canvas overlays">
          <ToggleRow
            label="Bleed guide"
            on={overlays.bleed}
            onClick={() => toggleOverlay("bleed")}
          />
          <ToggleRow
            label="Safe zone"
            on={overlays.safeZone}
            onClick={() => toggleOverlay("safeZone")}
          />
          <ToggleRow
            label="Grid"
            on={overlays.grid}
            onClick={() => toggleOverlay("grid")}
          />
        </FieldGroup>

        <p className="text-[10px] text-ink-500">
          Pick a layer to edit its properties. The canvas reflects these
          values immediately, and the PDF print export uses them for crop
          marks.
        </p>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center justify-between rounded border px-2 py-1 text-xs",
        on
          ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
          : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="text-[10px] uppercase tracking-wider">
        {on ? "on" : "off"}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/* Primitives                                                             */
/* ---------------------------------------------------------------------- */

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-ink-700 px-3 py-2">
      <h2 className="text-[11px] uppercase tracking-wider text-ink-400">{title}</h2>
      {subtitle && (
        <span className="text-[10px] uppercase tracking-wider text-accent-300">{subtitle}</span>
      )}
    </div>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2 rounded border border-ink-700 bg-ink-800/40 p-2">
      <legend className="px-1 text-[10px] uppercase tracking-wider text-ink-400">{title}</legend>
      {children}
    </fieldset>
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

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function TextArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <textarea
      value={value}
      rows={3}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full resize-y rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step ?? 1}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") return; // ignore mid-edit empty value
        const n = Number(v);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    />
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={normalizeHex(value)}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-ink-700 bg-ink-900 p-0.5"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block flex-1 rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
      />
    </div>
  );
}

function Select({
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
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-50 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 cursor-pointer accent-accent-500"
      />
      <span>{label}</span>
    </label>
  );
}

function ReadOnly({ value }: { value: string }) {
  return (
    <div className="block w-full select-text rounded border border-ink-700 bg-ink-900/60 px-2 py-1 font-mono text-xs text-ink-300">
      {value}
    </div>
  );
}

/** Coerce common color strings into a `#rrggbb` hex that <input type=color> accepts. */
function normalizeHex(input: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(input)) return input;
  if (/^#[0-9a-fA-F]{3}$/.test(input)) {
    const [, r, g, b] = input.match(/#(.)(.)(.)/) ?? [];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  // Anything else (rgba, hsl, named) — fall back to black so the picker has a value.
  return "#000000";
}
