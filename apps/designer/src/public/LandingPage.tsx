import { useEffect, useState } from "react";
import {
  fetchPlatformLanding,
  getRootDomain,
  type PublicCmsPageResponse,
} from "@/lib/api";
import { CmsBlocksRenderer } from "@/public/CmsBlocksRenderer";

/**
 * Platform-root landing page — CMS-driven.
 *
 * The PLATFORM_TENANT_SLUG env (default `platform`) designates one
 * tenant whose published CMS site IS the platform marketing page.
 * That tenant's owners sign in like any other tenant, edit their
 * "home" CMS page through the regular designer UI, and the result
 * appears here at the root host.
 *
 * Fallback chain:
 *   1. CMS landing page exists (tenant has a published "home" page) —
 *      render it inside the platform shell.
 *   2. CMS endpoint returns 404 (tenant doesn't exist yet, or no
 *      published page) — render the bundled default copy below so
 *      visitors aren't met with a blank page on a fresh install.
 *
 * The platform tenant's brand (productName, logo, accent color) flows
 * through into the shell when set, so the platform owner can rebrand
 * TCGStudio to their own studio name without touching code.
 */
export function LandingPage() {
  const root = getRootDomain();
  const [cms, setCms] = useState<PublicCmsPageResponse | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchPlatformLanding()
      .then((r) => {
        if (alive) setCms(r);
      })
      .catch(() => {
        /* No CMS landing page configured — fall through to defaults. */
      })
      .finally(() => {
        if (alive) setResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Brand info from the platform tenant, when present. Falls back to
  // hardcoded "TCGStudio" defaults when the CMS hasn't returned yet
  // or the tenant isn't configured.
  const branding = cms?.tenant.brandingJson ?? {};
  const productName =
    typeof (branding as { productName?: unknown }).productName === "string"
      ? ((branding as { productName: string }).productName)
      : "TCGStudio";

  if (!resolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950 text-sm text-ink-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <Header rootDomain={root} productName={productName} />
      {cms ? (
        <CmsLanding cms={cms} />
      ) : (
        <DefaultLanding rootDomain={root} productName={productName} />
      )}
      <Footer rootDomain={root} productName={productName} />
    </div>
  );
}

/* ====================================================================== */
/* CMS-driven body                                                         */
/* ====================================================================== */

function CmsLanding({ cms }: { cms: PublicCmsPageResponse }) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10">
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-ink-50 md:text-5xl">
          {cms.page.title}
        </h1>
        {cms.page.seoDescription && (
          <p className="mt-3 text-base text-ink-400">{cms.page.seoDescription}</p>
        )}
      </header>
      <CmsBlocksRenderer
        blocks={cms.page.publishedJson?.blocks ?? []}
        // The platform landing belongs to the platform tenant, so
        // tenant-scoped blocks (assets, forms, card galleries) resolve
        // against that tenant's slug.
        tenantSlug={cms.tenant.slug}
      />
    </main>
  );
}

/* ====================================================================== */
/* Default (bundled) body — shown when no CMS page is configured           */
/* ====================================================================== */

function DefaultLanding({
  rootDomain,
  productName,
}: {
  rootDomain: string;
  productName: string;
}) {
  const port = window.location.port ? `:${window.location.port}` : "";
  const demoUrl = `${window.location.protocol}//demo.${rootDomain}${port}/`;
  return (
    <>
      <Hero rootDomain={rootDomain} productName={productName} demoUrl={demoUrl} />
      <ValueProps />
      <Pillars />
      <CallToAction
        rootDomain={rootDomain}
        productName={productName}
        demoUrl={demoUrl}
      />
      <PlatformAdminNote rootDomain={rootDomain} />
    </>
  );
}

/* ====================================================================== */
/* Header                                                                  */
/* ====================================================================== */

function Header({
  rootDomain,
  productName,
}: {
  rootDomain: string;
  productName: string;
}) {
  const port = window.location.port ? `:${window.location.port}` : "";
  return (
    <header className="border-b border-ink-800 bg-ink-950/90 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="/" className="flex items-center gap-2">
          <img
            src="/branding/mark.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 rounded"
          />
          <span className="text-base font-semibold text-ink-50">{productName}</span>
        </a>
        <nav className="hidden items-center gap-6 text-xs text-ink-300 md:flex">
          <a
            href={`http://demo.${rootDomain}${port}/`}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 font-medium text-accent-300 hover:bg-accent-500/25"
          >
            Try the demo
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ====================================================================== */
/* Hero (default)                                                          */
/* ====================================================================== */

function Hero({
  rootDomain,
  productName,
  demoUrl,
}: {
  rootDomain: string;
  productName: string;
  demoUrl: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-ink-800">
      <div
        className="absolute inset-0 opacity-50"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.18), transparent 50%), radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0)",
          backgroundSize: "auto, 14px 14px",
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
        <p className="text-[11px] uppercase tracking-widest text-accent-400">
          Build the game · Publish the world · Own the brand
        </p>
        <h1 className="mt-3 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-ink-50 md:text-5xl">
          The studio-in-a-box for designing custom trading card games.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-300">
          Design the cards. Build the rules. Publish the public site. Export
          the product. {productName} is a multi-tenant, white-label creation
          suite for card-game studios — from a solo creator with a notebook to
          a publisher running multiple franchises.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <SignupButton rootDomain={rootDomain} />
          <a
            href={demoUrl}
            className="rounded-md border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm font-medium text-ink-200 hover:bg-ink-800"
          >
            Try the demo workspace
          </a>
        </div>
      </div>
    </section>
  );
}

