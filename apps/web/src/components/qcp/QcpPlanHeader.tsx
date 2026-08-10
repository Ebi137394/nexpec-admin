// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpPlanHeader.tsx — who this plan binds
//
//  A QCP binds a PROJECT, its ORGANIZATION, and optionally a SUPPLIER. The
//  three are shown together because the authorization matrix turns on them:
//  §4 scopes an Enterprise or Agency reader to its own org, and scopes a
//  supplier to plans where supplier_id is themselves.
//
//  ── THE SUPPLIER IS THE INSPECTED PARTY, NOT A BUYER ───────────────────────
//  supplier_id is nullable and means "the party being inspected". On this
//  platform the buyer principal is COALESCE(agency_id, client_id) on the job
//  side; a supplier is never a buyer, and naming one here has no commercial
//  effect of any kind. No figure on this header is money, because a QCP has no
//  money on it.
//
//  ── organization_id IS DENORMALISED ────────────────────────────────────────
//  §2 denormalises it from the project and a trigger enforces the two agree.
//  This header shows the organization the plan row names. If a future defect
//  ever let the two drift, the page shows what the plan says rather than
//  quietly substituting the project's org and hiding the drift.
// ════════════════════════════════════════════════════════════════════════════

import { Building2, FolderKanban, Factory, CalendarClock } from 'lucide-react';
import { formatQcpDateTime, type QcpContext, type QcpPlan } from '@/lib/data/qcp';

function Cell({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-zinc-600">{hint}</p>}
    </div>
  );
}

export function QcpPlanHeader({
  plan,
  context,
}: {
  plan: QcpPlan;
  context: QcpContext;
}) {
  const supplier =
    context.supplierName ??
    context.supplierCompany ??
    (plan.supplierId ? `supplier ${plan.supplierId.slice(0, 8)}` : null);

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Cell
        icon={FolderKanban}
        label="Project"
        value={context.projectName ?? `project ${plan.projectId.slice(0, 8)}`}
        hint={context.projectStatus ? `status: ${context.projectStatus}` : undefined}
      />
      <Cell
        icon={Building2}
        label="Organization"
        value={context.organizationName ?? `org ${plan.organizationId.slice(0, 8)}`}
        hint={
          context.organizationKind
            ? `${context.organizationKind} · denormalised from the project`
            : 'denormalised from the project'
        }
      />
      <Cell
        icon={Factory}
        label="Supplier (inspected party)"
        value={supplier ?? 'None named'}
        hint={supplier ? 'not a buyer — no commercial effect' : 'optional on a plan'}
      />
      <Cell
        icon={CalendarClock}
        label="Plan created"
        value={formatQcpDateTime(plan.createdAt)}
        hint={
          plan.updatedAt && plan.updatedAt !== plan.createdAt
            ? `last touched ${formatQcpDateTime(plan.updatedAt)}`
            : undefined
        }
      />
    </section>
  );
}
