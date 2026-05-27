'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/orgs/CurrencySelector.tsx
//
//  Sleek display-currency picker for the multi-currency budget surfaces.
//  Two modes:
//
//  1. URL mode (default) — picking a currency updates the URL query
//     (?display=EUR) which triggers a server re-render with the chosen
//     display currency. No mutation; the org's default base_currency
//     stays untouched. Perfect for a CFO toggling between currencies
//     while exploring.
//
//  2. Persist mode — when `onPersist` is provided, the dropdown also
//     offers a "Make this the default for {orgName}" footer button that
//     writes through to organizations.base_currency via the server
//     action. Auth-gated; consumers (e.g. the structure workspace
//     header) should only pass `onPersist` for elevated viewers.
//
//  Visual language locked to the existing workspace switcher — same
//  glassmorphic dropdown, same chevron rotation, same border tokens.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronDown, Coins, Loader2 } from 'lucide-react';

import {
  SUPPORTED_CURRENCIES,
  CURRENCY_LABELS,
  CURRENCY_SYMBOLS,
  type CurrencyCode,
} from '@nexpec/shared-core';
import { setOrgBaseCurrencyAction } from '@/lib/actions/orgStructure';
import { cn } from '@/lib/cn';

interface Props {
  /**
   * Currently-displayed currency. Comes from the page's URL ?display=
   * param or the org's base_currency when not overridden.
   */
  activeCurrency: string;
  /**
   * The org's persisted default — used to render the "default" pill on
   * the appropriate row and to label the persist button.
   */
  defaultCurrency: string;
  /** Org id for the persist action; pass when persistence is allowed. */
  orgId?: string;
  /** Org name shown in the persist button label. */
  orgName?: string;
  /**
   * When true, surface a "Make default" footer button that persists
   * the selection to organizations.base_currency. Gate this on the
   * viewer's role server-side (owner / procurement_admin / Platform Owner).
   */
  canPersistDefault?: boolean;
  /** Compact trigger; default false. */
  compact?: boolean;
}

export function CurrencySelector({
  activeCurrency,
  defaultCurrency,
  orgId,
  orgName,
  canPersistDefault = false,
  compact = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [persistPending, setPersistPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const updateUrl = (currency: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (currency === defaultCurrency) {
      params.delete('display');
    } else {
      params.set('display', currency);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const handlePick = (currency: string) => {
    if (currency === activeCurrency) {
      setOpen(false);
      return;
    }
    updateUrl(currency);
    setOpen(false);
  };

  const handlePersist = () => {
    if (!orgId || !canPersistDefault) return;
    setError(null);
    setPersistPending(activeCurrency);
    startTransition(async () => {
      const res = await setOrgBaseCurrencyAction({
        orgId,
        currency: activeCurrency,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not save default.');
        setPersistPending(null);
        return;
      }
      // Default updated → the ?display= param is now redundant (or even
      // misleading) so clear it.
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.delete('display');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      router.refresh();
      setPersistPending(null);
      setOpen(false);
    });
  };

  const activeSymbol = CURRENCY_SYMBOLS[activeCurrency as CurrencyCode] ?? activeCurrency;
  const isDefault = activeCurrency === defaultCurrency;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch display currency"
        className={cn(
          'group inline-flex items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] py-1.5 pl-2.5 pr-2 text-left transition-all hover:border-violet/30 hover:bg-violet/[0.04]',
          compact ? 'max-w-[180px]' : 'max-w-[220px]',
        )}
      >
        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-violet/15 text-[10px] font-bold text-violet-glow ring-1 ring-inset ring-violet/30">
          {activeSymbol.length <= 2 ? activeSymbol : <Coins className="h-3 w-3" strokeWidth={1.75} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white leading-tight">
            Display · {activeCurrency}
          </p>
          {!isDefault && (
            <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-industrial text-amber-200/70 leading-tight">
              Override · default {defaultCurrency}
            </p>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform group-hover:text-violet-glow',
            open && 'rotate-180 text-violet-glow',
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          aria-label="Currencies"
          className="absolute right-0 top-full z-40 mt-2 w-[260px] overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
              <Coins className="h-3 w-3 text-violet-glow" strokeWidth={1.75} />
              Display currency
            </p>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] text-zinc-500">
              {SUPPORTED_CURRENCIES.length}
            </span>
          </header>

          <ul className="max-h-[50vh] overflow-y-auto py-1">
            {SUPPORTED_CURRENCIES.map((code) => {
              const isActive = code === activeCurrency;
              const isOrgDefault = code === defaultCurrency;
              return (
                <li key={code}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handlePick(code)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                      isActive ? 'bg-violet/[0.08]' : 'hover:bg-white/[0.03]',
                    )}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet/20 to-cyan-glow/15 text-xs font-bold text-white ring-1 ring-inset ring-white/[0.08]">
                      {CURRENCY_SYMBOLS[code].length <= 2 ? CURRENCY_SYMBOLS[code] : code.slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-white">{code}</span>
                        {isOrgDefault && (
                          <span className="inline-flex items-center rounded border border-emerald-400/30 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold uppercase tracking-industrial text-emerald-200">
                            Default
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-[10px] text-zinc-500">
                        {CURRENCY_LABELS[code]}
                      </p>
                    </div>
                    {isActive && (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-violet-glow"
                        strokeWidth={2.5}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {error && (
            <p className="border-t border-rose-500/20 bg-rose-500/[0.06] px-4 py-2 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          {canPersistDefault && orgId && !isDefault && (
            <div className="border-t border-white/[0.06] bg-white/[0.01] px-3 py-2">
              <button
                type="button"
                onClick={handlePersist}
                disabled={isPending}
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial transition-colors',
                  'bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30 hover:bg-violet/25',
                  'disabled:opacity-50',
                )}
              >
                {isPending && persistPending === activeCurrency ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                    Saving…
                  </>
                ) : (
                  <>Set {activeCurrency} as default for {orgName ?? 'this org'}</>
                )}
              </button>
            </div>
          )}

          <footer className="border-t border-white/[0.06] bg-white/[0.01] px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-industrial text-zinc-600">
              Native invoice amounts never change · this is a display projection
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}
