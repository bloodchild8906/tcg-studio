import { useEffect, useRef, useState } from "react";
import { useDesigner } from "@/store/designerStore";
import { assetBlobUrl } from "@/lib/api";

/**
 * Header avatar dropdown.
 *
 * Shows the current user's name + email at the top, then quick links:
 *   • Profile             → switches to the profile view
 *   • Settings            → switches to the settings view
 *   • Sign out            → clears the session
 *
 * Renders the user's avatar (from `avatarAssetId` if set) or their
 * initials over an accent background as a fallback.
 */
export function ProfileDropdown() {
  const currentUser = useDesigner((s) => s.currentUser);
  const setView = useDesigner((s) => s.setView);
  const signOut = useDesigner((s) => s.signOut);

  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Pull avatarAssetId from preferences if it landed there (the
  // profile fetch sets `currentUser` only with id/email/name; the
  // avatar lives on the profile record). We re-fetch on demand when
  // the dropdown opens to get the freshest avatar reference.
  const [avatarAssetId, setAvatarAssetId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !currentUser) return;
    let alive = true;
    void import("@/lib/api").then((api) => {
      api
        .fetchMyProfile()
        .then((p) => {
          if (!alive) return;
          setAvatarAssetId(p.avatarAssetId);
          setDisplayName(p.displayName);
        })
        .catch(() => {
          /* ignore */
        });
    });
    return () => {
      alive = false;
    };
  }, [open, currentUser]);

  // Outside-click + escape dismiss.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        buttonRef.current?.contains(e.target as Node) ||
        dropdownRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!currentUser) return null;

  const initials = (displayName ?? currentUser.name)
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-ink-800"
        title={currentUser.email}
      >
        <Avatar assetId={avatarAssetId} initials={initials} />
        <span className="hidden text-xs text-ink-200 md:inline">
          {displayName ?? currentUser.name}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <div
          ref={dropdownRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-md border border-ink-700 bg-ink-900 shadow-xl"
        >
          <header className="flex items-center gap-3 border-b border-ink-800 px-3 py-3">
            <Avatar assetId={avatarAssetId} initials={initials} large />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-100">
                {displayName ?? currentUser.name}
              </p>
              <p className="truncate text-[11px] text-ink-500">
                {currentUser.email}
              </p>
            </div>
          </header>
          <ul>
            <DropdownItem
              onClick={() => {
                setOpen(false);
                setView("profile");
              }}
            >
              Edit profile
            </DropdownItem>
            <DropdownItem
              onClick={() => {
                setOpen(false);
                setView("settings");
              }}
            >
              Workspace settings
            </DropdownItem>
            <li className="my-1 h-px bg-ink-800" role="separator" />
            <DropdownItem
              danger
              onClick={() => {
                setOpen(false);
                signOut();
              }}
            >
              Sign out
            </DropdownItem>
          </ul>
        </div>
      )}
    </div>
  );
}

function Avatar({
  assetId,
  initials,
  large = false,
}: {
  assetId: string | null;
  initials: string;
  large?: boolean;
}) {
  const size = large ? "h-10 w-10" : "h-7 w-7";
  if (assetId) {
    return (
      <img
        src={assetBlobUrl(assetId)}
        alt=""
        className={`${size} rounded-full border border-ink-700 object-cover`}
      />
    );
  }
  return (
    <span
      className={`${size} flex items-center justify-center rounded-full border border-accent-500/40 bg-accent-500/15 text-[11px] font-semibold text-accent-300`}
    >
      {initials || "?"}
    </span>
  );
}

function DropdownItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className={[
          "block w-full px-3 py-2 text-left text-xs",
          danger
            ? "text-danger-400 hover:bg-danger-500/10"
            : "text-ink-200 hover:bg-ink-800",
        ].join(" ")}
      >
        {children}
      </button>
    </li>
  );
}

function ChevronIcon() {
  return (
    <svg className="h-3 w-3 text-ink-500" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
