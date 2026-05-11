/**
 * Wrapper for the public-tenant `/login` route.
 *
 * Why a wrapper instead of using LoginView directly: LoginView is
 * also the auth wall for the designer (`/admin`), and we don't want
 * the members-area opt-in flag to gate staff sign-in.
 *
 * This component fetches the tenant's public branding, checks
 * `membersAreaEnabled`, and either renders LoginView or redirects
 * to the tenant's public root. After successful sign-in, LoginView
 * navigates to `/admin` by default; we override that here so members
 * land on `/members` instead — keeping end-users out of the staff
 * surface even if they happen to know the URL.
 */

import { useEffect, useState } from "react";
import { apiHealth } from "@/lib/api";
import { LoginView } from "@/components/LoginView";

export function MembersLogin({ tenantSlug }: { tenantSlug: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${apiHealth.base}/api/public/${encodeURIComponent(tenantSlug)}/branding`,
        );
        if (!r.ok) {
          if (alive) setEnabled(false);
          return;
        }
        const b = (await r.json()) as { membersAreaEnabled?: boolean };
        if (!alive) return;
        if (b.membersAreaEnabled === true) {
          setEnabled(true);
        } else {
          setEnabled(false);
          window.location.replace("/");
        }
      } catch {
        if (alive) {
          setEnabled(false);
          window.location.replace("/");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug]);

  // Override the post-login redirect so successful sign-in lands on
  // /members rather than the designer. We do this by listening for
  // localStorage `auth_token` flips — when LoginView writes a token,
  // we bounce. A future refactor would expose a callback prop on
  // LoginView; this is the minimum-invasive shim.
  useEffect(() => {
    if (enabled !== true) return;
    const KEY = "tcgstudio.auth.token";
    let last = localStorage.getItem(KEY);
    const interval = setInterval(() => {
      const now = localStorage.getItem(KEY);
      if (now && now !== last) {
        clearInterval(interval);
        window.location.replace("/members");
      }
      last = now;
    }, 250);
    return () => clearInterval(interval);
  }, [enabled]);

  if (enabled === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 text-sm text-ink-400">
        Loading…
      </div>
    );
  }
  if (!enabled) {
    return null; // already redirecting
  }
  return <LoginView />;
}
