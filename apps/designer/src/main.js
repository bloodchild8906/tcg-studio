import { jsx as _jsx } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/DesignerApp";
import { PublicGallery } from "@/public/PublicGallery";
import "@/index.css";
/**
 * Entry point. Routes between two top-level apps based on the URL:
 *   - `/public/:tenantSlug[/cards/:slug]` → PublicGallery (no auth)
 *   - everything else                       → designer App (auth-walled)
 *
 * We intentionally short-circuit *before* the auth wall mounts so that
 * an unauthenticated visitor opening a shared public-gallery URL never
 * sees the login page and never triggers an `/auth/me` 401. The
 * gallery + the editor share the same SPA bundle to keep the build
 * footprint small; routing happens at this top-level boundary.
 */
function detectPublicRoute() {
    const m = window.location.pathname.match(/^\/public\/([^/]+)/);
    if (!m)
        return null;
    return { tenantSlug: decodeURIComponent(m[1]) };
}
const publicRoute = detectPublicRoute();
ReactDOM.createRoot(document.getElementById("root")).render(_jsx(React.StrictMode, { children: publicRoute ? _jsx(PublicGallery, { tenantSlug: publicRoute.tenantSlug }) : _jsx(App, {}) }));
