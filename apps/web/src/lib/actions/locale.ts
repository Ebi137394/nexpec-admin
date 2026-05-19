// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/locale.ts — server action to switch the active locale
//
//  Stores the chosen locale in the NEXT_LOCALE cookie (1-year max-age) and
//  redirects back to `returnTo`. next-intl picks the cookie up on the next
//  request via src/i18n/request.ts.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isValidLocale,
} from '@/i18n/config';

export async function setLocaleAction(formData: FormData): Promise<void> {
  const rawLocale = formData.get('locale');
  const returnTo = (formData.get('returnTo') as string) || '/';

  const locale = isValidLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1y
    sameSite: 'lax',
  });

  // Revalidate the destination so the new locale renders immediately.
  try {
    revalidatePath(returnTo);
  } catch {
    /* ignore */
  }
  redirect(returnTo);
}
