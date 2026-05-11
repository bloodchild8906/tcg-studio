import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useDesigner } from "@/store/designerStore";
/**
 * Login wall — shown by App.tsx whenever there's no `currentUser`.
 *
 * Two tabs (sign in / sign up) sharing the same email + password fields.
 * Sign-up takes an extra Name field and auto-creates a personal workspace
 * via /api/v1/auth/signup. Sign-in is just credentials → token.
 *
 * Design choice: full-page card centered on the dark studio background, so
 * the user can't miss it. Once `currentUser` populates, the App swaps in
 * the normal shell.
 *
 * Demo credentials: `michael@demo.tcgstudio.local / demo1234` — surfaced
 * as a small hint at the bottom because there's no other onboarding path
 * yet for trying the seeded tenant.
 */
export function LoginView() {
    const signIn = useDesigner((s) => s.signIn);
    const signUp = useDesigner((s) => s.signUp);
    const [mode, setMode] = useState("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    async function submit(e) {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
            if (mode === "signin") {
                await signIn({ email: email.trim().toLowerCase(), password });
            }
            else {
                await signUp({
                    email: email.trim().toLowerCase(),
                    password,
                    name: name.trim(),
                });
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "auth failed");
        }
        finally {
            setBusy(false);
        }
    }
    function fillDemo() {
        setMode("signin");
        setEmail("michael@demo.tcgstudio.local");
        setPassword("demo1234");
    }
    return (_jsx("div", { className: "flex h-screen items-center justify-center bg-ink-950 p-6", children: _jsxs("div", { className: "w-[min(420px,100%)] overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl", style: {
                backgroundImage: "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
                backgroundSize: "12px 12px",
            }, children: [_jsxs("header", { className: "flex flex-col items-center gap-2 border-b border-ink-700 px-6 py-6", children: [_jsx("img", { src: "/branding/mark.svg", alt: "", "aria-hidden": "true", className: "h-12 w-12 rounded" }), _jsx("h1", { className: "text-lg font-semibold text-ink-50", children: "TCGStudio" }), _jsx("p", { className: "text-[11px] text-ink-400", children: "Sign in to your workspace" })] }), _jsxs("div", { className: "flex border-b border-ink-700 bg-ink-900", children: [_jsx(TabBtn, { active: mode === "signin", onClick: () => setMode("signin"), children: "Sign in" }), _jsx(TabBtn, { active: mode === "signup", onClick: () => setMode("signup"), children: "Create account" })] }), _jsxs("form", { onSubmit: submit, className: "space-y-3 px-6 py-5", children: [mode === "signup" && (_jsx(Field, { label: "Name", children: _jsx("input", { type: "text", value: name, onChange: (e) => setName(e.target.value), autoComplete: "name", required: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) })), _jsx(Field, { label: "Email", children: _jsx("input", { type: "email", value: email, onChange: (e) => setEmail(e.target.value), autoComplete: "email", required: true, autoFocus: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) }), _jsx(Field, { label: "Password", hint: mode === "signup" ? "Minimum 8 characters." : undefined, children: _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), autoComplete: mode === "signin" ? "current-password" : "new-password", minLength: mode === "signup" ? 8 : 1, required: true, className: "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40" }) }), error && (_jsx("p", { className: "rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-500", children: error })), _jsx("button", { type: "submit", disabled: busy || !email || !password || (mode === "signup" && !name), className: "block w-full rounded border border-accent-500/40 bg-accent-500/15 px-3 py-2 text-sm font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500", children: busy
                                ? "…"
                                : mode === "signin"
                                    ? "Sign in"
                                    : "Create account & workspace" }), mode === "signup" && (_jsx("p", { className: "text-[11px] text-ink-500", children: "We auto-create a personal workspace named after you. You can invite others or join existing tenants from Settings later." }))] }), _jsx("footer", { className: "border-t border-ink-700 px-6 py-3", children: _jsx("button", { type: "button", onClick: fillDemo, className: "w-full rounded border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-ink-100", title: "Fills in the seeded demo credentials", children: "Try the demo (michael@demo.tcgstudio.local / demo1234)" }) })] }) }));
}
function TabBtn({ active, onClick, children, }) {
    return (_jsx("button", { type: "button", onClick: onClick, className: [
            "flex-1 border-b-2 px-3 py-2.5 text-xs uppercase tracking-wider transition-colors",
            active
                ? "border-accent-500 text-accent-300"
                : "border-transparent text-ink-400 hover:text-ink-200",
        ].join(" "), children: children }));
}
function Field({ label, hint, children, }) {
    return (_jsxs("label", { className: "block space-y-1", children: [_jsx("span", { className: "block text-[11px] uppercase tracking-wider text-ink-400", children: label }), children, hint && _jsx("span", { className: "block text-[11px] text-ink-500", children: hint })] }));
}
