/**
 * Members area — public, auth-walled, tenant-facing dashboard.
 *
 * Surfaces a tenant's *end-users* (not staff). Distinct from the
 * designer (`/admin`) which is for the studio's creators. Members
 * sign in at `<tenant>.tcgstudio.local/login` and land here on
 * success. They can:
 *
 *   • See their profile + sign out.
 *   • Browse the tenant's released cards (same data the public
 *     gallery shows, but with personal extras like favourites once
 *     those land).
 *   • View their own decks (project-agnostic — the API surface
 *     filters by ownership later when the model gains an owner_id).
 *   • Drop a comment / playtest signup form (rendered via existing
 *     CMS form blocks).
 *
 * Per-tenant white-label: header logo + product name come from the
 * same public branding endpoint the LoginView uses, so this surface
 * looks like Acme's product end-to-end without any designer branding
 * leaking through.
 *
 * v0 deliberately stays read-only on the member side. Authoring
 * tools live in the designer; this surface is for *participation*.
 */

import { useEffect, useMemo, useState } from "react";
import {
  apiHealth,
  fetchPublicCmsPage,
  parseHostnameContext,
  signOut as apiSignOut,
  fetchMe,
  type CmsContent,
  type CmsNavItem,
} from "@/lib/api";
import { fetchPublicCards, type PublicCard } from "@/public/publicApi";
import { CmsBlocksRenderer } from "@/public/CmsBlocksRenderer";
import { LoginView } from "@/components/LoginView";

interface BrandingPayload {
  tenantSlug: string;
  tenantName: string;
  productName: string;
  logoAssetId: string | null;
  accentColor: string | null;
  hidePlatformBranding: boolean;
  supportEmail: string | null;
  /** Opt-in flag — tenants flip this in Settings before the
   *  members area is exposed. */
  membersAreaEnabled: boolean;
}

interface MeUser {
  id: string;
  email: string;
  name: string;
  displayName?: string;
  avatarAssetId?: string | null;
}

const MEMBERS_HOME_SLUG = "__members";

/**
 * Read the path segment after `/members/`. Empty string = home
 * (`/members` or `/members/`), otherwise it's a CMS page slug the
 * tenant has published. We treat slugs case-insensitively but
 * preserve the original for the API call.
 */
