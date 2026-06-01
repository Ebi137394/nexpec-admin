// ════════════════════════════════════════════════════════════════════════════
//  app/client/budget/policies/page.tsx — Approval policy editor
//
//  Lists the active + inactive bands for the user's active org as a
//  visual ladder, lets elevated roles (owner / procurement_admin) +
//  the Platform Owner create / edit / toggle bands.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchMyOrgMemberships,
  resolveActiveOrgId,
  fetchOrgPickerContextForOrg,
} from '@/lib/data/orgStructure';
import { fetchApprovalPolicies } from '@/lib/data/procurement';
import { PoliciesWorkspace } from '@/components/procurement/PoliciesWorkspace';
import { isElevatedOrgRole } from '@nexpec/shared-core';

export const metadata: Metadata = { title: 'Approval Policies' };
export const dynamic = 'force-dynamic';

export default async function ApprovalPoliciesPage() {
  // ── Resolve active org context ─────────────────────────────────────
  const memberships = await fetchMyOrgMemberships();
  const activeOrgId = await resolveActiveOrgId();
  const active = memberships.find((m) => m.org_id === activeOrgId) ?? null;

  if (!active) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
        <ShieldCheck className="mx-auto h-7 w-7 text-violet-glow/70" strokeWidth={1.5} />
        <p className="mt-4 font-display text-base text-white">
          No active organization
        </p>
        <p className="mt-1 mx-auto max-w-md text-pretty text-xs text-zinc-500">
          Approval policies live inside an organization. Pick a workspace from
          the switcher in the header to manage its policies.
        </p>
      </div>
    );
  }

  // ── Permission check: only elevated roles + Platform Owner manage ─
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let canManage = false;
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const isPlatformOwner =
      ['super_admin', 'admin'].includes((profile?.role ?? '').toString().trim().toLowerCase());
    canManage = isPlatformOwner || isElevatedOrgRole(active.role);
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <Header orgName={active.org_name} />
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-zinc-300">
          Policy management is reserved for org{' '}
          <span className="font-mono text-zinc-200">owner</span> /
          <span className="font-mono text-zinc-200"> procurement_admin</span>
          {' '}and the NEXPEC Platform Owner.
        </p>
      </div>
    );
  }

  const [policies, pickerCtx] = await Promise.all([
    fetchApprovalPolicies(active.org_id),
    fetchOrgPickerContextForOrg(active.org_id),
  ]);

  return (
    <div className="space-y-8">
      <Header orgName={active.org_name} />
      <PoliciesWorkspace
        orgId={active.org_id}
        orgName={active.org_name}
        policies={policies}
        departments={pickerCtx.departments}
      />
      <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        Source · approval_policies · band overlap is constraint-trigger
        enforced · SoD opt-out is audit-flagged
      </p>
    </div>
  );
}

function Header({ orgName }: { orgName: string }) {
  return (
    <header>
      <Link
        href="/client/budget"
        className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-industrial text-zinc-400 transition-colors hover:text-violet-glow"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to budget
      </Link>
      <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
        Procurement · Approval bands
      </p>
      <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
        </span>
        {orgName}
      </h1>
      <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
        Configure the tiered ladder of approval bands that gate job
        postings by amount. Each band&apos;s range must not overlap any
        other active band for the same currency / scope — enforced at the
        schema layer.
      </p>
    </header>
  );
}
