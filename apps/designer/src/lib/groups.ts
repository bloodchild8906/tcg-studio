import type { Layer } from "@/types";
import { evaluateApplies } from "@/lib/variants";

/**
 * Walk a layer's ancestor groups and return true if any of them either:
 *   • has `visible === false`, or
 *   • has an `appliesWhen` rule that the current data fails to match.
 *
 * Used by every renderer to honor group-level visibility and variant
 * gates: hiding a group hides all its children; a group with a rule
 * "faction == Fire" cascades that rule to every descendant layer.
 *
 * The `layers` argument is the flat array — group structure is derived
 * via `parentId`. Walks at most O(depth) per call; depth is bounded by
 * how many groups the user nests, typically 1–3.
 */
export function parentVisibilityGated(
  layer: Layer,
  layers: Layer[],
  data: Record<string, unknown>,
): boolean {
  let parentId = layer.parentId ?? null;
  // Index for O(1) parent lookup. Building a Map per render is fine
  // — `template.layers` is short and React's reconciliation already
  // forces this into a hot path.
  const byId = new Map<string, Layer>();
  for (const l of layers) byId.set(l.id, l);
  while (parentId) {
    const parent: Layer | undefined = byId.get(parentId);
    if (!parent) return false; // dangling parent ref — render anyway
    if (parent.type !== "group") return false; // shouldn't happen, but be safe
    if (!parent.visible) return true;
    if (!evaluateApplies(parent.appliesWhen, data)) return true;
    parentId = parent.parentId ?? null;
  }
  return false;
}

/**
 * Build a parent → children map for the LayerTree's hierarchical render.
 * Top-level entries live under the special key `"__root__"`. Order is
 * preserved per parent (matches the source array order), which keeps
 * z-order semantics intact: index 0 is bottom-most within its parent.
 */
export function groupChildren(
  layers: Layer[],
): Map<string, Layer[]> {
  const map = new Map<string, Layer[]>();
  for (const l of layers) {
    const key = l.parentId ?? "__root__";
    const arr = map.get(key);
    if (arr) arr.push(l);
    else map.set(key, [l]);
  }
  return map;
}
