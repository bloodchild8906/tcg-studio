import { useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { ApiKey, CreatedApiKey } from "@/lib/api";

/**
 * API key management panel (sec 36.7).
 *
 * Lists tenant-scoped keys, lets the user create new ones, and revoke
 * existing ones. The CRITICAL detail: the plaintext token is shown
 * exactly once, immediately after creation. After dismissing the
 * "save your token" dialog the user can never retrieve it again — the
 * server stores only a sha256 hash.
 *
 * Scopes are rendered as comma-separated tags. The default UI lets
 * users pick from a curated list (cards:read, cards:write, etc.); a
 * "raw" textarea is exposed for users who want exotic combinations.
 */
export function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setKeys(await api.listApiKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function revoke(k: ApiKey) {
    if (!confirm(`Revoke "${k.name}"? Anything using this token stops working immediately.`))
      return;
    await api.revokeApiKey(k.id);
    await refresh();
  }

  async function destroy(k: ApiKey) {
    if (!confirm(`Permanently delete "${k.name}"? This drops the audit-log link too.`)) return;
    await api.deleteApiKey(k.id);
    await refresh();
  }

  return (
    <section className="rounded-lg border border-ink-800 bg-ink-900 p-4">
      <header className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink-100">API keys</h3>
          <p className="text-[11px] text-ink-500">
            Tokens for third-party scripts, CI bots, or your own integrations.
            Authenticate by sending{" "}
            <code className="font-mono text-ink-300">
              Authorization: Bearer tcgs_…
            </code>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25"
        >
          + New key
        </button>
      </header>

      {error && (
        <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-4 text-center text-sm text-ink-500">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-500">
          No API keys yet. Create one to grant external access.
        </p>
      ) : (
        <ul className="divide-y divide-ink-800 rounded border border-ink-800">
          {keys.map((k) => (
            <li
              key={k.id}
              className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 truncate text-sm font-medium text-ink-100">
                  {k.name}
                  {k.revokedAt && (
                    <span className="rounded bg-danger-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger-400">
                      revoked
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-ink-500">
                  {k.tokenPrefix}…
                </p>
                <p className="mt-1 text-[11px] text-ink-400">
                  {(k.scopesJson ?? []).length === 0
                    ? "No scopes (read-only public-safe endpoints only)"
                    : (k.scopesJson as string[]).join(", ")}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  Created {new Date(k.createdAt).toLocaleString()}
                  {k.lastUsedAt
                    ? ` · last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : " · never used"}
                  {k.expiresAt
                    ? ` · expires ${new Date(k.expiresAt).toLocaleString()}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!k.revokedAt && (
                  <button
                    type="button"
                    onClick={() => revoke(k)}
                    className="rounded border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-200 hover:bg-ink-700"
                  >
                    Revoke
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => destroy(k)}
                  className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1 text-[11px] text-danger-400 hover:bg-danger-500/20"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <CreateKeyModal
          onClose={() => setCreating(false)}
          onCreated={async (c) => {
            setCreating(false);
            setCreated(c);
            await refresh();
          }}
        />
      )}

      {created && (
        <CreatedKeyModal
          created={created}
          onClose={() => setCreated(null)}
        />
      )}
    </section>
  );
}

/* ====================================================================== */
/* Create modal                                                            */
/* ====================================================================== */

const SUGGESTED_SCOPES = [
  "cards:read",
  "cards:write",
  "assets:read",
  "assets:write",
  "projects:read",
  "exports:create",
  "cms:read",
  "cms:write",
  "webhooks:manage",
];

function CreateKeyModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: CreatedApiKey) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expires, setExpires] = useState<"never" | "30d" | "90d" | "365d">("never");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const expiresAt =
        expires === "never"
          ? null
          : new Date(
              Date.now() +
                Number(expires.replace("d", "")) * 24 * 60 * 60 * 1000,
            ).toISOString();
      const created = await api.createApiKey({
        name,
        scopes: Array.from(picked),
        expiresAt,
      });
      await onCreated(created);
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function toggle(s: string) {
    const next = new Set(picked);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setPicked(next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-[440px] rounded-lg border border-ink-700 bg-ink-900 p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-medium text-ink-100">New API key</h3>
        <label className="mb-3 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Name (admin label)
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="CI bot, Dashboard, etc."
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40"
          />
        </label>
        <fieldset className="mb-3">
          <legend className="mb-1 text-[11px] uppercase tracking-wider text-ink-400">
            Scopes
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_SCOPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggle(s)}
                className={[
                  "rounded border px-2 py-0.5 font-mono text-[10px]",
                  picked.has(s)
                    ? "border-accent-500/60 bg-accent-500/15 text-accent-300"
                    : "border-ink-700 bg-ink-800 text-ink-300 hover:bg-ink-700",
                ].join(" ")}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-ink-500">
            No scopes selected = read-only public endpoints only.
          </p>
        </fieldset>
        <label className="mb-4 block">
          <span className="block text-[11px] uppercase tracking-wider text-ink-400">
            Expires
          </span>
          <select
            value={expires}
            onChange={(e) =>
              setExpires(e.target.value as "never" | "30d" | "90d" | "365d")
            }
            className="mt-1 block w-full rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          >
            <option value="never">Never</option>
            <option value="30d">30 days</option>
            <option value="90d">90 days</option>
            <option value="365d">1 year</option>
          </select>
        </label>
        {err && (
          <p className="mb-3 rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-ink-300 hover:bg-ink-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name}
            className="rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create key"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ====================================================================== */
/* Created (one-time-display) modal                                        */
/* ====================================================================== */

function CreatedKeyModal({
  created,
  onClose,
}: {
  created: CreatedApiKey;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-6 backdrop-blur"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[520px] rounded-lg border border-emerald-500/40 bg-ink-900 p-5 shadow-2xl">
        <h3 className="mb-1 text-base font-medium text-emerald-300">
          API key created — save it now
        </h3>
        <p className="mb-3 text-xs text-ink-400">
          Copy the token below. Once you close this dialog{" "}
          <strong className="text-ink-200">we can't show it to you again</strong>{" "}
          — only the hash is stored. If you lose it, create a new key.
        </p>
        <div className="rounded border border-ink-700 bg-ink-950 p-2.5 font-mono text-xs text-accent-300">
          {created.plaintext}
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(created.plaintext);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="mt-2 rounded border border-accent-500/40 bg-accent-500/15 px-3 py-1.5 text-xs text-accent-300 hover:bg-accent-500/25"
        >
          {copied ? "Copied!" : "Copy token"}
        </button>
        <details className="mt-4 text-xs text-ink-300">
          <summary className="cursor-pointer text-ink-400 hover:text-ink-200">
            curl example
          </summary>
          <pre className="mt-2 overflow-auto rounded border border-ink-800 bg-ink-950 p-2 font-mono text-[11px] text-ink-300">
            {created.curlExample}
          </pre>
        </details>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/25"
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}
