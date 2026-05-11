import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { UserProfile } from "@/lib/api";
import { useAssetPicker } from "@/components/AssetPicker";

/**
 * Profile editor — accessible from the header avatar dropdown.
 *
 * Edits the current user's displayName, bio, timezone, and avatar.
 * The avatar uses an existing tenant asset (picked via AssetPicker)
 * — there's no separate "upload directly to user" path because users
 * are already members of a tenant whose assets are accessible to them.
 *
 * Email + name (legacy) are read-only here; changing the email is a
 * security-sensitive flow that lives in a future "Account" page.
 */
export function ProfileView() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const picker = useAssetPicker((picked) => {
    setAvatarAssetId(picked.id);
  });

  useEffect(() => {
    let alive = true;
    api
      .fetchMyProfile()
      .then((p) => {
        if (!alive) return;
        setProfile(p);
        setDisplayName(p.displayName ?? "");
        setBio(p.bio);
        setTimezone(p.timezone);
        setAvatarAssetId(p.avatarAssetId);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "load failed"),
      );
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateMyProfile({
        displayName: displayName.trim() || null,
        bio,
        timezone,
        avatarAssetId,
      });
      setProfile(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-400">
        Loading profile…
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-ink-950">
      <div className="mx-auto max-w-3xl space-y-6 p-8">
        <header>
          <p className="text-[11px] uppercase tracking-wider text-ink-400">
            Account
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-ink-50">Profile</h1>
          <p className="mt-1 text-xs text-ink-400">
            How you appear across your tenants and to teammates in chat,
            tasks, and audit log entries.
          </p>
        </header>

        <section className="space-y-3 rounded-lg border border-ink-800 bg-ink-900 p-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-ink-700 bg-ink-800">
              {avatarAssetId ? (
                <img
                  src={api.assetBlobUrl(avatarAssetId)}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xl font-semibold text-ink-500">?</span>
              )}
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={picker.open}
                className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1 text-xs text-accent-300 hover:bg-accent-500/25"
              >
                {avatarAssetId ? "Change avatar" : "Pick avatar"}
              </button>
              {avatarAssetId && (
                <button
                  type="button"
                  onClick={() => setAvatarAssetId(null)}
                  className="ml-2 rounded border border-ink-700 bg-ink-800 px-3 py-1 text-xs text-ink-300 hover:bg-ink-700"
                >
                  Remove
                </button>
              )}
              <p className="text-[11px] text-ink-500">
                Pick from any tenant's asset library.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-ink-800 bg-ink-900 p-4">
          <Field label="Display name" hint="Shown in chat, tasks, audit log.">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={profile.name}
              className={INPUT}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={profile.email}
              disabled
              className={`${INPUT} cursor-not-allowed opacity-60`}
            />
          </Field>
          <Field label="Bio" hint="Markdown welcome — kept under 4 KB.">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              className={INPUT}
            />
          </Field>
          <Field
            label="Timezone"
            hint="IANA name. Affects relative time labels."
          >
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className={INPUT}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </Field>
        </section>

        {error && (
          <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-accent-400 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save profile"}
          </button>
          {saved && (
            <span className="text-xs text-emerald-300">Profile saved.</span>
          )}
        </div>
      </div>
      {picker.element}
    </div>
  );
}

const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Stockholm",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

const INPUT =
  "block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";

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
