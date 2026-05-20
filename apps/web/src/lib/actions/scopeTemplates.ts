// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/scopeTemplates.ts — admin CRUD for compliance scope templates
//
//  The library at /admin/compliance/templates is the canonical source from
//  which clients pick when posting a compliance-mode job. Admins curate it
//  here. Three actions:
//
//    • createScopeTemplate         — insert a brand-new template
//    • updateScopeTemplateAction   — edit name / category / price / etc.
//    • toggleScopeTemplateActive   — flip is_active without a full edit
//
//  All three rely on RLS policy `templates_admin_write` on
//  public.inspection_scope_templates which gates writes to nx_is_admin().
//  These actions are thin UX convenience layers — security is enforced at
//  the database boundary, not here.
//
//  Versioning rule (UX, not DB-enforced): editing an existing template
//  bumps `version` so historical compliance jobs remain auditable against
//  the contract they were posted under. The form sends the current version
//  on every save and the action increments it server-side.
//
//  Slug constraint mirrors the SQL CHECK `^[a-z0-9_]+$` so the form
//  rejects bad input before reaching Postgres.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ScopeTemplateFormState } from './scopeTemplates.types';

// Action result shape + initial-state constant live in scopeTemplates.types.ts —
// Next.js 15 enforces async-only exports from any `'use server'` file.

// ─── Validators ───────────────────────────────────────────────────────────────

const TIERS = ['cci_basic', 'cci_advanced', 'cci_lead'] as const;

const SLUG_RE = /^[a-z0-9_]+$/;

// Shared field schemas — re-used by create + update parsers.
const slugField = z
  .string()
  .trim()
  .min(3, { message: 'Slug must be at least 3 characters.' })
  .max(64, { message: 'Slug is capped at 64 characters.' })
  .regex(SLUG_RE, {
    message: 'Slug can only contain lowercase letters, numbers, and underscores.',
  });

const nameField = z
  .string()
  .trim()
  .min(3, { message: 'Name must be at least 3 characters.' })
  .max(120, { message: 'Name is capped at 120 characters.' });

const categoryField = z
  .string()
  .trim()
  .min(2, { message: 'Category is required.' })
  .max(64, { message: 'Category is capped at 64 characters.' });

const regionField = z
  .string()
  .trim()
  .min(2, { message: 'Region is required.' })
  .max(32, { message: 'Region is capped at 32 characters.' });

const validityField = z
  .number({ message: 'Validity months must be a number.' })
  .int({ message: 'Validity months must be a whole number.' })
  .min(1, { message: 'Validity must be at least 1 month.' })
  .max(120, { message: 'Validity is capped at 120 months.' });

const priceCentsField = z
  .number({ message: 'Base price must be a number.' })
  .int({ message: 'Base price (cents) must be a whole number.' })
  .min(0, { message: 'Base price cannot be negative.' })
  .max(10_000_000, { message: 'Base price exceeds the $100,000 cap.' });

const tierField = z.enum(TIERS, { message: 'Pick a valid CCI tier.' });

const descriptionField = z
  .string()
  .trim()
  .max(4000, { message: 'Description is capped at 4000 characters.' })
  .optional()
  .or(z.literal(''));

const CreateSchema = z.object({
  slug: slugField,
  name: nameField,
  category: categoryField,
  region: regionField,
  validityMonths: validityField,
  basePriceCents: priceCentsField,
  requiresCredentialTier: tierField,
  description: descriptionField,
  isActive: z.boolean().optional(),
});

const UpdateSchema = z.object({
  id: z.string().uuid({ message: 'Invalid template id.' }),
  name: nameField,
  category: categoryField,
  region: regionField,
  validityMonths: validityField,
  basePriceCents: priceCentsField,
  requiresCredentialTier: tierField,
  description: descriptionField,
  // Slug is immutable post-creation by convention — historical jobs
  // reference it. We accept it in form payloads but don't write it.
  // Version supplied for optimistic-concurrency style messaging only.
  expectedVersion: z
    .number()
    .int()
    .min(1, { message: 'Invalid version.' })
    .optional(),
});

