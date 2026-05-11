/**
 * Template validation.
 *
 * Pure function — no React, no canvas — so it can run anywhere (panel, save
 * action, future server-side check). Returns a list of issues sorted by
 * severity then by layer.
 *
 * Severity ladder:
 *   error    — definitely wrong; export should refuse.
 *   warning  — probably wrong; export should warn.
 *   info     — heads-up; never blocks.
 *
 * The checks here are a starter set — spec sec 33 lists many more. We add
 * coverage as we add features (variant rules, asset library, schema engine).
 */

import type {
  CardTypeTemplate,
  Layer,
  LayerId,
  ZoneLayer,
} from "@/types";

export type IssueSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  /** Stable id for React keys. Built from rule + layerId so it dedupes naturally. */
  id: string;
  severity: IssueSeverity;
  rule: string;
  message: string;
  /** Layer the issue points at — null for template-level issues. */
  layerId: LayerId | null;
}

const MIN_DIMENSION = 5;
const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function validateTemplate(template: CardTypeTemplate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // ----- per-layer checks -----
  const seenZoneFieldKeys = new Map<string, ZoneLayer[]>();

  for (const layer of template.layers) {
    issues.push(...checkLayerBounds(layer, template));
    issues.push(...checkLayerSize(layer));
    issues.push(...checkOpacity(layer));
    issues.push(...checkAppliesWhen(layer));

    if (layer.type === "zone") {
      issues.push(...checkZone(layer));
      const list = seenZoneFieldKeys.get(layer.fieldKey) ?? [];
      list.push(layer);
      seenZoneFieldKeys.set(layer.fieldKey, list);
    }

    if (layer.type === "image") {
      if (layer.assetId === null && (layer.src === null || layer.src === "")) {
        issues.push({
          id: `image-empty:${layer.id}`,
          severity: "info",
          rule: "image_empty",
          message: `"${layer.name}" has no asset or URL — placeholder will export.`,
          layerId: layer.id,
        });
      }
    }

    if (layer.type === "text" && !layer.wrap) {
      // Crude detection: very long text in a narrow box is likely overflowing.
      // Real overflow requires measuring against the font metrics — that lands
      // in a future check that asks the canvas for a measurement.
      const charsPerPx = 0.5; // ~2px per char at default fontSize
      const estimatedWidth = layer.text.length * layer.fontSize * charsPerPx;
      if (estimatedWidth > layer.bounds.width * 1.6) {
        issues.push({
          id: `text-overflow:${layer.id}`,
          severity: "warning",
          rule: "text_overflow",
          message: `"${layer.name}" text likely overflows (wrap is off).`,
          layerId: layer.id,
        });
      }
    }
  }

  // Duplicate field keys — only check once we have the full list.
  for (const [key, layers] of seenZoneFieldKeys) {
    if (layers.length > 1) {
      for (const l of layers) {
        issues.push({
          id: `zone-dup-key:${l.id}:${key}`,
          severity: "warning",
          rule: "zone_duplicate_field_key",
          message: `Field key "${key}" is used by ${layers.length} zones.`,
          layerId: l.id,
        });
      }
    }
  }

  // ----- template-level checks -----
  if (template.layers.length === 0) {
    issues.push({
      id: "tpl-empty",
      severity: "info",
      rule: "template_empty",
      message: "Template has no layers.",
      layerId: null,
    });
  }
  if (template.bleed < 0) {
    issues.push({
      id: "tpl-bleed-negative",
      severity: "error",
      rule: "bleed_negative",
      message: "Bleed cannot be negative.",
      layerId: null,
    });
  }
  if (template.safeZone < 0) {
    issues.push({
      id: "tpl-safe-negative",
      severity: "error",
      rule: "safe_negative",
      message: "Safe zone cannot be negative.",
      layerId: null,
    });
  }

  // ----- print-readiness checks (sec 19.3 + 33.4) -----
  //
  // These don't block the editor, but the print-export modal escalates
  // them. Bleed-zero on a card heading for production is the single
  // most common preventable issue, so we surface it as a warning.
  const dpi = template.dpi ?? 300;
  if (dpi < 150) {
    issues.push({
      id: "tpl-dpi-very-low",
      severity: "error",
      rule: "dpi_very_low",
      message: `DPI ${dpi} is too low for any print output. Industry minimum is 300.`,
      layerId: null,
    });
  } else if (dpi < 250) {
    issues.push({
      id: "tpl-dpi-low",
      severity: "warning",
      rule: "dpi_low",
      message: `DPI ${dpi} is below the 300 industry minimum — print output may look blurry.`,
      layerId: null,
    });
  }
  if (template.bleed === 0) {
    issues.push({
      id: "tpl-no-bleed",
      severity: "warning",
      rule: "no_bleed",
      message:
        "No bleed configured — most printers require ≥3mm (~36px at 300dpi).",
      layerId: null,
    });
  } else if (template.bleed > 0 && template.bleed < dpi * 0.04) {
    // Less than ~3mm at the configured DPI.
    const mm = ((template.bleed / dpi) * 25.4).toFixed(1);
    issues.push({
      id: "tpl-bleed-thin",
      severity: "warning",
      rule: "bleed_thin",
      message: `Bleed is only ${mm}mm — most printers ask for at least 3mm.`,
      layerId: null,
    });
  }
  if (template.safeZone * 2 >= Math.min(template.size.width, template.size.height)) {
    issues.push({
      id: "tpl-safe-overlap",
      severity: "error",
      rule: "safe_zone_too_wide",
      message:
        "Safe zone is wider than the card — content has nowhere to live.",
      layerId: null,
    });
  }

  return sortIssues(issues);
}

