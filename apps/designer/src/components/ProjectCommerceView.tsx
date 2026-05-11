/**
 * Project Commerce view — economy, marketing, storefront.
 *
 * Lives at project scope only (sec 8 — projects sell their creations,
 * tenants manage projects). Three sections, all backed by free-form
 * JSON columns on `Project`:
 *
 *   • Economy   — currency, default product price, royalty splits,
 *                 payout account.
 *   • Marketing — SEO defaults, social handles, OG image,
 *                 newsletter integration, GA / UTM templates.
 *   • Storefront — toggle the public store on/off, fulfillment mode,
 *                 refund/shipping policies, featured products.
 *
 * Each section saves through PATCH /api/v1/projects/:id with the
 * appropriate `*Json` field. Provider plugins (sec — task #184) will
 * later populate the payment-processor dropdown when a tenant has a
 * `payment_processor` plugin installed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { selectActiveProject, useDesigner } from "@/store/designerStore";
import { request as apiRequest } from "@/lib/api";

interface ProjectCommerceState {
  economy: Record<string, unknown>;
  marketing: Record<string, unknown>;
  storefront: Record<string, unknown>;
}

const DEFAULT_STATE: ProjectCommerceState = {
  economy: {},
  marketing: {},
  storefront: {},
};

export function ProjectCommerceView() {
  const project = useDesigner(selectActiveProject);
  const [tab, setTab] = useState<"economy" | "marketing" | "storefront">(
    "economy",
  );
  const [state, setState] = useState<ProjectCommerceState>(DEFAULT_STATE);
  const [error, setError] = useState<string | null>(null);

  const projectId = project?.id ?? null;

  // Hydrate from the active project's JSON blobs whenever it changes.
  useEffect(() => {
    if (!project) {
      setState(DEFAULT_STATE);
      return;
    }
    const p = project as unknown as {
      economyJson?: Record<string, unknown>;
      marketingJson?: Record<string, unknown>;
      storefrontJson?: Record<string, unknown>;
    };
    setState({
      economy: { ...(p.economyJson ?? {}) },
      marketing: { ...(p.marketingJson ?? {}) },
      storefront: { ...(p.storefrontJson ?? {}) },
    });
  }, [project?.id]);

  const save = useCallback(
    async (
      key: "economy" | "marketing" | "storefront",
      patch: Record<string, unknown>,
    ) => {
      if (!projectId) return;
      const next = { ...state[key], ...patch };
      setState((s) => ({ ...s, [key]: next }));
      try {
        await apiRequest(`/api/v1/projects/${projectId}`, {
          method: "PATCH",
          body: { [`${key}Json`]: next },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "save failed");
      }
    },
    [projectId, state],
  );

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-950 text-xs text-ink-500">
        Pick a project to manage its commerce settings.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-800 bg-ink-900 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-500">
            Project · {project.name}
          </p>
          <h1 className="text-sm font-medium text-ink-100">Commerce</h1>
          <p className="text-[11px] text-ink-500">
            Sell creations from this project. Configure pricing, marketing
            channels, and the public storefront.
          </p>
        </div>
        <nav className="flex gap-1 rounded border border-ink-800 bg-ink-950 p-1 text-xs">
          {(
            [
              ["economy", "Economy"],
              ["marketing", "Marketing"],
              ["storefront", "Storefront"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={[
                "rounded px-3 py-1 transition-colors",
                tab === k
                  ? "bg-accent-500/20 text-accent-200"
                  : "text-ink-400 hover:text-ink-200",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <p className="border-b border-danger-500/30 bg-danger-500/10 px-4 py-2 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto bg-ink-950">
        <div className="mx-auto max-w-3xl p-6">
          {tab === "economy" && (
            <EconomyTab
              data={state.economy}
              onChange={(patch) => save("economy", patch)}
            />
          )}
          {tab === "marketing" && (
            <MarketingTab
              data={state.marketing}
              onChange={(patch) => save("marketing", patch)}
            />
          )}
          {tab === "storefront" && (
            <StorefrontTab
              data={state.storefront}
              onChange={(patch) => save("storefront", patch)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Economy                                                                */
/* ---------------------------------------------------------------------- */

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"] as const;

