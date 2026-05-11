import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { BillingSnapshot, PlanRow } from "@/lib/api";

/**
 * Plan + usage display + plan picker (sec 42).
 *
 * Top: current plan card + live usage counters with capacity bars.
 * Below: catalog of available plans with subscribe buttons. We don't
 * wire a payment processor in v0 — subscribe just flips Tenant.planId
 * after recording an audit row. Plug Stripe / Paddle into the
 * /api/v1/billing/subscribe handler when ready.
 */
export function BillingSection() {
  const [snapshot, setSnapshot] = useState<BillingSnapshot | null>(null);
  const [catalog, setCatalog] = useState<PlanRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [s, c] = await Promise.all([
        api.fetchBilling(),
        api.listPlanCatalog(),
      ]);
      setSnapshot(s);
      setCatalog(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function subscribe(slug: string) {
    if (!confirm(`Switch to "${slug}"?`)) return;
    setBusy(true);
    try {
      await api.subscribeToPlan(slug);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!snapshot) {
    return (
      <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
        <h3 className="text-sm font-medium text-ink-100">Billing</h3>
        <p className="py-3 text-center text-sm text-ink-500">Loading…</p>
        {error && (
          <p className="text-xs text-danger-400">{error}</p>
        )}
      </section>
    );
  }

  const limits = snapshot.plan?.limitsJson?.limits ?? {};
  const features = snapshot.plan?.limitsJson?.features ?? {};

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3">
        <h3 className="text-sm font-medium text-ink-100">Billing &amp; plan</h3>
        <p className="text-[11px] text-ink-500">
          Your current subscription, what's included, and how much of it
          you've used.
        </p>
      </header>

      {/* Current plan card */}
      <div className="mb-4 rounded border border-accent-500/30 bg-accent-500/5 p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-base font-semibold text-ink-100">
            {snapshot.plan?.name ?? "(no plan)"}
          </p>
          <p className="text-xs text-ink-400">
            {formatPrice(snapshot.plan)}
          </p>
        </div>
        {snapshot.plan?.description && (
          <p className="mt-1 text-xs text-ink-400">
            {snapshot.plan.description}
          </p>
        )}
        <p className="mt-1 text-[11px] text-ink-500">
          Subscribed since {new Date(snapshot.planSince).toLocaleDateString()}
        </p>
      </div>

      {/* Usage bars */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <UsageRow
          label="Projects"
          current={snapshot.usage.projects}
          cap={limits.projects ?? null}
        />
        <UsageRow
          label="Members"
          current={snapshot.usage.members}
          cap={limits.members ?? null}
        />
        <UsageRow
          label="API keys"
          current={snapshot.usage.apiKeys}
          cap={limits.apiKeys ?? null}
        />
        <UsageRow
          label="Webhooks"
          current={snapshot.usage.webhooks}
          cap={limits.webhooks ?? null}
        />
        <UsageRow
          label="Custom domains"
          current={snapshot.usage.customDomains}
          cap={limits.customDomains ?? null}
        />
        <UsageRow
          label="Plugins"
          current={snapshot.usage.plugins}
          cap={limits.plugins ?? null}
        />
        <UsageRow
          label="Storage"
          current={snapshot.usage.storageMiB}
          cap={limits.storageMiB ?? null}
          unit="MiB"
        />
      </div>

      {/* Feature flags */}
      {Object.keys(features).length > 0 && (
        <div className="mt-4 rounded border border-ink-800 bg-ink-950 p-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
            Included features
          </p>
          <ul className="grid grid-cols-2 gap-1 text-xs">
            {Object.entries(features).map(([k, v]) => (
              <li
                key={k}
                className={`flex items-center gap-1.5 ${
                  v ? "text-emerald-300" : "text-ink-500"
                }`}
              >
                <span aria-hidden="true">{v ? "✓" : "—"}</span>
                <span>{labelForFeature(k)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Catalog */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-ink-400">
          Available plans
        </p>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {catalog.map((p) => {
            const current = snapshot.plan?.id === p.id;
            return (
              <li
                key={p.id}
                className={[
                  "rounded border bg-ink-900 p-3",
                  current ? "border-accent-500/60" : "border-ink-800",
                ].join(" ")}
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-semibold text-ink-100">{p.name}</p>
                  <p className="text-xs text-ink-400">{formatPrice(p)}</p>
                </div>
                {p.description && (
                  <p className="mt-1 text-xs text-ink-400">{p.description}</p>
                )}
                <button
                  type="button"
                  onClick={() => subscribe(p.slug)}
                  disabled={current || busy}
                  className={[
                    "mt-2 w-full rounded border px-3 py-1 text-[11px] font-medium",
                    current
                      ? "cursor-default border-ink-700 bg-ink-800 text-ink-500"
                      : "border-accent-500/40 bg-accent-500/15 text-accent-300 hover:bg-accent-500/25",
                  ].join(" ")}
                >
                  {current ? "Current plan" : `Switch to ${p.name}`}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function UsageRow({
  label,
  current,
  cap,
  unit = "",
}: {
  label: string;
  current: number;
  cap: number | null;
  unit?: string;
}) {
  const unlimited = cap === null;
  const disabled = cap === 0;
  const pct = !unlimited && cap && cap > 0 ? Math.min(100, (current / cap) * 100) : 0;
  const danger = !unlimited && cap !== null && cap > 0 && current >= cap;
  const warn = !unlimited && cap !== null && cap > 0 && current / cap >= 0.8;
  return (
    <div className="rounded border border-ink-800 bg-ink-950 p-2">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-ink-200">{label}</p>
        <p className="text-[11px] text-ink-500">
          {disabled
            ? "Not available on this plan"
            : unlimited
            ? `${current}${unit ? ` ${unit}` : ""} · unlimited`
            : `${current} / ${cap}${unit ? ` ${unit}` : ""}`}
        </p>
      </div>
      {!unlimited && !disabled && (
        <div className="mt-1.5 h-1 overflow-hidden rounded bg-ink-800">
          <div
            className={[
              "h-full transition-all",
              danger
                ? "bg-danger-500"
                : warn
                ? "bg-amber-500"
                : "bg-accent-500",
            ].join(" ")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function formatPrice(p: PlanRow | null): string {
  if (!p) return "—";
  if (p.priceCents === 0) return "Free";
  const usd = (p.priceCents / 100).toFixed(2).replace(/\.00$/, "");
  return `$${usd} / ${p.billingPeriod === "yearly" ? "year" : "month"}`;
}

function labelForFeature(key: string): string {
  const map: Record<string, string> = {
    whiteLabel: "White-label",
    sso: "SSO / SAML",
    advancedExports: "Advanced exports",
    publicMarketplacePublishing: "Marketplace publishing",
  };
  return map[key] ?? key;
}
