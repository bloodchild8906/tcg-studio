import { useEffect, useMemo, useState } from "react";
import { useDesigner } from "@/store/designerStore";
import {
  apiHealth,
  fetchPublicCmsPage,
  parseHostnameContext,
  type CmsContent,
} from "@/lib/api";
import { CmsBlocksRenderer } from "@/public/CmsBlocksRenderer";

/**
 * Login wall — shown by App.tsx whenever there's no `currentUser`.
 *
 * Per-tenant white-label (sec 11):
 *
 *   When the user lands on `<tenant>.tcgstudio.local` we fetch the
 *   tenant's public branding (`/api/public/<slug>/branding`) and
 *   repaint the login card with the tenant's product name + logo +
 *   accent color BEFORE the user authenticates. So visiting Acme's
 *   subdomain looks like Acme's product, not TCGStudio.
 *
 *   Tenants can go further by publishing a CMS page at the reserved
 *   slug `__login` — its blocks render as a hero panel beside the
 *   form. Marketing copy, screenshots, hero images, anything from the
 *   CMS block registry. The form itself stays as the React component
 *   below because auth is sensitive surface.
 *
 * The platform root (`tcgstudio.local`) keeps the original design.
 *
 * Demo credentials surface as a hint at the bottom only on the
 * platform root and on the demo tenant — production tenants don't
 * want a "try someone else's account" pill cluttering their login.
 */

interface BrandingPayload {
  tenantSlug: string;
  tenantName: string;
  productName: string;
  logoAssetId: string | null;
  accentColor: string | null;
  hidePlatformBranding: boolean;
  supportEmail: string | null;
}

const LOGIN_PAGE_SLUG = "__login";

