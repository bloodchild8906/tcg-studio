import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useDesigner } from "@/store/designerStore";
/**
 * Persistent app sidebar.
 *
 * Icon-only by design — the designer / card-editor views need every column
 * pixel they can get, so labels stay in tooltips. The active section gets
 * an accent indicator on the left edge.
 *
 * Section list mirrors spec sec 45.1; we ship the four reachable today and
 * stub the rest as disabled (with a "soon" tooltip) so the user sees the
 * roadmap without us having to write it out.
 */
export function Sidebar() {
    const view = useDesigner((s) => s.view);
    const setView = useDesigner((s) => s.setView);
    const activeProjectId = useDesigner((s) => s.activeProjectId);
    const projectGated = !activeProjectId;
    return (_jsxs("nav", { className: "flex h-full w-14 flex-col items-center gap-1 border-r border-ink-700 bg-ink-900 py-3", children: [_jsx(NavButton, { icon: _jsx(DashboardIcon, {}), label: "Dashboard", active: view === "dashboard", onClick: () => setView("dashboard") }), _jsx(NavButton, { icon: _jsx(ProjectsIcon, {}), label: "Projects", active: view === "projects", onClick: () => setView("projects") }), _jsx(NavButton, { icon: _jsx(CardTypesIcon, {}), label: "Card types", active: view === "card_types" || view === "designer", disabled: projectGated, onClick: () => setView("card_types") }), _jsx(NavButton, { icon: _jsx(CardsIcon, {}), label: "Cards", active: view === "cards", disabled: projectGated, onClick: () => setView("cards") }), _jsx("div", { className: "mt-2 h-px w-8 bg-ink-700" }), _jsx(NavButton, { icon: _jsx(AssetsIcon, {}), label: "Assets", active: view === "assets", disabled: projectGated, onClick: () => setView("assets") }), _jsx(NavButton, { icon: _jsx(RulesIcon, {}), label: "Rules", active: view === "rules", disabled: projectGated, onClick: () => setView("rules") }), _jsx(NavButton, { icon: _jsx(FactionsIcon, {}), label: "Factions", active: view === "factions", disabled: projectGated, onClick: () => setView("factions") }), _jsx(NavButton, { icon: _jsx(LoreIcon, {}), label: "Lore", active: view === "lore", disabled: projectGated, onClick: () => setView("lore") }), _jsx(NavButton, { icon: _jsx(SetsIcon, {}), label: "Sets", active: view === "sets", disabled: projectGated, onClick: () => setView("sets") }), _jsx(NavButton, { icon: _jsx(DecksIcon, {}), label: "Decks", active: view === "decks", disabled: projectGated, onClick: () => setView("decks") }), _jsx(NavButton, { icon: _jsx(BoardIcon, {}), label: "Boards", active: view === "boards", disabled: projectGated, onClick: () => setView("boards") }), _jsx(NavButton, { icon: _jsx(PlaytestIcon, {}), label: "Playtest (soon)", disabled: true, onClick: () => { } }), _jsx("div", { className: "mt-auto" }), _jsx(NavButton, { icon: _jsx(SettingsIcon, {}), label: "Settings", active: view === "settings", onClick: () => setView("settings") })] }));
}
function NavButton({ icon, label, active, disabled, onClick, }) {
    return (_jsxs("button", { type: "button", onClick: disabled ? undefined : onClick, disabled: disabled, title: label, className: [
            "relative flex h-10 w-10 items-center justify-center rounded-md transition-colors",
            active
                ? "bg-accent-500/15 text-accent-300"
                : disabled
                    ? "text-ink-600"
                    : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
        ].join(" "), children: [active && (_jsx("span", { className: "absolute -left-2 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-accent-500" })), icon] }));
}
/* ----- icons ----- */
const ico = "h-4 w-4";
function DashboardIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2", y: "2", width: "5", height: "5", rx: "1" }), _jsx("rect", { x: "9", y: "2", width: "5", height: "3", rx: "1" }), _jsx("rect", { x: "9", y: "7", width: "5", height: "7", rx: "1" }), _jsx("rect", { x: "2", y: "9", width: "5", height: "5", rx: "1" })] }));
}
function ProjectsIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M2 5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" }) }));
}
function CardTypesIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2.5", y: "3", width: "6", height: "9", rx: "1" }), _jsx("rect", { x: "7.5", y: "4", width: "6", height: "9", rx: "1", opacity: "0.6" })] }));
}
function CardsIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "3", y: "3", width: "10", height: "10", rx: "1" }), _jsx("path", { d: "M6 6h4M6 9h4M6 11h2" })] }));
}
function AssetsIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2", y: "3", width: "12", height: "10", rx: "1" }), _jsx("circle", { cx: "6", cy: "7", r: "1" }), _jsx("path", { d: "M2 12l4-3 4 2 4-3" })] }));
}
function RulesIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "3", y: "2.5", width: "10", height: "11", rx: "1" }), _jsx("path", { d: "M5 5h6M5 8h6M5 11h4" })] }));
}
function SetsIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("path", { d: "M3 5l5-2 5 2v6l-5 2-5-2V5z" }), _jsx("path", { d: "M3 5l5 2 5-2M8 7v6" })] }));
}
function FactionsIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("path", { d: "M3 13V3l5 2 5-2v10" }), _jsx("path", { d: "M3 8l5 2 5-2" })] }));
}
function LoreIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("path", { d: "M3 3.5h7a2 2 0 0 1 2 2V13H5a2 2 0 0 1-2-2V3.5z" }), _jsx("path", { d: "M3 11a2 2 0 0 1 2-2h7" }), _jsx("path", { d: "M6 6h4M6 8.5h3" })] }));
}
function PlaytestIcon() {
    return (_jsx("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M5 4l7 4-7 4V4z" }) }));
}
function DecksIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "3", y: "2.5", width: "7", height: "10", rx: "1.5" }), _jsx("rect", { x: "6", y: "3.5", width: "7", height: "10", rx: "1.5" })] }));
}
function BoardIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("rect", { x: "2", y: "3", width: "12", height: "10", rx: "1" }), _jsx("path", { d: "M2 8h12M8 3v10" })] }));
}
function SettingsIcon() {
    return (_jsxs("svg", { className: ico, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: [_jsx("circle", { cx: "8", cy: "8", r: "2" }), _jsx("path", { d: "M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" })] }));
}
