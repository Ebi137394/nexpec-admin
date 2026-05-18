import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { AdminUser } from '@/lib/data/users';
import { UserRoleBadge } from './UserRoleBadge';

interface UsersTableProps {
  users: AdminUser[];
}

export function UsersTable({ users }: UsersTableProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-12 text-center">
        <p className="font-display text-lg font-semibold text-white">
          No users match this filter.
        </p>
        <p className="mt-2 text-sm text-zinc-500">
          Clear filters or broaden the search above.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/40 to-ink-900/20">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <th className="px-4 py-3 font-semibold">User</th>
            <th className="px-4 py-3 font-semibold">Role</th>
            <th className="px-4 py-3 font-semibold">Verification</th>
            <th className="px-4 py-3 font-semibold">Joined</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {users.map((u) => (
            <tr
              key={u.id}
              className="group cursor-pointer transition-colors hover:bg-white/[0.03] focus-within:bg-white/[0.04]"
            >
              <td className="whitespace-nowrap px-4 py-3 align-middle">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="flex items-center gap-3 outline-none focus-visible:underline focus-visible:underline-offset-2"
                >
                  <Avatar name={u.full_name} email={u.email} avatarUrl={u.avatar_url} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white group-hover:text-violet-glow">
                      {u.full_name ?? u.email?.split('@')[0] ?? 'Anonymous'}
                    </p>
                    <p className="truncate font-mono text-[10px] text-zinc-500">
                      {u.email ?? u.id}
                    </p>
                  </div>
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 align-middle">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="block outline-none"
                  tabIndex={-1}
                >
                  <UserRoleBadge role={u.role} />
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 align-middle">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="block outline-none"
                  tabIndex={-1}
                >
                  {u.cci_active ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
                      <ShieldCheck className="h-3 w-3" />
                      CCI {(u.cci_tier ?? '').replace('cci_', '') || 'verified'}
                    </span>
                  ) : u.role === 'inspector' || u.role === 'contractor' ? (
                    <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                      no active credential
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
                      —
                    </span>
                  )}
                </Link>
              </td>
              <td className="whitespace-nowrap px-4 py-3 align-middle font-mono text-xs text-zinc-400">
                <Link
                  href={`/admin/users/${u.id}`}
                  className="block outline-none"
                  tabIndex={-1}
                >
                  {formatDate(u.created_at)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Avatar({
  name,
  email,
  avatarUrl,
}: {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatarUrl}
        alt={name ?? email ?? 'user'}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-cyan-glow text-[11px] font-semibold text-white">
      {initials(name ?? email ?? 'U')}
    </span>
  );
}

function initials(s: string): string {
  const parts = s.trim().split(/\s+|@|\./).filter(Boolean);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
