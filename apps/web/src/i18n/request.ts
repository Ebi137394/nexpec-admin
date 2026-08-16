// ════════════════════════════════════════════════════════════════════════════
//  src/i18n/request.ts — next-intl request config
//
//  Reads the locale from the NEXT_LOCALE cookie. Falls back to DEFAULT_LOCALE.
//  Loads the matching messages/<locale>.json. If the file isn't shipped we
//  silently fall back to English so the app never crashes on a missing dict.
// ════════════════════════════════════════════════════════════════════════════

import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isValidLocale } from './config';

export default getRequestConfig(async () => {
  // `cookies()` is a DYNAMIC api. The root layout calls getLocale()/getMessages(),
  // so this runs for every page — including the ones that opt into static
  // generation with `export const revalidate`. In that context next/headers
  // throws DynamicServerError, which surfaced as a hard 500
  // (FUNCTION_INVOCATION_FAILED, digest DYNAMIC_SERVER_USAGE) on
  // /talent/[handle] and /agency/[handle]: their generateStaticParams returns
  // [] whenever the public supply feed is empty, so nothing is prerendered and
  // every request rendered on demand in static-generation mode.
  //
  // There is no request cookie during static generation, so the correct answer
  // there is simply the default locale — not a crash.
  let raw: string | undefined;
  try {
    const cookieStore = await cookies();
    raw = cookieStore.get(LOCALE_COOKIE)?.value;
  } catch {
    raw = undefined;
  }
  const locale = isValidLocale(raw) ? raw : DEFAULT_LOCALE;

  let messages: AbstractIntlMessages;
  try {
    messages = (await import(`../../messages/${locale}.json`))
      .default as AbstractIntlMessages;
  } catch {
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`))
      .default as AbstractIntlMessages;
  }

  return { locale, messages };
});
