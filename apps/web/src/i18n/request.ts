// ════════════════════════════════════════════════════════════════════════════
//  src/i18n/request.ts — next-intl request config
//
//  Reads the locale from the NEXT_LOCALE cookie. Falls back to DEFAULT_LOCALE.
//  Loads the matching messages/<locale>.json. If the file isn't shipped we
//  silently fall back to English so the app never crashes on a missing dict.
// ════════════════════════════════════════════════════════════════════════════

import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from './config';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale = isValidLocale(raw) ? raw : DEFAULT_LOCALE;

  let messages: Record<string, unknown>;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return { locale, messages };
});
