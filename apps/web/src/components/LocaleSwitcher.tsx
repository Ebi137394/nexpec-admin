// ════════════════════════════════════════════════════════════════════════════
//  components/LocaleSwitcher.tsx — header language switcher (server)
//
//  Reads the current locale from next-intl and renders a chip with a hidden
//  <select> overlaid on top. Selecting a language submits the form via the
//  client-side SubmitOnChange helper, which calls the setLocaleAction
//  server action. Cookie-driven; URL never changes.
// ════════════════════════════════════════════════════════════════════════════

import { getLocale } from 'next-intl/server';
import { Globe } from 'lucide-react';
import { LOCALES, LOCALE_LABELS, type Locale } from '@/i18n/config';
import { setLocaleAction } from '@/lib/actions/locale';
import { SubmitOnChange } from './LocaleSwitcherSubmitOnChange';

export async function LocaleSwitcher() {
  const current = (await getLocale()) as Locale;
  const label = LOCALE_LABELS[current] ?? LOCALE_LABELS.en;
  return (
    <form action={setLocaleAction} className="relative inline-flex">
      <input type="hidden" name="returnTo" value="/" />
      <div
        className="relative inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-xs font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.05] hover:text-white"
        title={label.english}
      >
        <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span aria-hidden>{label.flag}</span>
        <span className="hidden sm:inline">{label.native}</span>
        <select
          name="locale"
          defaultValue={current}
          aria-label="Language"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} className="bg-ink-900 text-white">
              {LOCALE_LABELS[l].flag} {LOCALE_LABELS[l].native}
            </option>
          ))}
        </select>
      </div>
      <SubmitOnChange />
    </form>
  );
}