export function LoginView() {
  const signIn = useDesigner((s) => s.signIn);
  const signUp = useDesigner((s) => s.signUp);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant slug derived from the hostname. The platform root resolves
  // to null and we render the default platform branding.
  const tenantSlug = useMemo(() => {
    if (typeof window === "undefined") return null;
    const ctx = parseHostnameContext(window.location.hostname);
    return ctx.tenantSlug ?? null;
  }, []);

  const [branding, setBranding] = useState<BrandingPayload | null>(null);
  const [cmsPage, setCmsPage] = useState<{
    title: string;
    publishedJson: CmsContent;
  } | null>(null);

  // Pre-auth branding fetch. Failures are non-fatal — we just fall
  // back to the platform-default styling.
  useEffect(() => {
    if (!tenantSlug) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${apiHealth.base}/api/public/${encodeURIComponent(tenantSlug)}/branding`,
        );
        if (!r.ok) return;
        const b = (await r.json()) as BrandingPayload;
        if (alive) setBranding(b);
      } catch {
        /* ignore — fall back to platform branding */
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  // Optional CMS-driven hero. Tenants publish a page at `__login` to
  // override the marketing-side of the screen. 404 = no override,
  // we collapse the side panel.
  useEffect(() => {
    if (!tenantSlug) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetchPublicCmsPage(tenantSlug, LOGIN_PAGE_SLUG);
        if (alive)
          setCmsPage({ title: r.page.title, publishedJson: r.page.publishedJson });
      } catch {
        /* no override page — leave the form-only layout */
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  // Apply tenant accent color as a CSS variable so the existing
  // `accent-500` Tailwind utilities cascade. We also set the document
  // title so the browser tab matches the tenant's product name.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const title = branding?.productName ?? "TCGStudio";
    document.title = `Sign in · ${title}`;
    if (branding?.accentColor && /^#[0-9a-f]{3,8}$/i.test(branding.accentColor)) {
      document.documentElement.style.setProperty(
        "--login-accent",
        branding.accentColor,
      );
    } else {
      document.documentElement.style.removeProperty("--login-accent");
    }
  }, [branding]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn({ email: email.trim().toLowerCase(), password });
      } else {
        await signUp({
          email: email.trim().toLowerCase(),
          password,
          name: name.trim(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth failed");
    } finally {
      setBusy(false);
    }
  }

  const productName = branding?.productName ?? "TCGStudio";
  const logoUrl = branding?.logoAssetId
    ? `${apiHealth.base}/api/public/${branding.tenantSlug}/assets/${branding.logoAssetId}/blob`
    : "/branding/mark.svg";

  // Apply accent color override via inline CSS var so the
  // accent-500/15, accent-300, accent-500/40 tokens used in this
  // file pick it up. Falls back to the platform palette when the
  // tenant hasn't set one.
  const accentStyle = branding?.accentColor
    ? ({
        "--accent-500": branding.accentColor,
      } as React.CSSProperties)
    : undefined;

  const hasCmsHero = !!cmsPage && (cmsPage.publishedJson?.blocks?.length ?? 0) > 0;

  return (
    <div
      className="flex h-screen items-center justify-center bg-ink-950 p-6"
      style={accentStyle}
    >
      <div
        className={[
          "grid w-full max-w-[980px] overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl",
          hasCmsHero ? "md:grid-cols-[1.2fr_minmax(380px,1fr)]" : "",
        ].join(" ")}
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
          backgroundSize: "12px 12px",
          maxWidth: hasCmsHero ? 980 : 420,
        }}
      >
        {hasCmsHero && cmsPage && tenantSlug && (
          <aside className="hidden border-r border-ink-700 bg-ink-950/40 p-6 md:block">
            <CmsBlocksRenderer
              blocks={cmsPage.publishedJson.blocks}
              tenantSlug={tenantSlug}
            />
          </aside>
        )}

        <section>
          <header className="flex flex-col items-center gap-2 border-b border-ink-700 px-6 py-6">
            <img
              src={logoUrl}
              alt=""
              aria-hidden="true"
              className="h-12 w-12 rounded object-contain"
            />
            <h1 className="text-lg font-semibold text-ink-50">{productName}</h1>
            <p className="text-[11px] text-ink-400">
              Sign in to your workspace
            </p>
          </header>

          <div className="flex border-b border-ink-700 bg-ink-900">
            <TabBtn active={mode === "signin"} onClick={() => setMode("signin")}>
              Sign in
            </TabBtn>
            <TabBtn active={mode === "signup"} onClick={() => setMode("signup")}>
              Create account
            </TabBtn>
          </div>

          <form onSubmit={submit} className="space-y-3 px-6 py-5">
            {mode === "signup" && (
              <Field label="Name">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                autoFocus
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
              />
            </Field>
            <Field
              label="Password"
              hint={mode === "signup" ? "Minimum 8 characters." : undefined}
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "signin" ? "current-password" : "new-password"
                }
                minLength={mode === "signup" ? 8 : 1}
                required
                className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
              />
            </Field>

            {error && (
              <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-500">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password || (mode === "signup" && !name)}
              className="block w-full rounded border border-accent-500/40 bg-accent-500/15 px-3 py-2 text-sm font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:border-ink-700 disabled:bg-ink-800 disabled:text-ink-500"
            >
              {busy
                ? "…"
                : mode === "signin"
                  ? "Sign in"
                  : tenantSlug
                    ? `Create account in ${productName}`
                    : "Create account & workspace"}
            </button>

            {mode === "signup" && (
              <p className="text-[11px] text-ink-500">
                {tenantSlug
                  ? `You'll join ${productName} as a member.`
                  : "We auto-create a personal workspace named after you. You can invite others or join existing tenants from Settings later."}
              </p>
            )}
          </form>

          {/* Demo-credentials footer removed — production deploys ship
              with a real seeded operator instead of throwaway demo
              accounts so we don't leak credentials in the UI. */}

          {!branding?.hidePlatformBranding && tenantSlug && (
            <p className="border-t border-ink-700 px-6 py-2 text-center text-[10px] text-ink-500">
              Powered by TCGStudio
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex-1 border-b-2 px-3 py-2.5 text-xs uppercase tracking-wider transition-colors",
        active
          ? "border-accent-500 text-accent-300"
          : "border-transparent text-ink-400 hover:text-ink-200",
      ].join(" ")}
    >
      {children}
    </button>
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
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}
