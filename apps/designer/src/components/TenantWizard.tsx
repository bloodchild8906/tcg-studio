/**
 * Tenant registration wizard.
 *
 * Replaces the minimal "name + slug" create form with a multi-step
 * flow that captures everything needed to spin up a fully-branded
 * workspace on first save:
 *
 *   1. Workspace identity — company name, slug, tenant archetype.
 *   2. White-label branding — product name, tagline, accent color.
 *   3. Review — confirm + create.
 *
 * The wizard passes brandingJson { productName, tagline, accent }
 * into the create-tenant call. The backend auto-seeds the public CMS
 * landing + login pages using those values, so the user's first view
 * of their public site already reflects their brand instead of a
 * "Welcome." placeholder.
 *
 * Lives in its own component file because it's a self-contained
 * multi-step flow with its own state graph; embedding it inside
 * SettingsView would crowd the file.
 */

import { useState } from "react";
import { useDesigner } from "@/store/designerStore";

type TenantType = "solo" | "studio" | "publisher" | "school" | "reseller";

interface WizardState {
  step: 1 | 2 | 3;
  name: string;
  slug: string;
  tenantType: TenantType;
  productName: string;
  tagline: string;
  accent: string;
}

const TENANT_TYPE_OPTIONS: Array<{
  value: TenantType;
  label: string;
  blurb: string;
}> = [
  {
    value: "solo",
    label: "Solo creator",
    blurb: "One designer shipping a complete game end-to-end.",
  },
  {
    value: "studio",
    label: "Indie studio",
    blurb: "Small team, in-flight set, review queues.",
  },
  {
    value: "publisher",
    label: "Publisher",
    blurb: "Multiple games / imprints under one workspace.",
  },
  {
    value: "school",
    label: "School / classroom",
    blurb: "Each student or team gets a project.",
  },
  {
    value: "reseller",
    label: "Reseller",
    blurb: "Provision and manage child tenants for clients.",
  },
];

function autoSlug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The wizard renders inline (replacing the old form). Pass `onClose`
 * to dismiss without creating; `onCreated` fires after a successful
 * create so the parent can refresh the workspace list.
 */
