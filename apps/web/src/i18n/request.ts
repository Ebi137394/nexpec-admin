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
  // NOTE: `cookies()` is a DYNAMIC api, and the root layout calls
  // getLocale()/getMessages(), so EVERY page in this app is dynamic by
  // construction. Catching the DynamicServerError here does NOT make a page
  // statically renderable — Next records the dynamic access in its store, not
  // only via the throw, and the render still fails with
  // "Page changed from static to dynamic at runtime, reason: cookies".
  // The fix therefore belongs on the pages that falsely declared themselves
  // static (see /talent/[handle], /agency/[handle]), not here.
  const cookieStore = await cookies();
  const raw = cookieStore.get(LOCALE_COOKIE)?.value;
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
