'use client';

// ════════════════════════════════════════════════════════════════════════════
//  TaxWizardForm — jurisdiction-adaptive payee tax form (web).
//  Country drives the allowed form types + the identifier label. Submits to the
//  submitTaxForm server action → tax-vault edge function (encrypts the TIN).
//  Dark theme: #020420 surface, #7C3AED primary.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { submitTaxForm } from '@/lib/actions/taxCenter';

const COUNTRIES: { code: string; label: string }[] = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
  { code: 'GB', label: 'United Kingdom' },
  { code: 'DE', label: 'Germany' },
  { code: 'FR', label: 'France' },
  { code: 'IE', label: 'Ireland' },
  { code: 'NL', label: 'Netherlands' },
  { code: 'OTHER', label: 'Other' },
];

const EU = new Set(['DE', 'FR', 'IE', 'NL']);

const FORM_LABELS: Record<string, string> = {
  w9: 'W-9 (US person)',
  w8ben: 'W-8BEN (non-US individual)',
  w8bene: 'W-8BEN-E (non-US entity)',
  t4a: 'T4A recipient (Canada)',
  dac7: 'DAC7 seller (EU)',
};

function formsForCountry(code: string): string[] {
  if (code === 'US') return ['w9', 'w8ben', 'w8bene'];
  if (code === 'CA') return ['t4a', 'w8ben'];
  if (EU.has(code)) return ['dac7', 'w8ben'];
  return ['w8ben', 'w8bene'];
}

function idLabel(code: string, form: string): string {
  if (form === 'w9') return 'SSN or EIN';
  if (code === 'CA') return 'SIN or Business Number';
  if (form === 'dac7') return 'VAT ID or national tax number';
  return 'Foreign tax identifying number (TIN)';
}

export function TaxWizardForm() {
  const [country, setCountry] = useState('US');
  const forms = useMemo(() => formsForCountry(country), [country]);
  const [formType, setFormType] = useState(forms[0] ?? 'w8ben');
  const [certified, setCertified] = useState(false);

  // Keep formType valid when country changes.
  const effForm = forms.includes(formType) ? formType : (forms[0] ?? 'w8ben');

  const inputCls =
    'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-violet-glow/60';
  const labelCls = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-industrial text-zinc-400';

  return (
    <form action={submitTaxForm} className="space-y-5">
      <div>
        <label className={labelCls}>Tax residency</label>
        <select name="country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code} className="bg-[#020420]">{c.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>Tax form</label>
        <select name="formType" value={effForm} onChange={(e) => setFormType(e.target.value)} className={inputCls}>
          {forms.map((f) => (
            <option key={f} value={f} className="bg-[#020420]">{FORM_LABELS[f]}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>{idLabel(country, effForm)}</label>
        <input
          name="taxId"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Enter your tax identifier"
          className={`${inputCls} font-mono tracking-wider`}
          required
          minLength={4}
        />
        <p className="mt-1.5 text-[11px] text-zinc-500">
          Encrypted at rest. We store only the last 4 digits in the clear; the full number is sealed and never shown back to you.
        </p>
      </div>

      <label className="flex items-start gap-2.5 text-xs text-zinc-300">
        <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="mt-0.5 h-4 w-4 accent-violet-glow" />
        <span>Under penalties of perjury, I certify that the information provided is true, correct, and complete.</span>
      </label>

      <button
        type="submit"
        disabled={!certified}
        className="w-full rounded-xl bg-[#7C3AED] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Submit tax information
      </button>
    </form>
  );
}