export function TenantWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const createTenant = useDesigner((s) => s.createTenant);
  const [state, setState] = useState<WizardState>({
    step: 1,
    name: "",
    slug: "",
    tenantType: "studio",
    productName: "",
    tagline: "",
    accent: "#7c3aed",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function next() {
    setState((s) => ({ ...s, step: Math.min(3, s.step + 1) as 1 | 2 | 3 }));
  }
  function back() {
    setState((s) => ({ ...s, step: Math.max(1, s.step - 1) as 1 | 2 | 3 }));
  }

  // Step 1 gate — name is the only hard requirement; slug auto-fills
  // from the name when the user doesn't override it.
  const step1Valid = state.name.trim().length > 0;
  // Step 2 has no required fields — every white-label token has a
  // sensible default. We let the user advance with empty inputs.

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const slug = (state.slug.trim() || autoSlug(state.name)) || "workspace";
      const productName = state.productName.trim() || state.name.trim();
      const tagline = state.tagline.trim();
      // Branding shape mirrors what the backend reads when seeding
      // the CMS landing — see lib/cmsDefaults.ts.
      const brandingJson: Record<string, unknown> = { productName };
      if (tagline) brandingJson.tagline = tagline;
      if (state.accent) brandingJson.accent = state.accent;
      await createTenant({
        name: state.name.trim(),
        slug,
        tenantType: state.tenantType,
        brandingJson,
      });
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border-2 border-dashed border-accent-500/40 bg-accent-500/5 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-accent-300">
            New workspace · Step {state.step} of 3
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-ink-50">
            {state.step === 1 && "Workspace identity"}
            {state.step === 2 && "White-label your studio"}
            {state.step === 3 && "Review & create"}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-[11px] text-ink-500 hover:text-ink-300"
        >
          Cancel
        </button>
      </header>

      {/* Step indicator — three pill segments that fill in as the
       *  user advances. Cheap progress signal that doesn't cost
       *  vertical space. */}
      <div className="mb-4 grid grid-cols-3 gap-1">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className={
              n <= state.step
                ? "h-1 rounded-full bg-accent-500"
                : "h-1 rounded-full bg-ink-800"
            }
          />
        ))}
      </div>

      {error && (
        <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400">
          {error}
        </p>
      )}

      {state.step === 1 && (
        <div className="space-y-3">
          <Field label="Company / studio name" hint="Shown in the workspace switcher.">
            <input
              type="text"
              value={state.name}
              onChange={(e) => {
                update("name", e.target.value);
                // Backfill the slug from the name UNTIL the user
                // edits the slug field manually. After that we leave
                // their slug alone.
                if (!state.slug) update("slug", autoSlug(e.target.value));
              }}
              placeholder="Arcforge Card Foundry"
              autoFocus
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field
            label="URL slug"
            hint="Subdomain. Lowercase letters, numbers, hyphens."
          >
            <input
              type="text"
              value={state.slug}
              onChange={(e) =>
                update(
                  "slug",
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
                )
              }
              placeholder={autoSlug(state.name) || "workspace"}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-100"
            />
          </Field>
          <Field
            label="Workspace type"
            hint="Drives the dashboard layout and tenant-type-specific suggestions."
          >
            <div className="grid grid-cols-1 gap-1.5">
              {TENANT_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update("tenantType", opt.value)}
                  className={[
                    "flex items-start gap-2 rounded border p-2 text-left",
                    state.tenantType === opt.value
                      ? "border-accent-500/60 bg-accent-500/10"
                      : "border-ink-700 bg-ink-900 hover:border-ink-600",
                  ].join(" ")}
                >
                  <span className="mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-ink-600">
                    {state.tenantType === opt.value && (
                      <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-ink-100">
                      {opt.label}
                    </span>
                    <span className="block text-[10px] text-ink-400">
                      {opt.blurb}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {state.step === 2 && (
        <div className="space-y-3">
          <p className="text-[11px] text-ink-400">
            Used to seed the white-labeled login page and the public landing
            page hero. You can change all of this later in Settings → Brand.
          </p>
          <Field
            label="Product name"
            hint="Shown above your card games. Defaults to the workspace name."
          >
            <input
              type="text"
              value={state.productName}
              onChange={(e) => update("productName", e.target.value)}
              placeholder={state.name || "Arcforge Studio"}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field label="Tagline" hint="One line, ~80 characters. Appears under the hero title.">
            <input
              type="text"
              value={state.tagline}
              onChange={(e) => update("tagline", e.target.value)}
              placeholder="Forge legendary cards. Print, playtest, ship."
              maxLength={120}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field label="Accent color" hint="Used in buttons, links, and active nav.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={state.accent}
                onChange={(e) => update("accent", e.target.value)}
                className="h-8 w-12 cursor-pointer rounded border border-ink-700 bg-ink-900"
              />
              <input
                type="text"
                value={state.accent}
                onChange={(e) => update("accent", e.target.value)}
                placeholder="#7c3aed"
                className="block w-32 rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-100"
              />
            </div>
          </Field>
        </div>
      )}

      {state.step === 3 && (
        <div className="space-y-3">
          <p className="text-[11px] text-ink-400">
            Ready to create. We'll spin up your workspace, seed a default public
            site with your branding, and drop you on the dashboard.
          </p>
          <ReviewRow label="Workspace" value={state.name} />
          <ReviewRow
            label="Slug"
            value={state.slug || autoSlug(state.name) || "workspace"}
            mono
          />
          <ReviewRow
            label="Type"
            value={
              TENANT_TYPE_OPTIONS.find((t) => t.value === state.tenantType)?.label ??
              state.tenantType
            }
          />
          <ReviewRow
            label="Product name"
            value={state.productName.trim() || state.name}
          />
          {state.tagline && <ReviewRow label="Tagline" value={state.tagline} />}
          <ReviewRow
            label="Accent"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm border border-ink-700"
                  style={{ background: state.accent }}
                />
                <code className="font-mono text-[11px]">{state.accent}</code>
              </span>
            }
          />
          <div className="rounded border border-ink-700 bg-ink-900 p-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              Auto-seeded
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-300">
              <li>+ Public site with home + login pages</li>
              <li>+ Branded hero using your product name + tagline</li>
              <li>+ Tenant-type dashboard preset</li>
            </ul>
          </div>
        </div>
      )}

      <footer className="mt-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={back}
          disabled={state.step === 1 || busy}
          className="rounded border border-ink-700 bg-ink-900 px-3 py-1.5 text-[11px] text-ink-300 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Back
        </button>
        {state.step < 3 ? (
          <button
            type="button"
            onClick={next}
            disabled={state.step === 1 ? !step1Valid : false}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Continue →
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-[11px] font-medium text-accent-300 hover:border-accent-500/70 hover:bg-accent-500/25 disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        )}
      </footer>
    </div>
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
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-0.5 text-[10px] text-ink-500">{hint}</p>}
    </label>
  );
}

function ReviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <span className={mono ? "font-mono text-[11px] text-ink-100" : "text-ink-100"}>
        {value}
      </span>
    </div>
  );
}
