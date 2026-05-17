'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

/**
 * Compact prev/next pagination. We don't render page-number cells —
 * audit datasets balloon fast and surfacing a 1000-page row would be
 * misleading. Use filters to narrow first.
 */
export function Pagination({ page, totalPages, total, pageSize }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();

  function goto(p: number) {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    if (p > 1) next.set('page', String(p));
    else next.delete('page');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 pt-4">
      <p className="font-mono text-xs text-zinc-500">
        {total === 0
          ? 'No events match the current filters.'
          : `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
      <div className="flex items-center gap-2">
        <PageButton onClick={() => goto(page - 1)} disabled={page <= 1} ariaLabel="Previous page">
          <ChevronLeft className="h-4 w-4" />
          Prev
        </PageButton>
        <span className="font-mono text-xs text-zinc-500">
          page {page} / {totalPages}
        </span>
        <PageButton
          onClick={() => goto(page + 1)}
          disabled={page >= totalPages}
          ariaLabel="Next page"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors',
        'hover:border-white/30 hover:text-white',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:text-zinc-300',
      )}
    >
      {children}
    </button>
  );
}