function ValueProps() {
  const props = [
    {
      title: "For solo creators",
      description:
        "Drag, drop, design. Card type templates with variants, schemas, and live preview — no code required.",
      icon: "🃏",
    },
    {
      title: "For studios",
      description:
        "Team roles, approval workflow, asset library, print-ready exports, branded public site, full revision history.",
      icon: "🎨",
    },
    {
      title: "For publishers",
      description:
        "Multi-project management, multiple brands, custom domains, white-label dashboards, dedicated marketplaces.",
      icon: "📦",
    },
    {
      title: "For developers",
      description:
        "Plugin SDK, REST + GraphQL APIs, webhooks, JSON / CSV / XLSX import-export. Extend anything; rewrite nothing.",
      icon: "⚙️",
    },
  ];
  return (
    <section className="border-b border-ink-800">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-[11px] uppercase tracking-widest text-accent-400">
          Who it's for
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-ink-50 md:text-4xl">
          One platform, every kind of card-game maker.
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {props.map((p) => (
            <article
              key={p.title}
              className="rounded-lg border border-ink-800 bg-ink-900/60 p-5"
            >
              <div className="mb-3 text-2xl" aria-hidden="true">
                {p.icon}
              </div>
              <h3 className="text-base font-medium text-ink-100">{p.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-400">
                {p.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pillars() {
  const pillars = [
    {
      title: "Card design",
      points: [
        "Card-type templates with layer trees, zones, and variants",
        "Schema-based card data with validation",
        "Multi-faction frames, 9-slice panels, sprite splitter",
        "Live preview against any card",
      ],
    },
    {
      title: "Game systems",
      points: [
        "Custom phases, priority, win conditions per project",
        "Keyword glossary with reminder text",
        "Visual ability graph editor",
        "Custom board layouts and zones",
      ],
    },
    {
      title: "Publishing",
      points: [
        "Built-in CMS with drag-and-drop blocks",
        "Public card gallery with search and filters",
        "Forms (playtest signup, contact, newsletter)",
        "Custom domains with auto TLS",
      ],
    },
    {
      title: "Production",
      points: [
        "PDF print sheets with bleed + crop marks",
        "Pack generators and rarity rules",
        "Project-wide validation",
        "JSON / CSV / XLSX / Cockatrice / TTS exports",
      ],
    },
  ];
  return (
    <section className="border-b border-ink-800 bg-ink-900/30">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <p className="text-[11px] uppercase tracking-widest text-accent-400">
          What's inside
        </p>
        <h2 className="mt-2 text-3xl font-semibold text-ink-50 md:text-4xl">
          From notebook scribble to printable product.
        </h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {pillars.map((p) => (
            <article
              key={p.title}
              className="rounded-lg border border-ink-800 bg-ink-900 p-6"
            >
              <h3 className="text-lg font-medium text-ink-100">{p.title}</h3>
              <ul className="mt-3 space-y-2 text-sm text-ink-300">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2">
                    <span
                      className="mt-1 inline-block h-1 w-1 shrink-0 rounded-full bg-accent-400"
                      aria-hidden="true"
                    />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CallToAction({
  rootDomain,
  productName,
  demoUrl,
}: {
  rootDomain: string;
  productName: string;
  demoUrl: string;
}) {
  return (
    <section className="border-b border-ink-800">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-3xl font-semibold text-ink-50 md:text-4xl">
          Pick a tenant slug. Start designing.
        </h2>
        <p className="mt-3 text-sm text-ink-400">
          Signing up auto-creates a workspace at{" "}
          <code className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[12px] text-accent-300">
            yourname.{rootDomain}
          </code>
          . You can rename, brand it, attach a custom domain, and invite
          collaborators from there. {productName} stays out of the way.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <SignupButton rootDomain={rootDomain} large />
          <a
            href={demoUrl}
            className="rounded-md border border-ink-700 bg-ink-900 px-5 py-3 text-sm font-medium text-ink-200 hover:bg-ink-800"
          >
            Or browse the demo first
          </a>
        </div>
      </div>
    </section>
  );
}

/* ====================================================================== */
/* Platform admin note                                                     */
/* ====================================================================== */

function PlatformAdminNote({ rootDomain }: { rootDomain: string }) {
  const port = window.location.port ? `:${window.location.port}` : "";
  return (
    <section className="border-b border-ink-800 bg-ink-900/40">
      <div className="mx-auto max-w-3xl px-6 py-12 text-center text-sm text-ink-400">
        <p>
          <strong className="text-ink-200">Platform admin?</strong> Sign into
          the platform tenant's designer at{" "}
          <a
            href={`http://platform.${rootDomain}${port}/admin`}
            className="text-accent-300 hover:underline"
          >
            platform.{rootDomain}/admin
          </a>{" "}
          and edit this page through the CMS — the published "home" page on
          the platform tenant's site replaces this default copy.
        </p>
      </div>
    </section>
  );
}

/* ====================================================================== */
/* Sign-up form                                                            */
/* ====================================================================== */

function SignupButton({
  rootDomain,
  large = false,
}: {
  rootDomain: string;
  large?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cls = large
    ? "rounded-md bg-accent-500 px-5 py-3 text-sm font-semibold text-ink-950 hover:bg-accent-400"
    : "rounded-md bg-accent-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-400";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cls}>
        Create your studio →
      </button>
      {open && (
        <SignupModal rootDomain={rootDomain} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function SignupModal({
  rootDomain,
  onClose,
}: {
  rootDomain: string;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const apiBase =
      typeof import.meta !== "undefined" &&
      (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL
        ? (import.meta as { env: { VITE_API_URL: string } }).env.VITE_API_URL
        : `${window.location.protocol}//${window.location.hostname.replace(/^[^.]+\./, "api.")}:4000`;
    const url =
      mode === "signup"
        ? `${apiBase}/api/v1/auth/signup`
        : `${apiBase}/api/v1/auth/login`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signup" ? { email, password, name } : { email, password },
        ),
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => ({} as { message?: string }));
        throw new Error(detail.message ?? `${r.status} ${r.statusText}`);
      }
      const json = (await r.json()) as { token: string };
      try {
        localStorage.setItem("tcgstudio.authToken", json.token);
      } catch {
        /* ignore */
      }
      let slug: string | null = null;
      try {
        const me = await fetch(`${apiBase}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${json.token}` },
        });
        if (me.ok) {
          const body = (await me.json()) as {
            memberships?: Array<{ tenant: { slug: string } }>;
          };
          slug = body.memberships?.[0]?.tenant.slug ?? null;
        }
      } catch {
        /* fall through */
      }
      const port = window.location.port ? `:${window.location.port}` : "";
      // After signup/login, drop the user into the designer (`/admin`)
      // on their tenant subdomain. The tenant subdomain root now
      // serves the tenant's public CMS site, so we explicitly request
      // /admin to land in the editor.
      const target = slug
        ? `${window.location.protocol}//${slug}.${rootDomain}${port}/admin`
        : `${window.location.protocol}//${rootDomain}${port}/`;
      window.location.href = target;
    } catch (err) {
      setError(err instanceof Error ? err.message : "auth failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[440px] rounded-xl border border-ink-700 bg-ink-900 p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink-50">
            {mode === "signup" ? "Create your studio" : "Sign in"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-ink-100"
          >
            ×
          </button>
        </div>

        <div className="mb-4 flex gap-2 rounded-md bg-ink-800/60 p-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={[
              "flex-1 rounded px-3 py-1.5 transition-colors",
              mode === "signup"
                ? "bg-accent-500 text-ink-950"
                : "text-ink-300 hover:text-ink-100",
            ].join(" ")}
          >
            New studio
          </button>
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={[
              "flex-1 rounded px-3 py-1.5 transition-colors",
              mode === "signin"
                ? "bg-accent-500 text-ink-950"
                : "text-ink-300 hover:text-ink-100",
            ].join(" ")}
          >
            I have an account
          </button>
        </div>

        {mode === "signup" && (
          <Field label="Your name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={INPUT}
              autoComplete="name"
            />
          </Field>
        )}
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className={INPUT}
            autoComplete="email"
          />
        </Field>
        <Field
          label="Password"
          hint={mode === "signup" ? "8 characters minimum." : undefined}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "signup" ? 8 : 1}
            className={INPUT}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </Field>

        {error && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="block w-full rounded-md bg-accent-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-400 disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : mode === "signup"
            ? "Create studio & sign in"
            : "Sign in"}
        </button>

        {mode === "signup" && (
          <p className="mt-3 text-[11px] text-ink-500">
            We auto-create a workspace at{" "}
            <code className="font-mono">your-slug.{rootDomain}</code>.
          </p>
        )}
      </form>
    </div>
  );
}

function Footer({
  rootDomain,
  productName,
}: {
  rootDomain: string;
  productName: string;
}) {
  return (
    <footer className="border-t border-ink-800 bg-ink-950">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-8 md:flex-row md:items-center">
        <p className="text-[11px] text-ink-500">
          © {new Date().getFullYear()} {productName} · {rootDomain}
        </p>
        <p className="text-[11px] text-ink-500">
          Build the game. Publish the world. Own the brand.
        </p>
      </div>
    </footer>
  );
}

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2.5 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

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
    <label className="mb-3 block space-y-1">
      <span className="block text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}
