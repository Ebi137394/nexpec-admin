// ════════════════════════════════════════════════════════════════════════════
//  src/i18n/config.ts — locale registry
//
//  Cookie-based locale (no URL restructure). Locale is persisted in the
//  NEXT_LOCALE cookie, switched via setLocaleAction.
//
//  Adding a language:
//    1. Create messages/<lang>.json (copy en.json as a starting point)
//    2. Add the code to LOCALES below
//    3. Done — LocaleSwitcher picks it up automatically.
// ════════════════════════════════════════════════════════════════════════════

export const LOCALES = ['en', 'fr', 'es', 'ar'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_COOKIE = 'NEXT_LOCALE';

export const LOCALE_LABELS: Record<Locale, { native: string; english: string; flag: string }> = {
  en: { native: 'English',  english: 'English',  flag: '🇺🇸' },
  fr: { native: 'Français', english: 'French',   flag: '🇫🇷' },
  es: { native: 'Español',  english: 'Spanish',  flag: '🇪🇸' },
  ar: { native: 'العربية',  english: 'Arabic',   flag: '🇸🇦' },
};

/** RTL locales — we set <html dir="rtl"> for these. */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set(['ar']);

export function isRTL(locale: string): boolean {
  return RTL_LOCALES.has(locale as Locale);
}

export function isValidLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}