const ToggleSchema = z.object({
  id: z.string().uuid({ message: 'Invalid template id.' }),
  nextActive: z.boolean(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  if (v == null) return false;
  const s = String(v).toLowerCase();
  return s === 'on' || s === 'true' || s === '1' || s === 'yes';
}

function readNumber(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function readDollarsAsCents(fd: FormData, key: string): number | undefined {
  const raw = fd.get(key);
  if (raw == null || String(raw).trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function flattenIssues(
  issues: z.ZodIssue[],
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && out[key] == null) {
      out[key] = issue.message;
    }
  }
  return out;
}

async function requireAdminClient(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>> }
  | { ok: false; reason: string }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { ok: false, reason: 'You must be signed in to manage templates.' };
  }

  // RLS will reject non-admins anyway, but a friendly pre-check yields
  // better error messaging than a raw Postgres permission failure.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  const role = (profile as { role?: string } | null)?.role;
  if (role !== 'admin' && role !== 'super_admin') {
    return { ok: false, reason: 'Only admins can manage scope templates.' };
  }

  return { ok: true, supabase };
}

// ─── 1. Create ────────────────────────────────────────────────────────────────

export async function createScopeTemplateAction(
  _prev: ScopeTemplateFormState,
  formData: FormData,
): Promise<ScopeTemplateFormState> {
  const parsed = CreateSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    category: formData.get('category'),
    region: formData.get('region'),
    validityMonths: readNumber(formData, 'validityMonths'),
    basePriceCents: readDollarsAsCents(formData, 'basePriceDollars'),
    requiresCredentialTier: formData.get('requiresCredentialTier'),
    description: formData.get('description') ?? '',
    isActive: readBool(formData, 'isActive'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields.',
      fieldErrors: flattenIssues(parsed.error.issues),
    };
  }

  const auth = await requireAdminClient();
  if (!auth.ok) {
    return { ok: false, error: auth.reason, fieldErrors: {} };
  }

  const { supabase } = auth;
  const {
    slug,
    name,
    category,
    region,
    validityMonths,
    basePriceCents,
    requiresCredentialTier,
    description,
    isActive,
  } = parsed.data;

  // Resolve created_by_admin_id from the authed user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('inspection_scope_templates')
    .insert({
      slug,
      name,
      category: category.toLowerCase(),
      region: region.toLowerCase(),
      validity_months: validityMonths,
      base_price_cents: basePriceCents,
      requires_credential_tier: requiresCredentialTier,
      description_md: description && description.length > 0 ? description : null,
      is_active: isActive ?? true,
      version: 1,
      created_by_admin_id: user?.id ?? null,
    })
    .select('id, slug')
    .single();

  if (error) {
    console.error('[createScopeTemplateAction] insert failed:', {
      code: (error as { code?: string }).code,
      message: error.message,
    });

    // 23505 = unique violation → almost certainly slug collision
    const friendly =
      (error as { code?: string }).code === '23505'
        ? `A template with slug "${slug}" already exists. Pick a different slug.`
        : error.message?.includes('scope_template_slug_format')
          ? 'Slug format invalid — lowercase letters, numbers, and underscores only.'
          : error.message?.includes('scope_template_validity_positive')
            ? 'Validity months must be positive.'
            : error.message?.includes('row-level security')
              ? 'Only admins can create scope templates.'
              : `Could not create template: ${error.message}`;

    return {
      ok: false,
      error: friendly,
      fieldErrors: (error as { code?: string }).code === '23505'
        ? { slug: 'This slug is already taken.' }
        : {},
    };
  }

  revalidatePath('/admin/compliance/templates');
  revalidatePath('/admin/compliance');

  // Redirect to the new template's edit page so the admin can wire up
  // evidence requirements next.
  redirect(`/admin/compliance/templates/${data.id}?created=1`);
}

// ─── 2. Update ────────────────────────────────────────────────────────────────

