import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/DesignerApp";
import { PublicGallery } from "@/public/PublicGallery";
import { LandingPage } from "@/public/LandingPage";
import { MembersArea } from "@/public/MembersArea";
import { MembersLogin } from "@/public/MembersLogin";
import { parseHostnameContext } from "@/lib/api";
import "@/index.css";

/**
 * Entry-point router. Decides which top-level shell to mount based on
 * the host header AND the path. The model is symmetric across tenants:
 *
 *   Path-prefix routes — work on every host:
 *     `/public/:tenantSlug[/...]`  → PublicGallery for that tenant
 *
 *   Host-based routes:
 *     • Platform root (`tcgstudio.local`)           → LandingPage (CMS-driven
 *                                                     marketing, served from
 *                                                     the platform tenant's
 *                                                     CMS site).
 *     • Tenant subdomain root (`acme.tcgstudio.local/`)
 *                                                   → that tenant's PublicGallery
 *                                                     (their own CMS site is
 *                                                     the front door).
 *     • Project subdomain root (`saga-acme.tcgstudio.local/`)
 *                                                   → the parent tenant's
 *                                                     PublicGallery (project
 *                                                     scope still falls under
 *                                                     the tenant's CMS for
 *                                                     visitor-facing pages).
 *     • `/admin` on any tenant or project subdomain → designer (auth-walled)
 *     • localhost (dev fallback)                    → designer
 *
 * In other words: every tenant has its own CMS, every tenant's
 * subdomain root serves that CMS, and the auth-walled designer lives
 * at `/admin` on the same host. The platform root is just a special
 * case of "tenant subdomain root" — its CMS happens to be the
 * marketing landing page.
 */

function detectPublicPathRoute(): { tenantSlug: string } | null {
  const m = window.location.pathname.match(/^\/public\/([^/]+)/);
  if (!m) return null;
  return { tenantSlug: decodeURIComponent(m[1]) };
}

function isAdminPath(): boolean {
  return window.location.pathname.startsWith("/admin");
}

function isMembersPath(): boolean {
  return window.location.pathname.startsWith("/members");
}

function isLoginPath(): boolean {
  return window.location.pathname.startsWith("/login");
}

function isLocalhostHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || /^[\d.]+$/.test(h);
}

const publicRoute = detectPublicPathRoute();
const hostCtx = parseHostnameContext(window.location.hostname);

let mount: React.ReactNode;

if (publicRoute) {
  // /public/:tenant — explicit path-based public site (legacy; still
  // works on any host so deep links survive).
  mount = <PublicGallery tenantSlug={publicRoute.tenantSlug} />;
} else if (isLocalhostHost()) {
  // Dev convenience — `localhost` always opens the designer. Without
  // this, running `npm run dev` would land on the marketing page and
  // there's no working tenant subdomain on localhost.
  mount = <App />;
} else if (isAdminPath()) {
  // Any host + /admin → auth-walled designer for that host's tenant.
  // The tenant plugin on the API side already resolves the tenant
  // from the host header, so we just hand control to the designer.
  mount = <App />;
} else if (hostCtx.tenantSlug && isLoginPath()) {
  // Tenant subdomain + /login → white-labeled members LoginView,
  // wrapped by MembersLogin. The wrapper checks the tenant's
  // `membersAreaEnabled` flag and bounces to the public root if
  // the tenant hasn't opted in. It also overrides the post-auth
  // redirect to land on /members instead of /admin.
  mount = <MembersLogin tenantSlug={hostCtx.tenantSlug} />;
} else if (hostCtx.tenantSlug && isMembersPath()) {
  // Tenant subdomain + /members → members area. Internally checks
  // the tenant's `membersAreaEnabled` opt-in flag and bounces back
  // to the public root (`/`) when the tenant hasn't enabled it.
  mount = <MembersArea tenantSlug={hostCtx.tenantSlug} />;
} else if (hostCtx.level === "platform") {
  // Bare root host (no subdomain) → LandingPage (CMS-driven from the
  // platform tenant's site). When that tenant has no published CMS
  // page yet, LandingPage falls back to bundled defaults.
  mount = <LandingPage />;
} else if (hostCtx.tenantSlug) {
  // Tenant or project subdomain root → that tenant's public CMS site.
  // We strip the project component for now: the tenant CMS is the
  // visitor-facing site; per-project public sites can be modelled as
  // additional CmsSite rows on the same tenant if needed.
  mount = <PublicGallery tenantSlug={hostCtx.tenantSlug} pathPrefix="" />;
} else {
  // Fallthrough — unknown host (custom domain not yet resolved
  // client-side). The designer's auth + tenant resolution will sort
  // it out via the /context endpoint on boot.
  mount = <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{mount}</React.StrictMode>,
);
