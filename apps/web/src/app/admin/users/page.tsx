// ════════════════════════════════════════════════════════════════════════════
//  app/admin/users/page.tsx — Users management (read-only scaffold)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { fetchUsersPage } from '@/lib/data/users';
import { UsersFilters } from '@/components/admin/users/UsersFilters';
import { UsersTable } from '@/components/admin/users/UsersTable';
import { Pagination } from '@/components/admin/audit/Pagination';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; role?: string; search?: string }>;
}

export default async function UsersPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? '1', 10) || 1;

  const { users, total, totalPages, pageSize } = await fetchUsersPage({
    page,
    role: sp.role,
    search: sp.search,
  });

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Users
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every profile on the platform. Search by name or email, filter by
          role. Inspector profiles include an{' '}
          <span className="font-mono text-accent-green">CCI active</span>{' '}
          badge sourced from{' '}
          <span className="font-mono text-zinc-200">inspector_credentials</span>.
        </p>
      </header>

      <UsersFilters />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          {total.toLocaleString()} {total === 1 ? 'user' : 'users'}
        </p>
      </div>

      <UsersTable users={users} />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
      />
    </div>
  );
}