function EconomyTab({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const get = useCallback(
    (k: string) => (typeof data[k] === "string" ? (data[k] as string) : ""),
    [data],
  );
  const getNum = useCallback(
    (k: string) => (typeof data[k] === "number" ? (data[k] as number) : ""),
    [data],
  );

  // Royalty splits — array of { payeeUserEmail, percent }. Local
  // draft so the user can edit without losing focus on every keystroke.
  const splits = useMemo(() => {
    const raw = data.royaltySplits;
    return Array.isArray(raw)
      ? (raw as Array<{ payeeUserEmail?: string; percent?: number }>)
      : [];
  }, [data.royaltySplits]);

  function updateSplit(idx: number, patch: { payeeUserEmail?: string; percent?: number }) {
    const next = [...splits];
    next[idx] = { ...next[idx], ...patch };
    onChange({ royaltySplits: next });
  }
  function addSplit() {
    onChange({ royaltySplits: [...splits, { payeeUserEmail: "", percent: 0 }] });
  }
  function removeSplit(idx: number) {
    const next = splits.filter((_, i) => i !== idx);
    onChange({ royaltySplits: next });
  }

  const totalPercent = splits.reduce(
    (sum, s) => sum + (typeof s.percent === "number" ? s.percent : 0),
    0,
  );

  return (
    <section className="space-y-4">
      <Section title="Pricing & currency">
        <FieldRow label="Currency">
          <select
            value={get("currency") || "USD"}
            onChange={(e) => onChange({ currency: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow
          label="Default product price (cents)"
          hint="Used when a product doesn't override its own price."
        >
          <input
            type="number"
            min={0}
            value={getNum("defaultProductPriceCents") || ""}
            onChange={(e) =>
              onChange({
                defaultProductPriceCents: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
            placeholder="299 = $2.99"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
        <FieldRow
          label="Tax region"
          hint="ISO country code or 'auto' for the payment processor's geo rules."
        >
          <input
            type="text"
            value={get("taxRegion")}
            onChange={(e) => onChange({ taxRegion: e.target.value })}
            placeholder="US, EU, auto…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Payout">
        <FieldRow
          label="Payout account ID"
          hint="ID issued by your payment processor. Connect via the tenant's payment processor first."
        >
          <input
            type="text"
            value={get("payoutAccountId")}
            onChange={(e) => onChange({ payoutAccountId: e.target.value })}
            placeholder="acct_…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section
        title="Royalty splits"
        subtitle={`${totalPercent.toFixed(1)}% of 100%`}
      >
        <p className="text-[11px] text-ink-500">
          Distribute a percentage of every sale to specific contributors.
          Split rows pay out at the payment-processor level; the remainder
          goes to the project's payout account.
        </p>
        <ul className="space-y-1.5">
          {splits.map((s, idx) => (
            <li key={idx} className="grid grid-cols-[1fr_120px_auto] gap-2">
              <input
                type="email"
                value={s.payeeUserEmail ?? ""}
                onChange={(e) => updateSplit(idx, { payeeUserEmail: e.target.value })}
                placeholder="payee@example.com"
                className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
              />
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={typeof s.percent === "number" ? s.percent : ""}
                onChange={(e) =>
                  updateSplit(idx, {
                    percent: e.target.value ? Number(e.target.value) : 0,
                  })
                }
                placeholder="%"
                className="rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
              />
              <button
                type="button"
                onClick={() => removeSplit(idx)}
                title="Remove split"
                className="rounded border border-ink-700 bg-ink-900 px-2 text-ink-400 hover:bg-danger-500/10 hover:text-danger-300"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={addSplit}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-[11px] text-accent-300 hover:bg-accent-500/25"
        >
          + Add split
        </button>
        {totalPercent > 100 && (
          <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[10px] text-danger-300">
            Splits total over 100%. Reduce percentages so they fit.
          </p>
        )}
      </Section>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Marketing                                                              */
/* ---------------------------------------------------------------------- */

function MarketingTab({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const get = useCallback(
    (k: string) => (typeof data[k] === "string" ? (data[k] as string) : ""),
    [data],
  );

  return (
    <section className="space-y-4">
      <Section title="SEO defaults">
        <FieldRow label="Meta title" hint="Falls back to project name when blank.">
          <input
            type="text"
            value={get("seoTitle")}
            onChange={(e) => onChange({ seoTitle: e.target.value })}
            placeholder="Saga: Tales Unchained — official site"
            maxLength={70}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
        <FieldRow label="Meta description">
          <textarea
            value={get("seoDescription")}
            onChange={(e) => onChange({ seoDescription: e.target.value })}
            rows={2}
            maxLength={160}
            placeholder="One-line description for search engines + link previews."
            className="block w-full resize-none rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
          />
        </FieldRow>
        <FieldRow label="OG image asset ID" hint="Asset shown when links unfurl on social.">
          <input
            type="text"
            value={get("ogImageAssetId")}
            onChange={(e) => onChange({ ogImageAssetId: e.target.value })}
            placeholder="asset_…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Social handles">
        <FieldRow label="Twitter / X">
          <input
            type="text"
            value={get("twitterHandle")}
            onChange={(e) => onChange({ twitterHandle: e.target.value })}
            placeholder="@yourstudio"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
        <FieldRow label="Discord invite">
          <input
            type="url"
            value={get("discordUrl")}
            onChange={(e) => onChange({ discordUrl: e.target.value })}
            placeholder="https://discord.gg/…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
        <FieldRow label="YouTube channel">
          <input
            type="url"
            value={get("youtubeUrl")}
            onChange={(e) => onChange({ youtubeUrl: e.target.value })}
            placeholder="https://youtube.com/@…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
        <FieldRow label="Bluesky / Mastodon (optional)">
          <input
            type="text"
            value={get("alternativeSocial")}
            onChange={(e) => onChange({ alternativeSocial: e.target.value })}
            placeholder="@handle@instance"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Newsletter">
        <FieldRow label="Provider">
          <select
            value={get("newsletterProvider") || "none"}
            onChange={(e) =>
              onChange({
                newsletterProvider:
                  e.target.value === "none" ? "" : e.target.value,
              })
            }
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            <option value="none">Disabled</option>
            <option value="mailchimp">Mailchimp</option>
            <option value="convertkit">ConvertKit</option>
            <option value="buttondown">Buttondown</option>
            <option value="beehiiv">beehiiv</option>
            <option value="custom">Custom (form action URL)</option>
          </select>
        </FieldRow>
        <FieldRow label="List / form ID">
          <input
            type="text"
            value={get("newsletterListId")}
            onChange={(e) => onChange({ newsletterListId: e.target.value })}
            placeholder="abc123 or full embed URL"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Analytics & UTM">
        <FieldRow label="Google Analytics measurement ID">
          <input
            type="text"
            value={get("gaMeasurementId")}
            onChange={(e) => onChange({ gaMeasurementId: e.target.value })}
            placeholder="G-XXXXXXXX"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
        <FieldRow
          label="Default UTM template"
          hint="Appended to outbound links from your CMS. Tokens: {medium}, {campaign}."
        >
          <input
            type="text"
            value={get("campaignUtmTemplate")}
            onChange={(e) => onChange({ campaignUtmTemplate: e.target.value })}
            placeholder="utm_source=tcgstudio&utm_medium={medium}&utm_campaign={campaign}"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      </Section>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Storefront                                                             */
/* ---------------------------------------------------------------------- */

function StorefrontTab({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const get = useCallback(
    (k: string) => (typeof data[k] === "string" ? (data[k] as string) : ""),
    [data],
  );
  const getBool = useCallback(
    (k: string, dflt = false) =>
      typeof data[k] === "boolean" ? (data[k] as boolean) : dflt,
    [data],
  );
  const enabled = getBool("enabled");

  return (
    <section className="space-y-4">
      <Section
        title={enabled ? "Storefront enabled" : "Storefront disabled"}
        subtitle={enabled ? "live" : "off"}
      >
        <p className="text-[11px] text-ink-500">
          Toggle the public store at <code className="font-mono">/shop</code> on
          your project's public site. While disabled, products stay in draft and
          the page returns 404.
        </p>
        <FieldRow label="Enabled">
          <button
            type="button"
            onClick={() => onChange({ enabled: !enabled })}
            className={[
              "rounded border px-3 py-1 text-[11px] transition-colors",
              enabled
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
            ].join(" ")}
          >
            {enabled ? "Storefront is live" : "Storefront is off — click to enable"}
          </button>
        </FieldRow>
        <FieldRow
          label="External storefront URL (optional)"
          hint="If you sell elsewhere (Itch.io, Gumroad, your own Shopify), point /shop to it."
        >
          <input
            type="url"
            value={get("storefrontUrl")}
            onChange={(e) => onChange({ storefrontUrl: e.target.value })}
            placeholder="https://your-studio.itch.io/saga"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Product types">
        <p className="text-[11px] text-ink-500">
          What kinds of products this project offers. Affects the store
          navigation and the checkout flow each product uses.
        </p>
        <div className="grid grid-cols-1 gap-1.5 md:grid-cols-3">
          <ToggleRow
            label="Digital downloads"
            hint="PDFs, card images, JSON bundles."
            value={getBool("supportsDigital")}
            onChange={(v) => onChange({ supportsDigital: v })}
          />
          <ToggleRow
            label="Physical goods"
            hint="Printed cards, decks, posters."
            value={getBool("supportsPhysical")}
            onChange={(v) => onChange({ supportsPhysical: v })}
          />
          <ToggleRow
            label="Subscriptions"
            hint="Monthly access, season pass."
            value={getBool("supportsSubscription")}
            onChange={(v) => onChange({ supportsSubscription: v })}
          />
        </div>
      </Section>

      <Section title="Fulfillment">
        <FieldRow label="Mode">
          <select
            value={get("fulfillmentMode") || "none"}
            onChange={(e) => onChange({ fulfillmentMode: e.target.value })}
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          >
            <option value="none">None / digital only</option>
            <option value="print-on-demand">Print on demand (Printify, MakePlayingCards)</option>
            <option value="manual">Manual ship (you fulfill)</option>
            <option value="dropship">Dropship (third-party)</option>
          </select>
        </FieldRow>
        <FieldRow label="Print-on-demand provider key (if applicable)">
          <input
            type="text"
            value={get("podProviderKey")}
            onChange={(e) => onChange({ podProviderKey: e.target.value })}
            placeholder="printify, mpc, drivethru…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 font-mono text-[11px] text-ink-100"
          />
        </FieldRow>
      </Section>

      <Section title="Policies">
        <FieldRow label="Refund policy (markdown)">
          <textarea
            value={get("refundPolicyMd")}
            onChange={(e) => onChange({ refundPolicyMd: e.target.value })}
            rows={4}
            placeholder="Refunds within 14 days for unopened physical items…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
          />
        </FieldRow>
        <FieldRow label="Shipping policy (markdown)">
          <textarea
            value={get("shippingPolicyMd")}
            onChange={(e) => onChange({ shippingPolicyMd: e.target.value })}
            rows={4}
            placeholder="Ships from EU within 3–5 business days…"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-[11px] text-ink-100"
          />
        </FieldRow>
        <FieldRow label="Terms URL">
          <input
            type="url"
            value={get("termsUrl")}
            onChange={(e) => onChange({ termsUrl: e.target.value })}
            placeholder="https://yourstudio.com/terms"
            className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-ink-100"
          />
        </FieldRow>
      </Section>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* Layout primitives                                                      */
/* ---------------------------------------------------------------------- */

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
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink-100">{title}</h2>
        {subtitle && (
          <span className="text-[10px] uppercase tracking-wider text-ink-500">
            {subtitle}
          </span>
        )}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[10px] text-ink-500">{hint}</p>}
    </label>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={[
        "flex flex-col items-start gap-0.5 rounded border p-2 text-left transition-colors",
        value
          ? "border-accent-500/40 bg-accent-500/10 text-accent-200"
          : "border-ink-700 bg-ink-900 text-ink-300 hover:bg-ink-800",
      ].join(" ")}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <span
          className={[
            "inline-block h-2 w-2 rounded-full",
            value ? "bg-accent-500" : "bg-ink-600",
          ].join(" ")}
        />
        {label}
      </span>
      {hint && <span className="text-[10px] text-ink-500">{hint}</span>}
    </button>
  );
}
