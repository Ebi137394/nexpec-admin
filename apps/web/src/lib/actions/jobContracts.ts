// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobContracts.ts — admin-generate + client-sign + inspector-sign
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── ADMIN: generate contract from an application ──────────────────── */

const GenerateSchema = z.object({
  applicationId: z.string().regex(UUID),
  clientPriceDollars: z.preprocess(
    (v) => Number(v),
    z.number().int().min(0).max(10_000_000),
  ),
  inspectorPayoutDollars: z.preprocess(
    (v) => Number(v),
    z.number().int().min(0).max(10_000_000),
  ),
  contractTextMd: z.string().trim().max(50_000).optional().or(z.literal('')),
  customContractUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .optional()
    .or(z.literal('')),
});

function buildContractTemplate(opts: {
  jobTitle: string;
  clientName: string;
  inspectorName: string;
  clientPrice: number;
  inspectorPayout: number;
}): string {
  // Generic, role-agnostic body. Both client- and inspector-facing UIs strip
  // the OTHER party's price line from the rendered text via a per-role
  // post-process. Stored once, projected differently.
  const today = new Date().toISOString().slice(0, 10);
  return `# Inspection Services Agreement

**Effective date:** ${today}
**Job:** ${opts.jobTitle}

This Inspection Services Agreement (the "Agreement") is entered into between
NEXPEC, on behalf of **${opts.clientName}** (the "Client") and the assigned
inspector **${opts.inspectorName}** (the "Inspector").

## 1. Scope of work
The Inspector will perform the inspection described in the job posting and
deliver an audit-grade report through the NEXPEC platform.

## 2. Compensation and escrow
Payment is held in escrow by NEXPEC and released to the Inspector upon
Client and Admin sign-off on the final report. Refer to your role-specific
contract view for your applicable monetary figure.

## 3. Confidentiality
All project details, deliverables, and counterparty identities are
confidential. Direct counterparty communication outside the NEXPEC platform
is prohibited.

## 4. Standards of care
The Inspector warrants performance to the applicable industry standards
(API, ASME, ISO, AWS, NACE/AMPP, NEC, etc.) referenced in the scope.

## 5. Indemnity
Each party indemnifies the other for losses arising from their gross
negligence or willful misconduct, subject to the cap set forth in the
NEXPEC Master Services Agreement.

## 6. Termination
Either party may terminate for material breach with 5 business days'
written notice via the NEXPEC platform.

## 7. Acceptance
Typed full legal name + checkbox below constitutes a binding electronic
signature under ESIGN / eIDAS. Timestamp, IP, and user-agent are recorded.`;
}

export async function generateJobContract(formData: FormData): Promise<void> {
  const parsed = GenerateSchema.safeParse({
    applicationId: formData.get('applicationId'),
    clientPriceDollars: formData.get('clientPriceDollars'),
    inspectorPayoutDollars: formData.get('inspectorPayoutDollars'),
    contractTextMd: formData.get('contractTextMd') ?? '',
    customContractUrl: formData.get('customContractUrl') ?? '',
  });
  if (!parsed.success) {
    redirect(
      '/admin/jobs?error=' +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid'),
    );
  }
  if (parsed.data.inspectorPayoutDollars > parsed.data.clientPriceDollars) {
    redirect(
      '/admin/jobs?error=' +
        encodeURIComponent('Inspector payout cannot exceed client price.'),
    );
  }

  const supabase = await createSupabaseServerClient();

  // If admin didn't supply contract_text_md, build a default template
  let contractTextMd = parsed.data.contractTextMd?.trim() || '';
  if (!contractTextMd) {
    try {
      const { data: app } = await supabase
        .from('applications')
        .select('id, job_id, applicant_id')
        .eq('id', parsed.data.applicationId)
        .maybeSingle();
      const a = app as { job_id?: string; applicant_id?: string } | null;
      if (a?.job_id && a?.applicant_id) {
        const [{ data: job }, { data: clientProf }, { data: insProf }] =
          await Promise.all([
            supabase
              .from('jobs')
              .select('title, client_id')
              .eq('id', a.job_id)
              .maybeSingle(),
            (async () => {
              const { data: job2 } = await supabase
                .from('jobs')
                .select('client_id')
                .eq('id', a.job_id!)
                .maybeSingle();
              const cid = (job2 as { client_id?: string } | null)?.client_id;
              if (!cid) return { data: null } as const;
              return supabase
                .from('profiles')
                .select('full_name')
                .eq('id', cid)
                .maybeSingle();
            })(),
            supabase
              .from('profiles')
              .select('full_name')
              .eq('id', a.applicant_id)
              .maybeSingle(),
          ]);
        contractTextMd = buildContractTemplate({
          jobTitle:
            ((job as { title?: string } | null)?.title) ?? 'Inspection job',
          clientName:
            ((clientProf as { full_name?: string } | null)?.full_name) ??
            'Client',
          inspectorName:
            ((insProf as { full_name?: string } | null)?.full_name) ??
            'Inspector',
          clientPrice: parsed.data.clientPriceDollars,
          inspectorPayout: parsed.data.inspectorPayoutDollars,
        });
      }
    } catch {
      contractTextMd = '';
    }
  }

  const { error } = await supabase.rpc('admin_generate_job_contract', {
    p_application_id: parsed.data.applicationId,
    p_client_price_cents: Math.round(parsed.data.clientPriceDollars * 100),
    p_inspector_payout_cents: Math.round(
      parsed.data.inspectorPayoutDollars * 100,
    ),
    p_contract_text_md: contractTextMd || null,
    p_custom_contract_url: parsed.data.customContractUrl || null,
  });
  if (error) {
    redirect(
      '/admin/jobs?error=' +
        encodeURIComponent('Contract generation failed: ' + error.message),
    );
  }
  revalidatePath('/admin/jobs');
  revalidatePath('/client/contracts');
  revalidatePath('/inspector/contracts');
  redirect('/admin/jobs?ok=contract_generated');
}

