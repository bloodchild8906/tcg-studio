/**
 * Project creation wizard.
 *
 * Mirrors the tenant signup wizard at the next level down. Steps:
 *
 *   1. Project identity — name, slug, status.
 *   2. Theme — productName/tagline/accent for the project's public
 *      site landing page.
 *   3. Owner login — email of the user who can sign in to this
 *      project (creator does NOT auto-get access; they must specify
 *      themselves here if they want in).
 *   4. Review — confirm + create.
 *
 * On submit the API creates the project, the project_owner
 * ProjectMembership row, the project's public site (game CmsSite),
 * and the home + login pages with the wizard's branding baked into
 * the hero. One round-trip, fully scaffolded.
 */

import { useState } from "react";
import { useDesigner } from "@/store/designerStore";

interface WizardState {
  step: 1 | 2 | 3 | 4;
  name: string;
  slug: string;
  status: "idea" | "draft" | "prototype" | "playtesting" | "production" | "released" | "archived";
  productName: string;
  tagline: string;
  accent: string;
  ownerEmail: string;
}

const STATUS_OPTIONS: Array<{
  value: WizardState["status"];
  label: string;
}> = [
  { value: "idea", label: "Idea" },
  { value: "draft", label: "Draft" },
  { value: "prototype", label: "Prototype" },
  { value: "playtesting", label: "Playtesting" },
  { value: "production", label: "Production" },
  { value: "released", label: "Released" },
];

function autoSlug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ProjectWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: () => void;
}) {
  const createProject = useDesigner((s) => s.createProject);
  const currentUser = useDesigner((s) => s.currentUser);

  const [state, setState] = useState<WizardState>({
    step: 1,
    name: "",
    slug: "",
    status: "draft",
    productName: "",
    tagline: "",
    accent: "#7c3aed",
    // Default the owner email to the current user — most of the time
    // the creator IS the owner. The user can override it on step 3
    // when delegating ownership to someone else.
    ownerEmail: currentUser?.email ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function next() {
    setState((s) => ({ ...s, step: Math.min(4, s.step + 1) as 1 | 2 | 3 | 4 }));
  }
  function back() {
    setState((s) => ({ ...s, step: Math.max(1, s.step - 1) as 1 | 2 | 3 | 4 }));
  }

  const step1Valid = state.name.trim().length > 0;
  // Step 2 has no required fields — accents and taglines are optional.
  // Step 3 requires a valid email, but we let HTML validation catch
  // the obvious bad shapes; the API still validates on submit.
  const step3Valid = /^\S+@\S+\.\S+$/.test(state.ownerEmail.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const slug = (state.slug.trim() || autoSlug(state.name)) || "project";
      const productName = state.productName.trim() || state.name.trim();
      const tagline = state.tagline.trim();
      const brandingJson: Record<string, unknown> = { productName };
      if (tagline) brandingJson.tagline = tagline;
      if (state.accent) brandingJson.accent = state.accent;
      await createProject({
        name: state.name.trim(),
        slug,
        description: state.tagline.trim() || undefined,
        ownerEmail: state.ownerEmail.trim().toLowerCase(),
        // status + brandingJson get accepted by the API even when not
        // typed on the store-side createProject. The store passes them
        // through.
        ...({ status: state.status, brandingJson } as object),
      } as never);
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
            New project · Step {state.step} of 4
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-ink-50">
            {state.step === 1 && "Project identity"}
            {state.step === 2 && "Theme & landing page"}
            {state.step === 3 && "Project owner"}
            {state.step === 4 && "Review & create"}
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

      <div className="mb-4 grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((n) => (
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
          <Field label="Project name" hint="Saga, Spell Forge, Realm of Echoes…">
            <input
              type="text"
              value={state.name}
              onChange={(e) => {
                update("name", e.target.value);
                if (!state.slug) update("slug", autoSlug(e.target.value));
              }}
              placeholder="Saga: Tales Unchained"
              autoFocus
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field
            label="URL slug"
            hint="Subdomain segment. Lowercase letters, numbers, hyphens."
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
              placeholder={autoSlug(state.name) || "project"}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 font-mono text-[11px] text-ink-100"
            />
          </Field>
          <Field label="Status" hint="Where is this project in the lifecycle?">
            <select
              value={state.status}
              onChange={(e) =>
                update("status", e.target.value as WizardState["status"])
              }
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {state.step === 2 && (
        <div className="space-y-3">
          <p className="text-[11px] text-ink-400">
            We auto-create a public site for this project with a landing page
            and a login page. These tokens are baked into the hero. Edit
            anytime via the project's CMS.
          </p>
          <Field
            label="Public name"
            hint="Defaults to the project name. Useful when the codename and the public title differ."
          >
            <input
              type="text"
              value={state.productName}
              onChange={(e) => update("productName", e.target.value)}
              placeholder={state.name}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field label="Tagline" hint="One-liner shown under the hero title.">
            <input
              type="text"
              value={state.tagline}
              onChange={(e) => update("tagline", e.target.value)}
              placeholder="A skirmish duel game of fate and steel."
              maxLength={120}
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
            />
          </Field>
          <Field label="Accent color" hint="Inherited from tenant if left blank.">
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
            The owner is the user who can sign in to this project and manage it.
            <strong className="text-ink-200">
              {" "}You will NOT auto-get access
            </strong>{" "}
            unless you put your own email here — projects have their own
            membership separate from the tenant.
          </p>
          <Field
            label="Owner email"
            hint="Must already have a user account in this tenant. Magic-link invites land later."
          >
            <input
              type="email"
              value={state.ownerEmail}
              onChange={(e) => update("ownerEmail", e.target.value)}
              placeholder="owner@example.com"
              className="block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-xs text-ink-100"
              required
            />
          </Field>
          {currentUser?.email &&
            state.ownerEmail.trim().toLowerCase() !==
              currentUser.email.toLowerCase() && (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                Heads up — you'll be a tenant admin who can manage members but
                you won't be able to sign in to{" "}
                <code className="font-mono">{state.slug || "this project"}</code>
                's editor until the owner adds you.
              </p>
            )}
        </div>
      )}

      {state.step === 4 && (
        <div className="space-y-3">
          <p className="text-[11px] text-ink-400">
            Ready to create. We'll set up the project, grant ownership, spin
            up its public site, and seed the landing + login pages with your
            theme tokens.
          </p>
          <ReviewRow label="Name" value={state.name} />
          <ReviewRow
            label="Slug"
            value={state.slug || autoSlug(state.name) || "project"}
            mono
          />
          <ReviewRow
            label="Status"
            value={
              STATUS_OPTIONS.find((s) => s.value === state.status)?.label ??
              state.status
            }
          />
          <ReviewRow
            label="Public name"
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
          <ReviewRow label="Owner" value={state.ownerEmail} mono />
          <div className="rounded border border-ink-700 bg-ink-900 p-2">
            <p className="text-[10px] uppercase tracking-wider text-ink-500">
              Auto-seeded
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-300">
              <li>+ Project public site with home + login pages</li>
              <li>+ Branded hero using your name + tagline</li>
              <li>+ project_owner membership for the owner</li>
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
        {state.step < 4 ? (
          <button
            type="button"
            onClick={next}
            disabled={
              (state.step === 1 && !step1Valid) ||
              (state.step === 3 && !step3Valid)
            }
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
            {busy ? "Creating…" : "Create project"}
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
