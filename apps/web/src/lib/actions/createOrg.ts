// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/createOrg.ts — self-service organization creation (RPC-backed)
//
//  Web side of the platform-symmetric "Add Org" flow. Calls the
//  create_organization(p_name, p_kind) RPC (migration 20260723120000), which
//  inserts the org and records the caller as its OWNER. Mirrors the mobile
//  create-org flow (app/(client)/structure.tsx). Redirect-style form action so
//  it drops straight into a server-rendered <form action={createOrganization}>.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const CreateOrgSchema = z.object({
  name: z.string().trim().min(2, { message: 'Organization name must be at least 2 characters.' }).max(120),
  kind: z.enum(['enterprise', 'agency']).default('enterprise'),
  returnTo: z.string().min(1),
});

export async function createOrganization(formData: FormData): Promise<void> {
  const parsed = CreateOrgSchema.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind') ?? 'enterprise',
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/orgs';
  if (!parsed.success) {
    redirect(withQuery(fallback, { error: parsed.error.issues[0]?.message ?? 'Invalid input.' }));
  }
  const { name, kind, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // Cast keeps this compiling before the Supabase types are regenerated for the
  // new RPC; the runtime call is unaffected.
  const { data, error } = await supabase.rpc(
    'create_organization' as never,
    { p_name: name, p_kind: kind } as never,
  );
  if (error) {
    redirect(withQuery(returnTo, { error: (error as { message?: string }).message ?? 'Could not create organization.' }));
  }

  const orgId = (data as { org_id?: string } | null)?.org_id ?? '';
  revalidatePath(returnTo);
  revalidatePath('/admin/orgs');
  revalidatePath('/client/structure');
  redirect(withQuery(returnTo, { created: orgId || '1' }));
}