/* ─── CLIENT sign ────────────────────────────────────────────────────── */

const ClientSignSchema = z.object({
  contractId: z.string().regex(UUID),
  typedName: z.string().trim().min(2).max(160),
  termsAccepted: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.literal(true, { message: 'Tick the Terms checkbox to sign.' }),
  ),
});

export async function clientSignJobContract(formData: FormData): Promise<void> {
  const parsed = ClientSignSchema.safeParse({
    contractId: formData.get('contractId'),
    typedName: formData.get('typedName'),
    termsAccepted: formData.get('termsAccepted'),
  });
  if (!parsed.success) {
    const id = String(formData.get('contractId') ?? '');
    redirect(
      `/client/contracts/job/${id}?error=` +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid'),
    );
  }
  const supabase = await createSupabaseServerClient();
  const ipHeader = (await headers()).get('x-forwarded-for') ?? null;
  const ip = ipHeader ? ipHeader.split(',')[0]?.trim() ?? null : null;

  const { error } = await supabase.rpc('client_sign_job_contract', {
    p_contract_id: parsed.data.contractId,
    p_typed_name: parsed.data.typedName,
    p_ip: ip,
  });
  if (error) {
    redirect(
      `/client/contracts/job/${parsed.data.contractId}?error=` +
        encodeURIComponent(error.message),
    );
  }
  revalidatePath(`/client/contracts/job/${parsed.data.contractId}`);
  revalidatePath('/client/contracts');
  redirect(
    `/client/contracts/job/${parsed.data.contractId}?signed=1`,
  );
}

/* ─── INSPECTOR sign ─────────────────────────────────────────────────── */

const InspectorSignSchema = z.object({
  contractId: z.string().regex(UUID),
  typedName: z.string().trim().min(2).max(160),
  termsAccepted: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.literal(true, { message: 'Tick the Terms checkbox to sign.' }),
  ),
});

export async function inspectorSignJobContract(
  formData: FormData,
): Promise<void> {
  const parsed = InspectorSignSchema.safeParse({
    contractId: formData.get('contractId'),
    typedName: formData.get('typedName'),
    termsAccepted: formData.get('termsAccepted'),
  });
  if (!parsed.success) {
    const id = String(formData.get('contractId') ?? '');
    redirect(
      `/inspector/contracts/job/${id}?error=` +
        encodeURIComponent(parsed.error.issues[0]?.message ?? 'Invalid'),
    );
  }
  const supabase = await createSupabaseServerClient();
  const ipHeader = (await headers()).get('x-forwarded-for') ?? null;
  const ip = ipHeader ? ipHeader.split(',')[0]?.trim() ?? null : null;

  const { error } = await supabase.rpc('inspector_sign_job_contract', {
    p_contract_id: parsed.data.contractId,
    p_typed_name: parsed.data.typedName,
    p_ip: ip,
  });
  if (error) {
    redirect(
      `/inspector/contracts/job/${parsed.data.contractId}?error=` +
        encodeURIComponent(error.message),
    );
  }
  revalidatePath(`/inspector/contracts/job/${parsed.data.contractId}`);
  revalidatePath('/inspector/contracts');
  redirect(
    `/inspector/contracts/job/${parsed.data.contractId}?signed=1`,
  );
}
