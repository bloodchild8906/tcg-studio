import { useEffect, useMemo, useState } from "react";
import type { Card } from "@/lib/apiTypes";
import { selectActiveCardType, useDesigner } from "@/store/designerStore";
import {
  exportPrintSheetPdf,
  PRINT_PROFILES,
  type PrintSheetOptions,
} from "@/lib/exportPrintSheet";
import { validateTemplate, type ValidationIssue } from "@/lib/validate";

/**
 * Print sheet PDF export modal.
 *
 * Dials in the print profile (paper, DPI, margins, gap, crop marks),
 * lets the user choose which cards to include, then triggers the
 * client-side PDF render via `exportPrintSheetPdf`. The blob is offered
 * as a download — no server round-trip.
 *
 * Why a modal here too: the print export needs more knobs than a single
 * button can carry — paper size + DPI + crop marks + footer + selection
 * subset. The modal also lets us run the heavy raster pass without
 * blocking the cards grid behind it.
 */
export function PrintSheetModal({
  open,
  onClose,
  cards,
}: {
  open: boolean;
  onClose: () => void;
  cards: Card[];
}) {
  const cardType = useDesigner(selectActiveCardType);
  const liveTemplate = useDesigner((s) => s.template);
  const [profile, setProfile] = useState<keyof typeof PRINT_PROFILES>("letter_300dpi");
  const [marginPt, setMarginPt] = useState(36);
  const [gapPt, setGapPt] = useState(9);
  const [cropMarks, setCropMarks] = useState(true);
  const [footer, setFooter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset selection / footer / busy state on open with a fresh deck.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(cards.map((c) => c.id)));
    setBusy(false);
    setError(null);
  }, [open, cards]);

  // Re-derive selectable cards when filters / cards change. We only
  // export cards whose status is releasable in production — but for the
  // playtest pipeline we let any status through. Keeping it simple here.
  const availableCards = cards;

  const toExport = useMemo(
    () => availableCards.filter((c) => selected.has(c.id)),
    [availableCards, selected],
  );

  // Pre-flight validation. We run validateTemplate once when the modal
  // opens and any time the template changes — mirrors the inline
  // Validation panel but bucketed by severity for a print-prep audience.
  const issues = useMemo<ValidationIssue[]>(
    () => (liveTemplate ? validateTemplate(liveTemplate) : []),
    [liveTemplate],
  );
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const blocked = errors.length > 0;
  const [overrideWarnings, setOverrideWarnings] = useState(false);

  // Reset the override flag whenever the modal opens fresh — the user
  // should re-acknowledge any warnings each session.
  useEffect(() => {
    if (open) setOverrideWarnings(false);
  }, [open]);

  if (!open) return null;

  const profileBase = PRINT_PROFILES[profile];

  async function run() {
    if (!liveTemplate) {
      setError("No template loaded — open the designer once to generate one.");
      return;
    }
    if (toExport.length === 0) {
      setError("Pick at least one card to print.");
      return;
    }
    if (errors.length > 0) {
      setError(
        `${errors.length} blocking issue${
          errors.length === 1 ? "" : "s"
        } — fix and try again.`,
      );
      return;
    }
    if (warnings.length > 0 && !overrideWarnings) {
      setError(
        `${warnings.length} warning${
          warnings.length === 1 ? "" : "s"
        } — acknowledge below or fix before printing.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const opts: Partial<PrintSheetOptions> = {
        ...profileBase,
        marginPt,
        gapPt,
        cropMarks,
        footer: footer.trim() || undefined,
      };
      const blob = await exportPrintSheetPdf({
        template: liveTemplate,
        cards: toExport,
        cardType: cardType ?? undefined,
        options: opts,
      });
      const url = URL.createObjectURL(blob);
      const safe = (cardType?.slug ?? "cards").replace(/[^a-z0-9_-]+/gi, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safe}.print.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusy(false);
    }
  }

  function toggleAll(next: boolean) {
    if (next) setSelected(new Set(availableCards.map((c) => c.id)));
    else setSelected(new Set());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Print sheet"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="flex h-[80vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
        <header className="flex items-start justify-between border-b border-ink-700 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-50">Print sheet (PDF)</h2>
            <p className="text-[11px] text-ink-500">
              {availableCards.length} card{availableCards.length === 1 ? "" : "s"} available — pick a subset and a paper profile.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40"
          >
            Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-[1fr_280px] overflow-hidden">
          <section className="overflow-y-auto border-r border-ink-700 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium text-ink-50">Cards</h3>
              <div className="flex items-center gap-2 text-[11px] text-ink-400">
                <button
                  type="button"
                  onClick={() => toggleAll(true)}
                  className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 hover:bg-ink-700"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => toggleAll(false)}
                  className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 hover:bg-ink-700"
                >
                  None
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {availableCards.map((c) => {
                const checked = selected.has(c.id);
                return (
                  <li
                    key={c.id}
                    onClick={() => {
                      const next = new Set(selected);
                      if (checked) next.delete(c.id);
                      else next.add(c.id);
                      setSelected(next);
                    }}
                    className={[
                      "flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-xs",
                      checked
                        ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
                        : "border-ink-800 text-ink-300 hover:border-ink-700 hover:bg-ink-800",
                    ].join(" ")}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      readOnly
                      className="h-3 w-3 cursor-pointer accent-accent-500"
                    />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-ink-500">
                      {c.collectorNumber ?? ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="space-y-3 overflow-y-auto p-4">
            <Field label="Paper">
              <select
                value={profile}
                onChange={(e) => setProfile(e.target.value as keyof typeof PRINT_PROFILES)}
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              >
                {Object.keys(PRINT_PROFILES).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Margin (pt)">
              <NumberInput value={marginPt} onChange={setMarginPt} />
            </Field>
            <Field label="Gap (pt)">
              <NumberInput value={gapPt} onChange={setGapPt} />
            </Field>
            <label className="flex items-center gap-2 text-xs text-ink-100">
              <input
                type="checkbox"
                checked={cropMarks}
                onChange={(e) => setCropMarks(e.target.checked)}
                className="h-3 w-3 cursor-pointer accent-accent-500"
              />
              <span>Draw crop marks</span>
            </label>
            <Field label="Footer text" hint="Printed centered at bottom of page.">
              <input
                type="text"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="© Studio"
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
              />
            </Field>
            <div className="rounded border border-ink-800 bg-ink-950 p-2 text-[11px] text-ink-400">
              Selected: <span className="text-ink-100">{toExport.length}</span> /{" "}
              {availableCards.length}
            </div>

            <PreflightSection
              errors={errors}
              warnings={warnings}
              overrideWarnings={overrideWarnings}
              onOverride={setOverrideWarnings}
            />
          </aside>
        </div>

        {error && (
          <div className="border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500">
            {error}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={
              busy ||
              toExport.length === 0 ||
              blocked ||
              (warnings.length > 0 && !overrideWarnings)
            }
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
            title={
              blocked
                ? "Fix blocking issues before exporting."
                : warnings.length > 0 && !overrideWarnings
                  ? "Acknowledge warnings before exporting."
                  : ""
            }
          >
            {busy ? "Rendering…" : `Generate PDF (${toExport.length})`}
          </button>
        </footer>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Preflight                                                              */
/* ---------------------------------------------------------------------- */
//
// Compact summary of validation state, grouped by severity. Shows up
// to four issues per bucket so the panel stays tight. Errors block
// the export outright; warnings can be overridden with an explicit
// checkbox so the user has to take responsibility.

function PreflightSection({
  errors,
  warnings,
  overrideWarnings,
  onOverride,
}: {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  overrideWarnings: boolean;
  onOverride: (next: boolean) => void;
}) {
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
        Preflight clean — bleed, safe zone, and DPI all check out.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="rounded border border-danger-500/40 bg-danger-500/10 p-2">
          <p className="text-[11px] font-medium text-danger-300">
            {errors.length} blocking issue{errors.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-danger-200">
            {errors.slice(0, 4).map((iss) => (
              <li key={iss.id}>· {iss.message}</li>
            ))}
            {errors.length > 4 && (
              <li className="text-danger-300/80">
                +{errors.length - 4} more in the validation panel
              </li>
            )}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <p className="text-[11px] font-medium text-amber-300">
            {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-0.5 text-[10px] text-amber-200">
            {warnings.slice(0, 4).map((iss) => (
              <li key={iss.id}>· {iss.message}</li>
            ))}
            {warnings.length > 4 && (
              <li className="text-amber-300/80">
                +{warnings.length - 4} more in the validation panel
              </li>
            )}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-[10px] text-amber-200">
            <input
              type="checkbox"
              checked={overrideWarnings}
              onChange={(e) => onOverride(e.target.checked)}
              className="h-3 w-3 cursor-pointer accent-amber-400"
            />
            <span>I acknowledge these warnings.</span>
          </label>
        </div>
      )}
    </div>
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

function NumberInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") return;
        const n = Number(v);
        if (Number.isFinite(n)) onChange(Math.max(0, Math.round(n)));
      }}
      className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100"
    />
  );
}