function checkLayerBounds(layer: Layer, t: CardTypeTemplate): ValidationIssue[] {
  const { x, y, width, height } = layer.bounds;
  const out: ValidationIssue[] = [];
  // Extends past the card edge but still within bleed — fine for art
  // that should bleed to the edge, escalates to error if it spills past
  // the bleed too.
  const pastBleed =
    x < -t.bleed ||
    y < -t.bleed ||
    x + width > t.size.width + t.bleed ||
    y + height > t.size.height + t.bleed;
  if (pastBleed) {
    out.push({
      id: `past-bleed:${layer.id}`,
      severity: "error",
      rule: "layer_past_bleed",
      message: `"${layer.name}" extends past the bleed edge — it will get cropped.`,
      layerId: layer.id,
    });
  } else if (
    x < 0 ||
    y < 0 ||
    x + width > t.size.width ||
    y + height > t.size.height
  ) {
    out.push({
      id: `oob:${layer.id}`,
      severity: "info",
      rule: "layer_out_of_bounds",
      message: `"${layer.name}" extends beyond the card edge (still inside bleed).`,
      layerId: layer.id,
    });
  }
  // Inside safe zone? Only meaningful when the layer is fully outside the safe
  // rect, not just a few pixels over.
  const safeOuterX = t.safeZone;
  const safeOuterY = t.safeZone;
  const safeInnerX = t.size.width - t.safeZone;
  const safeInnerY = t.size.height - t.safeZone;
  if (
    x + width <= safeOuterX ||
    y + height <= safeOuterY ||
    x >= safeInnerX ||
    y >= safeInnerY
  ) {
    out.push({
      id: `outside-safe:${layer.id}`,
      severity: "info",
      rule: "layer_outside_safe_zone",
      message: `"${layer.name}" sits outside the safe zone — may be cut at print.`,
      layerId: layer.id,
    });
  }
  return out;
}

function checkLayerSize(layer: Layer): ValidationIssue[] {
  const { width, height } = layer.bounds;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return [
      {
        id: `tiny:${layer.id}`,
        severity: "error",
        rule: "layer_too_small",
        message: `"${layer.name}" is below ${MIN_DIMENSION}×${MIN_DIMENSION}px — pick a real size.`,
        layerId: layer.id,
      },
    ];
  }
  return [];
}

function checkAppliesWhen(layer: Layer): ValidationIssue[] {
  const rule = layer.appliesWhen;
  if (!rule) return [];
  const out: ValidationIssue[] = [];
  rule.conditions.forEach((cond, i) => {
    if (!cond.field || !/^[a-z][a-z0-9_]*$/.test(cond.field)) {
      out.push({
        id: `variant-bad-field:${layer.id}:${i}`,
        severity: "warning",
        rule: "variant_field_format",
        message: `"${layer.name}" — variant condition #${i + 1} field "${cond.field}" should be lowercase + underscores.`,
        layerId: layer.id,
      });
    }
    if (
      (cond.op === "in" || cond.op === "not_in") &&
      (!Array.isArray(cond.value) || cond.value.length === 0)
    ) {
      out.push({
        id: `variant-empty-list:${layer.id}:${i}`,
        severity: "error",
        rule: "variant_list_empty",
        message: `"${layer.name}" — '${cond.op}' condition needs at least one value.`,
        layerId: layer.id,
      });
    }
    if (
      (cond.op === "equals" || cond.op === "not_equals") &&
      (cond.value === undefined || cond.value === null || cond.value === "")
    ) {
      out.push({
        id: `variant-no-value:${layer.id}:${i}`,
        severity: "info",
        rule: "variant_value_empty",
        message: `"${layer.name}" — condition ${cond.op === "equals" ? "==" : "≠"} compares to an empty value.`,
        layerId: layer.id,
      });
    }
  });
  return out;
}

function checkOpacity(layer: Layer): ValidationIssue[] {
  if (layer.opacity === 0 && layer.visible) {
    return [
      {
        id: `opacity-zero:${layer.id}`,
        severity: "info",
        rule: "layer_opacity_zero",
        message: `"${layer.name}" has opacity 0 — it's invisible. Hide it instead?`,
        layerId: layer.id,
      },
    ];
  }
  return [];
}

function checkZone(layer: ZoneLayer): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (!layer.fieldKey || layer.fieldKey.trim() === "") {
    out.push({
      id: `zone-empty-key:${layer.id}`,
      severity: "error",
      rule: "zone_field_key_empty",
      message: `"${layer.name}" has no field key — it won't bind to any data.`,
      layerId: layer.id,
    });
  } else if (!FIELD_KEY_PATTERN.test(layer.fieldKey)) {
    out.push({
      id: `zone-bad-key:${layer.id}`,
      severity: "warning",
      rule: "zone_field_key_format",
      message: `Field key "${layer.fieldKey}" should be lowercase + underscores (a-z, 0-9, _).`,
      layerId: layer.id,
    });
  }
  return out;
}

const SEVERITY_RANK: Record<IssueSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.message.localeCompare(b.message);
  });
}

export interface ValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  total: number;
}

export function summarize(issues: ValidationIssue[]): ValidationSummary {
  const summary = { errors: 0, warnings: 0, infos: 0, total: issues.length };
  for (const i of issues) {
    if (i.severity === "error") summary.errors++;
    else if (i.severity === "warning") summary.warnings++;
    else summary.infos++;
  }
  return summary;
}
