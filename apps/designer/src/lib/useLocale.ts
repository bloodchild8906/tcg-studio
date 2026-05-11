import { useSyncExternalStore } from "react";
import { getLocale, setLocale, subscribe } from "@/lib/i18n";

/**
 * React hook around the i18n module's locale subscription.
 *
 * Returns `[locale, setLocale]` so consumers can render locale-
 * sensitive content and offer language switchers without each
 * component re-implementing the subscription dance.
 */
export function useLocale(): [string, (next: string) => void] {
  const locale = useSyncExternalStore(
    subscribe,
    getLocale,
    // SSR snapshot — same as client when hydration runs.
    () => "en",
  );
  return [locale, setLocale];
}