export async function updateScopeTemplateAction(
  _prev: ScopeTemplateFormState,
  formData: FormData,
): Promise<ScopeTemplateFormState> {
  const parsed = UpdateSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    category: formData.get('category'),
    region: formData.get('region'),
    validityMonths: readNumber(formData, 'validityMonths'),
    basePriceCents: readDollarsAsCents(formData, 'basePriceDollars'),
    requiresCredentialTier: formData.get('requiresCredentialTier'),
    description: formData.get('description') ?? '',
    expectedVersion: readNumber(formData, 'expectedVersion'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please fix the highlighted fields.',
      fieldErrors: flattenIssues(parsed.error.issues),
    };
  }

  const auth = await requireAdminClient();
  if (!auth.ok) {
    return { ok: false, error: auth.reason, fieldErrors: {} };
  }

  const { supabase } = auth;
  const {
    id,
    name,
    category,
    region,
    validityMonths,
    basePriceCents,
    requiresCredentialTier,
    description,
    expectedVersion,
  } = parsed.data;

  // Pull the current version to compute the bump and detect drift.
  const { data: existing, error: readErr } = await supabase
    .from('inspection_scope_templates')
    .select('id, slug, version, is_active')
    .eq('id', id)
    .maybeSingle();

  if (readErr || !existing) {
    return {
      ok: false,
      error: 'That template no longer exists.',
      fieldErrors: {},
    };
  }

  const row = existing as { id: string; slug: string; version: number; is_active: boolean };

  if (
    typeof expectedVersion === 'number' &&
    expectedVersion > 0 &&
    expectedVersion !== row.version
  ) {
    return {
      ok: false,
      error: `Another admin updated this template (v${row.version}). Reload to see their changes before saving.`,
      fieldErrors: {},
    };
  }

  const nextVersion = row.version + 1;

  const { error: updErr } = await supabase
    .from('inspection_scope_templates')
    .update({
      name,
      category: category.toLowerCase(),
      region: region.toLowerCase(),
      validity_months: validityMonths,
      base_price_cents: basePriceCents,
      requires_credential_tier: requiresCredentialTier,
      description_md: description && description.length > 0 ? description : null,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updErr) {
    console.error('[updateScopeTemplateAction] update failed:', {
      code: (updErr as { code?: string }).code,
      message: updErr.message,
    });
    const friendly = updErr.message?.includes('row-level security')
      ? 'Only admins can update scope templates.'
      : updErr.message?.includes('scope_template_validity_positive')
        ? 'Validity months must be positive.'
        : `Could not update template: ${updErr.message}`;
    return { ok: false, error: friendly, fieldErrors: {} };
  }

  revalidatePath('/admin/compliance/templates');
  revalidatePath(`/admin/compliance/templates/${id}`);
  revalidatePath('/admin/compliance');

  return {
    ok: true,
    error: null,
    fieldErrors: {},
    updated: { id, slug: row.slug, newVersion: nextVersion },
  };
}

// ─── 3. Toggle active ─────────────────────────────────────────────────────────

export async function toggleScopeTemplateActiveAction(
  formData: FormData,
): Promise<void> {
  const parsed = ToggleSchema.safeParse({
    id: formData.get('id'),
    nextActive: readBool(formData, 'nextActive'),
  });

  const dest =
    (formData.get('returnTo') as string | null) ??
    '/admin/compliance/templates';

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid request.';
    redirect(`${dest}${dest.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`);
  }

  const auth = await requireAdminClient();
  if (!auth.ok) {
    redirect(`${dest}${dest.includes('?') ? '&' : '?'}error=${encodeURIComponent(auth.reason)}`);
  }

  const { supabase } = auth;
  const { id, nextActive } = parsed.data;

  const { error } = await supabase
    .from('inspection_scope_templates')
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('[toggleScopeTemplateActiveAction] update failed:', {
      code: (error as { code?: string }).code,
      message: error.message,
    });
    const friendly = error.message?.includes('row-level security')
      ? 'Only admins can toggle templates.'
      : `Could not toggle template: ${error.message}`;
    redirect(`${dest}${dest.includes('?') ? '&' : '?'}error=${encodeURIComponent(friendly)}`);
  }

  revalidatePath('/admin/compliance/templates');
  revalidatePath(`/admin/compliance/templates/${id}`);
  revalidatePath('/admin/compliance');

  redirect(
    `${dest}${dest.includes('?') ? '&' : '?'}toggled=${nextActive ? 'active' : 'inactive'}`,
  );
}
