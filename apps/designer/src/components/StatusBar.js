import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useDesigner, selectSelectedLayer } from "@/store/designerStore";
/**
 * Status bar — bottom of the shell.
 *
 * Surface the things a designer wants visible at all times without having to
 * dig into a panel:
 *   • Selection summary
 *   • Card design size
 *   • Total layer count
 *   • Build / version stamp (placeholder until we wire CI)
 */
export function StatusBar() {
    const layer = useDesigner(selectSelectedLayer);
    const template = useDesigner((s) => s.template);
    const overlays = useDesigner((s) => s.overlays);
    return (_jsxs("footer", { className: "flex h-7 items-center gap-3 bg-ink-900 px-3 text-[11px] text-ink-300", children: [_jsxs(Pair, { label: "Card", children: [template.size.width, "\u00D7", template.size.height, "px \u00B7 bleed ", template.bleed, " \u00B7 safe ", template.safeZone] }), _jsx(Pair, { label: "Layers", children: template.layers.length }), _jsx(Pair, { label: "Selected", children: layer ? (_jsxs("span", { className: "text-accent-300", children: [layer.name, " ", _jsxs("span", { className: "text-ink-400", children: ["(", layer.type, ")"] })] })) : (_jsx("span", { className: "text-ink-500", children: "none" })) }), _jsx(Pair, { label: "Overlays", children: [
                    overlays.grid && "grid",
                    overlays.safeZone && "safe",
                    overlays.bleed && "bleed",
                ]
                    .filter(Boolean)
                    .join(" · ") || _jsx("span", { className: "text-ink-500", children: "off" }) }), _jsx("span", { className: "ml-auto text-ink-500", children: "TCGStudio Designer \u00B7 prototype build" })] }));
}
function Pair({ label, children }) {
    return (_jsxs("span", { className: "flex items-baseline gap-1", children: [_jsx("span", { className: "text-[10px] uppercase tracking-wider text-ink-500", children: label }), _jsx("span", { className: "text-ink-200", children: children })] }));
}
