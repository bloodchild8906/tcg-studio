import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { selectActiveCardType, useDesigner } from "@/store/designerStore";
import { exportPrintSheetPdf, PRINT_PROFILES, } from "@/lib/exportPrintSheet";
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
export function PrintSheetModal({ open, onClose, cards, }) {
    const cardType = useDesigner(selectActiveCardType);
    const liveTemplate = useDesigner((s) => s.template);
    const [profile, setProfile] = useState("letter_300dpi");
    const [marginPt, setMarginPt] = useState(36);
    const [gapPt, setGapPt] = useState(9);
    const [cropMarks, setCropMarks] = useState(true);
    const [footer, setFooter] = useState("");
    const [selected, setSelected] = useState(new Set());
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    // Reset selection / footer / busy state on open with a fresh deck.
    useEffect(() => {
        if (!open)
            return;
        setSelected(new Set(cards.map((c) => c.id)));
        setBusy(false);
        setError(null);
    }, [open, cards]);
    // Re-derive selectable cards when filters / cards change. We only
    // export cards whose status is releasable in production — but for the
    // playtest pipeline we let any status through. Keeping it simple here.
    const availableCards = cards;
    const toExport = useMemo(() => availableCards.filter((c) => selected.has(c.id)), [availableCards, selected]);
    if (!open)
        return null;
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
        setBusy(true);
        setError(null);
        try {
            const opts = {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "export failed");
        }
        finally {
            setBusy(false);
        }
    }
    function toggleAll(next) {
        if (next)
            setSelected(new Set(availableCards.map((c) => c.id)));
        else
            setSelected(new Set());
    }
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-label": "Print sheet", className: "fixed inset-0 z-50 flex items-center justify-center bg-black/60", onClick: (e) => {
            if (e.target === e.currentTarget && !busy)
                onClose();
        }, children: _jsxs("div", { className: "flex h-[80vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-lg border border-ink-700 bg-ink-900 shadow-2xl", children: [_jsxs("header", { className: "flex items-start justify-between border-b border-ink-700 px-4 py-3", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-sm font-semibold text-ink-50", children: "Print sheet (PDF)" }), _jsxs("p", { className: "text-[11px] text-ink-500", children: [availableCards.length, " card", availableCards.length === 1 ? "" : "s", " available \u2014 pick a subset and a paper profile."] })] }), _jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-transparent px-2.5 py-1.5 text-xs text-ink-300 hover:border-ink-700 hover:bg-ink-800 disabled:opacity-40", children: "Close" })] }), _jsxs("div", { className: "grid flex-1 grid-cols-[1fr_280px] overflow-hidden", children: [_jsxs("section", { className: "overflow-y-auto border-r border-ink-700 p-4", children: [_jsxs("div", { className: "mb-2 flex items-center justify-between", children: [_jsx("h3", { className: "text-xs font-medium text-ink-50", children: "Cards" }), _jsxs("div", { className: "flex items-center gap-2 text-[11px] text-ink-400", children: [_jsx("button", { type: "button", onClick: () => toggleAll(true), className: "rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 hover:bg-ink-700", children: "All" }), _jsx("button", { type: "button", onClick: () => toggleAll(false), className: "rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 hover:bg-ink-700", children: "None" })] })] }), _jsx("ul", { className: "space-y-1", children: availableCards.map((c) => {
                                        const checked = selected.has(c.id);
                                        return (_jsxs("li", { onClick: () => {
                                                const next = new Set(selected);
                                                if (checked)
                                                    next.delete(c.id);
                                                else
                                                    next.add(c.id);
                                                setSelected(next);
                                            }, className: [
                                                "flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-xs",
                                                checked
                                                    ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
                                                    : "border-ink-800 text-ink-300 hover:border-ink-700 hover:bg-ink-800",
                                            ].join(" "), children: [_jsx("input", { type: "checkbox", checked: checked, readOnly: true, className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { className: "truncate", children: c.name }), _jsx("span", { className: "ml-auto font-mono text-[10px] text-ink-500", children: c.collectorNumber ?? "" })] }, c.id));
                                    }) })] }), _jsxs("aside", { className: "space-y-3 overflow-y-auto p-4", children: [_jsx(Field, { label: "Paper", children: _jsx("select", { value: profile, onChange: (e) => setProfile(e.target.value), className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100", children: Object.keys(PRINT_PROFILES).map((k) => (_jsx("option", { value: k, children: k }, k))) }) }), _jsx(Field, { label: "Margin (pt)", children: _jsx(NumberInput, { value: marginPt, onChange: setMarginPt }) }), _jsx(Field, { label: "Gap (pt)", children: _jsx(NumberInput, { value: gapPt, onChange: setGapPt }) }), _jsxs("label", { className: "flex items-center gap-2 text-xs text-ink-100", children: [_jsx("input", { type: "checkbox", checked: cropMarks, onChange: (e) => setCropMarks(e.target.checked), className: "h-3 w-3 cursor-pointer accent-accent-500" }), _jsx("span", { children: "Draw crop marks" })] }), _jsx(Field, { label: "Footer text", hint: "Printed centered at bottom of page.", children: _jsx("input", { type: "text", value: footer, onChange: (e) => setFooter(e.target.value), placeholder: "\u00A9 Studio", className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100" }) }), _jsxs("div", { className: "rounded border border-ink-800 bg-ink-950 p-2 text-[11px] text-ink-400", children: ["Selected: ", _jsx("span", { className: "text-ink-100", children: toExport.length }), " /", " ", availableCards.length] })] })] }), error && (_jsx("div", { className: "border-y border-danger-500/30 bg-danger-500/10 px-4 py-2 text-xs text-danger-500", children: error })), _jsxs("footer", { className: "flex items-center justify-end gap-2 border-t border-ink-700 px-4 py-3", children: [_jsx("button", { type: "button", onClick: onClose, disabled: busy, className: "rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40", children: "Cancel" }), _jsx("button", { type: "button", onClick: run, disabled: busy || toExport.length === 0, className: "rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40", children: busy ? "Rendering…" : `Generate PDF (${toExport.length})` })] })] }) }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[10px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[10px] text-ink-500", children: hint })] }));
}
function NumberInput({ value, onChange, }) {
    return (_jsx("input", { type: "number", min: 0, value: value, onChange: (e) => {
            const v = e.target.value;
            if (v === "")
                return;
            const n = Number(v);
            if (Number.isFinite(n))
                onChange(Math.max(0, Math.round(n)));
        }, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs tabular-nums text-ink-100" }));
}