function readSubSlug(): string {
  if (typeof window === "undefined") return "";
  const m = window.location.pathname.match(/^\/members\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function MembersArea({ tenantSlug }: { tenantSlug: string }) {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined); // undefined = loading
  const [branding, setBranding] = useState<BrandingPayload | null>(null);
  const [cards, setCards] = useState<PublicCard[]>([]);
  const [homePage, setHomePage] = useState<{
    title: string;
    publishedJson: CmsContent;
  } | null>(null);
  const [navItems, setNavItems] = useState<CmsNavItem[]>([]);
  /** Sub-slug read from window.location at mount; SPA navigation
   *  isn't wired yet — clicks on members nav items hard-navigate so
   *  this stays in sync. */
  const [subSlug] = useState<string>(() => readSubSlug());
  const [extPage, setExtPage] = useState<{
    title: string;
    publishedJson: CmsContent;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // --------------------------- auth check ---------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await fetchMe();
        if (alive) setUser(me.user as MeUser);
      } catch {
        if (alive) setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --------------------------- branding ---------------------------
  // Also drives the opt-in gate — if a tenant hasn't toggled the
  // members area on in Settings, we bounce visitors to the public
  // gallery rather than rendering this surface.
  const [bouncing, setBouncing] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${apiHealth.base}/api/public/${encodeURIComponent(tenantSlug)}/branding`,
        );
        if (!r.ok) return;
        const b = (await r.json()) as BrandingPayload;
        if (!alive) return;
        setBranding(b);
        if (!b.membersAreaEnabled) {
          // Off by default — redirect to the tenant's public root
          // and let the gallery / CMS take over. We use replace()
          // so the back button doesn't ping-pong here.
          setBouncing(true);
          window.location.replace("/");
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  // ------------------- public content (cards + cms hero + nav) -------------------
  // The members area is extensible: tenants attach a CMS Navigation
  // with placement `members` to add link items, and publish CMS pages
  // that show up at `/members/<slug>`. Both are best-effort — when
  // the tenant hasn't customized anything we fall back to the canned
  // dashboard.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      try {
        const [cardsRes, cmsRes, navRes] = await Promise.all([
          fetchPublicCards(tenantSlug).catch(() => ({ cards: [] })),
          fetchPublicCmsPage(tenantSlug, MEMBERS_HOME_SLUG).catch(() => null),
          fetch(
            `${apiHealth.base}/api/public/${encodeURIComponent(tenantSlug)}/cms/navigations/members`,
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ]);
        if (!alive) return;
        setCards(("cards" in cardsRes ? cardsRes.cards : []) as PublicCard[]);
        if (cmsRes) {
          setHomePage({
            title: cmsRes.page.title,
            publishedJson: cmsRes.page.publishedJson,
          });
        }
        const items =
          navRes?.navigation?.itemsJson?.items ??
          navRes?.navigation?.itemsJson ??
          [];
        if (Array.isArray(items)) {
          setNavItems(items as CmsNavItem[]);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "load failed");
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug, user]);

  // Sub-route page fetch — when the URL is `/members/<slug>` and the
  // tenant has a published CMS page at that slug, render it as the
  // body. 404 just falls through to the home dashboard.
  useEffect(() => {
    if (!user || !subSlug) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetchPublicCmsPage(tenantSlug, subSlug);
        if (alive)
          setExtPage({
            title: r.page.title,
            publishedJson: r.page.publishedJson,
          });
      } catch {
        if (alive) setExtPage(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug, subSlug, user]);

  // Apply accent CSS variable so the public surface picks up the
  // tenant's tint.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = `Members · ${branding?.productName ?? "TCGStudio"}`;
    if (branding?.accentColor && /^#[0-9a-f]{3,8}$/i.test(branding.accentColor)) {
      document.documentElement.style.setProperty(
        "--accent-500",
        branding.accentColor,
      );
    }
  }, [branding]);

  // Loading shell — also covers the brief moment between branding
  // arriving and the redirect firing for disabled tenants.
  if (user === undefined || bouncing) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-400">
        Loading…
      </div>
    );
  }

  // No user → bounce to the white-labeled LoginView.
  if (user === null) {
    return <LoginView />;
  }

  const productName = branding?.productName ?? "TCGStudio";
  const logoUrl = branding?.logoAssetId
    ? `${apiHealth.base}/api/public/${tenantSlug}/assets/${branding.logoAssetId}/blob`
    : "/branding/mark.svg";

  function signOut() {
    apiSignOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="border-b border-ink-800 bg-ink-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <a href="/members" className="flex items-center gap-2 no-underline">
            <img src={logoUrl} alt="" className="h-7 w-7 rounded object-contain" />
            <span className="text-sm font-semibold text-ink-50">{productName}</span>
            <span className="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-400">
              Members
            </span>
          </a>
          <nav className="flex items-center gap-3 text-xs text-ink-400">
            <a href="/" className="hover:text-ink-100">
              Public site
            </a>
            <span className="text-ink-700">·</span>
            <span className="text-ink-200">{user.name || user.email}</span>
            <button
              type="button"
              onClick={signOut}
              className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
            >
              Sign out
            </button>
          </nav>
        </div>
        {/* Tenant-authored navigation strip — populated from a CMS
         *  navigation with placement `members`. Tenants control the
         *  full link list; we just render. Active state matches when
         *  the item's target equals the current sub-slug. */}
        {navItems.length > 0 && (
          <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 pb-2 text-xs">
            <MembersNavLink
              href="/members"
              label="Home"
              active={!subSlug}
            />
            {navItems.map((item) => (
              <MembersNavLink
                key={item.id}
                href={navItemHref(item)}
                label={item.label}
                active={isNavItemActive(item, subSlug)}
              />
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* When the URL is `/members/<slug>` and the tenant has a
         *  published CMS page at that slug, render it as the body.
         *  This is the primary extension point: tenants build entire
         *  surfaces (news, leaderboards, perks, downloads...) by
         *  publishing CMS pages and linking to them from the members
         *  navigation. */}
        {subSlug && extPage && (
          <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
            <h1 className="mb-3 text-lg font-semibold text-ink-100">
              {extPage.title}
            </h1>
            <CmsBlocksRenderer
              blocks={extPage.publishedJson.blocks}
              tenantSlug={tenantSlug}
            />
          </section>
        )}

        {subSlug && !extPage && (
          <Section title="Page not found">
            <p className="text-sm text-ink-500">
              The page <code className="text-ink-300">{subSlug}</code> doesn't
              exist or isn't published yet.{" "}
              <a className="text-accent-300 hover:text-accent-200" href="/members">
                Back to members home
              </a>
              .
            </p>
          </Section>
        )}

        {/* Default home view — only renders when we're at `/members`
         *  (no sub-slug). Tenants can override the welcome by
         *  publishing a CMS page at slug `__members`. */}
        {!subSlug && (
          <>
            {homePage && homePage.publishedJson?.blocks?.length > 0 && (
              <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
                <CmsBlocksRenderer
                  blocks={homePage.publishedJson.blocks}
                  tenantSlug={tenantSlug}
                />
              </section>
            )}

            {error && (
              <p className="rounded border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-400">
                {error}
              </p>
            )}

            <Section title="Welcome">
              <p className="text-sm text-ink-300">
                Hi {user.name || user.email}. This is your members area for{" "}
                <span className="text-ink-100">{productName}</span>. Browse
                released cards below, and check back as the studio publishes new
                sets.
              </p>
            </Section>

            <Section title="Released cards" subtitle={`${cards.length}`}>
              {cards.length === 0 ? (
                <p className="text-sm text-ink-500">
                  No public cards yet — when the studio releases content, it
                  shows up here.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {cards.slice(0, 24).map((c) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-ink-800 bg-ink-900 p-2"
                    >
                      <p className="text-sm font-medium text-ink-100">
                        {c.name}
                      </p>
                      <p className="text-[11px] text-ink-500">{c.slug}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <ProfileSection user={user} />
          </>
        )}
      </main>

      {!branding?.hidePlatformBranding && (
        <footer className="border-t border-ink-800 bg-ink-900/60 py-3 text-center text-[10px] text-ink-500">
          Powered by TCGStudio
        </footer>
      )}
    </div>
  );
}

function ProfileSection({ user }: { user: MeUser }) {
  return (
    <Section title="Profile" subtitle={user.email}>
      <dl className="grid grid-cols-[120px_1fr] gap-2 text-xs text-ink-300">
        <dt className="text-ink-500">Name</dt>
        <dd className="text-ink-100">{user.name || "—"}</dd>
        <dt className="text-ink-500">Email</dt>
        <dd className="text-ink-100">{user.email}</dd>
        <dt className="text-ink-500">User ID</dt>
        <dd className="font-mono text-[11px] text-ink-300">{user.id}</dd>
      </dl>
    </Section>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between border-b border-ink-800 pb-1">
        <h2 className="text-sm font-medium text-ink-100">{title}</h2>
        {subtitle && (
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            {subtitle}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Navigation helpers                                                     */
/* ---------------------------------------------------------------------- */
//
// CmsNavItem.kind covers four shapes (sec 14.14):
//   • "page"    → internal CMS slug; we route to /members/<slug>
//   • "url"     → arbitrary external href; opens new tab below
//   • "gallery" → public card gallery section (members usually
//                 shouldn't leave the members shell, so we treat
//                 this as an internal jump that opens in a new tab
//                 to /public/<tenant>/cards)
//   • "section" → the spec calls these grouping headers; we render
//                 them as plain labels inline.

function navItemHref(item: CmsNavItem): string {
  switch (item.kind) {
    case "page":
      return item.slug ? `/members/${encodeURIComponent(item.slug)}` : "/members";
    case "url":
      return item.target ?? "#";
    case "gallery":
      return "/";
    case "section":
      return "#";
    default:
      return item.target ?? "#";
  }
}

function isNavItemActive(item: CmsNavItem, currentSubSlug: string): boolean {
  if (item.kind !== "page") return false;
  if (!item.slug) return !currentSubSlug;
  return item.slug.toLowerCase() === currentSubSlug.toLowerCase();
}

function MembersNavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <a
      href={href}
      className={[
        "rounded px-2.5 py-1 transition-colors",
        active
          ? "bg-accent-500/15 text-accent-200"
          : "text-ink-400 hover:bg-ink-800 hover:text-ink-100",
      ].join(" ")}
    >
      {label}
    </a>
  );
}

/** Re-export so `main.tsx` can detect tenant slug consistently. */
export { parseHostnameContext };
