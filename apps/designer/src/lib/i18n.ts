/**
 * Frontend i18n — lightweight string lookup with locale fallback.
 *
 * Strings are organised as a nested map per locale:
 *   STRINGS = {
 *     en: { "header.search": "Search", "tasks.empty": "No tasks yet." },
 *     de: { "header.search": "Suchen" },
 *     ...
 *   }
 *
 * `t("header.search")` returns the active-locale value, falling back
 * to English (the platform's source of truth) when a translation is
 * missing. Keys with parameters use `{name}` placeholders that
 * `t("welcome", { name })` substitutes at render time.
 *
 * Active locale comes from:
 *   1. ?lang= URL query (highest priority — useful for testing)
 *   2. localStorage preference
 *   3. browser language (navigator.language[0..2])
 *   4. "en" fallback
 *
 * Components subscribe via `useLocale()` to re-render when the user
 * switches languages mid-session. Setting via `setLocale("de")`
 * persists to localStorage AND broadcasts to subscribers.
 */

const STRINGS: Record<string, Record<string, string>> = {
  en: {
    "header.search": "Search",
    "header.search.tooltip": "Search (⌘K)",
    "header.notifications.tooltip": "Notifications",
    "header.notifications.empty": "You're all caught up.",
    "header.notifications.markAllRead": "Mark all read",
    "header.profile.editProfile": "Edit profile",
    "header.profile.workspace": "Workspace settings",
    "header.profile.signOut": "Sign out",

    "sidebar.dashboard": "Dashboard",
    "sidebar.projects": "Projects",
    "sidebar.cardTypes": "Card types",
    "sidebar.cards": "Cards",
    "sidebar.assets": "Assets",
    "sidebar.tasks": "Tasks",
    "sidebar.messages": "Messages",
    "sidebar.planning": "Planning",
    "sidebar.publicSite": "Public site",
    "sidebar.settings": "Settings",

    "tasks.empty": "No tasks yet.",
    "tasks.column.todo": "To do",
    "tasks.column.in_progress": "In progress",
    "tasks.column.review": "Review",
    "tasks.column.done": "Done",

    "common.save": "Save",
    "common.cancel": "Cancel",
    "common.delete": "Delete",
    "common.create": "Create",
    "common.loading": "Loading…",
    "common.unsaved": "Unsaved changes",

    "settings.title": "Settings",
    "settings.localization.title": "Localization",
    "settings.localization.defaultLocale": "Default language",
    "settings.localization.supportedLocales": "Languages this tenant publishes in",
    "settings.localization.add": "Add language",
    "settings.localization.note":
      "Visitors see the default unless their ?lang= query or browser preference matches a supported language.",
  },
  de: {
    "header.search": "Suchen",
    "header.notifications.empty": "Alles erledigt.",
    "header.profile.signOut": "Abmelden",
    "sidebar.dashboard": "Übersicht",
    "sidebar.projects": "Projekte",
    "sidebar.cards": "Karten",
    "sidebar.tasks": "Aufgaben",
    "sidebar.settings": "Einstellungen",
    "common.save": "Speichern",
    "common.cancel": "Abbrechen",
    "common.delete": "Löschen",
    "common.loading": "Lädt…",
  },
  fr: {
    "header.search": "Rechercher",
    "header.notifications.empty": "Aucune notification.",
    "header.profile.signOut": "Se déconnecter",
    "sidebar.dashboard": "Tableau de bord",
    "sidebar.projects": "Projets",
    "sidebar.cards": "Cartes",
    "sidebar.tasks": "Tâches",
    "sidebar.settings": "Paramètres",
    "common.save": "Enregistrer",
    "common.cancel": "Annuler",
    "common.delete": "Supprimer",
    "common.loading": "Chargement…",
  },
  es: {
    "header.search": "Buscar",
    "header.notifications.empty": "Todo al día.",
    "header.profile.signOut": "Cerrar sesión",
    "sidebar.dashboard": "Panel",
    "sidebar.projects": "Proyectos",
    "sidebar.cards": "Cartas",
    "sidebar.tasks": "Tareas",
    "sidebar.settings": "Ajustes",
    "common.save": "Guardar",
    "common.cancel": "Cancelar",
    "common.delete": "Eliminar",
    "common.loading": "Cargando…",
  },
  ja: {
    "header.search": "検索",
    "sidebar.dashboard": "ダッシュボード",
    "sidebar.projects": "プロジェクト",
    "sidebar.cards": "カード",
    "sidebar.tasks": "タスク",
    "sidebar.settings": "設定",
    "common.save": "保存",
    "common.cancel": "キャンセル",
    "common.delete": "削除",
    "common.loading": "読み込み中…",
  },
};

const LS_KEY = "tcgstudio.locale";
type Listener = (locale: string) => void;
const listeners = new Set<Listener>();

let _locale = detectInitialLocale();

function detectInitialLocale(): string {
  if (typeof window === "undefined") return "en";
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl) return normalize(fromUrl);
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored) return normalize(stored);
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return normalize(navigator.language);
  }
  return "en";
}

function normalize(tag: string): string {
  return tag.toLowerCase().split("-")[0] || "en";
}

export function getLocale(): string {
  return _locale;
}

export function setLocale(next: string): void {
  const norm = normalize(next);
  if (_locale === norm) return;
  _locale = norm;
  try {
    window.localStorage.setItem(LS_KEY, norm);
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn(norm));
}

export function availableLocales(): string[] {
  return Object.keys(STRINGS);
}

/**
 * Look up a translation key. Falls back to English if the active
 * locale doesn't have the key. Falls back to the key itself if even
 * English is missing — making missing translations obvious in dev.
 *
 * Replaces `{name}` placeholders in the result with `params[name]`.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = STRINGS[_locale] ?? {};
  const en = STRINGS.en ?? {};
  let value = dict[key] ?? en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replaceAll(`{${k}}`, String(v));
    }
  }
  return value;
}

/**
 * React hook that returns the active locale and a setter, and
 * triggers a re-render when another caller changes the locale via
 * `setLocale`.
 *
 * Doesn't import React directly — components import `useState` /
 * `useEffect` and pass them through, OR use this helper which does
 * a small dance with React under-the-hood. To keep this module
 * dependency-free, we implement subscribe/unsubscribe and let the
 * caller wire it up to React's `useSyncExternalStore` if desired.
 */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
