// ════════════════════════════════════════════════════════════════════════════
//  adminSupplierAndOrg — the two role surfaces Admin User Detail could not see.
//
//  WHY THIS EXISTS.
//
//  1. SUPPLIER. apps/web/src/app/admin/users/[id]/page.tsx gates its
//     role-specific sections on isInspector (inspector|contractor|senior) and
//     isClientSide (client|agency|enterprise). 'supplier' matches NEITHER, so
//     a supplier's admin page rendered only the generic identity block. Their
//     entire business identity — legal name, capabilities, country, vendor
//     rating, verification state — lives in public.supplier_profiles, which no
//     admin surface reads at all, and their sealed certificates live in
//     public.vendor_documents, which only the supplier's own vault reads.
//
//  2. ORGANISATION MEMBERSHIP. Membership is written to public.org_members by
//     create_organization, while readers scoped off profiles.organization_id.
//     Measured on Production: 7 profiles carry organization_id, org_members
//     holds 1 row, and they DISAGREE for that row. Admin showed only the raw
//     organization_id UUID, so an operator could not see which organisation a
//     user actually belongs to, or with what org role.
//
//  Both are read through the CALLER's session, so RLS — not this file — grants
//  access. No service-role key is used. Private objects are never linked
//  directly: a short-lived signed URL is minted per request.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const SIGNED_URL_TTL_SECONDS = 300;
const VENDOR_BUCKET = 'vendor_documents';

export interface SupplierDocument {
  id: string;
  title: string | null;
  kind: string | null;
  status: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  signedUrl: string | null;
  storagePath: string | null;
}

export interface SupplierDossier {
  hasProfile: boolean;
  legalName: string | null;
  headline: string | null;
  capabilities: string[];
  countryCode: string | null;
  ratingAvg: number | null;
  ratingCount: number | null;
  isActive: boolean | null;
  /** Vendor verification is a jsonb blob written by NO application code today —
   *  every vendor therefore reads as unverified. Surfaced honestly rather than
   *  rendered as a badge that can never turn on. */
  verifiedAt: string | null;
  documents: SupplierDocument[];
  /** Sources that errored, so the page can say so instead of showing an
   *  empty section that looks like "nothing submitted". */
  unreadable: string[];
}

export interface OrgMembership {
  orgId: string;
  orgName: string | null;
  orgKind: string | null;
  role: string | null;
  joinedAt: string | null;
}

export interface OrgContext {
  /** From public.org_members — the authoritative, multi-org membership model. */
  memberships: OrgMembership[];
  /** From profiles.organization_id — a single-org denormalisation. */
  profileOrganizationId: string | null;
  /** True when profiles.organization_id names an org the user is NOT a member
   *  of, or names none while memberships exist. Surfaced because these two
   *  models genuinely disagree on Production. */
  disagrees: boolean;
  unreadable: string[];
}

async function sign(
  supabase: Supa,
  bucket: string,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  // A legacy row may hold a full URL rather than an object path; hand those
  // back untouched, since createSignedUrl would reject them.
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

export async function fetchSupplierDossier(userId: string): Promise<SupplierDossier> {
  const supabase = await createSupabaseServerClient();
  const unreadable: string[] = [];

  const { data: prof, error: profErr } = await supabase
    .from('supplier_profiles')
    .select(
      'id, legal_name, headline, capabilities, country_code, rating_avg, rating_count, verification, is_active',
    )
    .eq('id', userId)
    .maybeSingle();
  if (profErr) unreadable.push(`supplier_profiles: ${profErr.message}`);

  const { data: docs, error: docsErr } = await supabase
    .from('vendor_documents')
    .select('id, doc_type, title, storage_path, status, expires_at, created_at')
    .eq('vendor_id', userId)
    .order('created_at', { ascending: false });
  if (docsErr) unreadable.push(`vendor_documents: ${docsErr.message}`);

  const documents: SupplierDocument[] = [];
  for (const d of (docs ?? []) as Record<string, unknown>[]) {
    const path = (d.storage_path as string | null) ?? null;
    documents.push({
      id: String(d.id),
      title: (d.title as string | null) ?? null,
      kind: (d.doc_type as string | null) ?? null,
      status: (d.status as string | null) ?? null,
      expiresAt: (d.expires_at as string | null) ?? null,
      createdAt: (d.created_at as string | null) ?? null,
      storagePath: path,
      signedUrl: await sign(supabase, VENDOR_BUCKET, path),
    });
  }

  const verification = (prof?.verification ?? null) as { verified_at?: string } | null;

  return {
    hasProfile: Boolean(prof),
    legalName: (prof?.legal_name as string | null) ?? null,
    headline: (prof?.headline as string | null) ?? null,
    capabilities: Array.isArray(prof?.capabilities)
      ? (prof!.capabilities as unknown[]).map(String)
      : [],
    countryCode: (prof?.country_code as string | null) ?? null,
    ratingAvg:
      prof?.rating_avg === null || prof?.rating_avg === undefined
        ? null
        : Number(prof.rating_avg),
    ratingCount: (prof?.rating_count as number | null) ?? null,
    isActive: (prof?.is_active as boolean | null) ?? null,
    verifiedAt: verification?.verified_at ?? null,
    documents,
    unreadable,
  };
}

export async function fetchOrgContext(
  userId: string,
  profileOrganizationId: string | null,
): Promise<OrgContext> {
  const supabase = await createSupabaseServerClient();
  const unreadable: string[] = [];

  const { data: rows, error } = await supabase
    .from('org_members')
    .select('org_id, role, created_at, organizations(name, kind)')
    .eq('user_id', userId);
  if (error) unreadable.push(`org_members: ${error.message}`);

  const memberships: OrgMembership[] = ((rows ?? []) as Record<string, unknown>[]).map(
    (r) => {
      const org = (r.organizations ?? null) as { name?: string; kind?: string } | null;
      return {
        orgId: String(r.org_id),
        orgName: org?.name ?? null,
        orgKind: org?.kind ?? null,
        role: (r.role as string | null) ?? null,
        joinedAt: (r.created_at as string | null) ?? null,
      };
    },
  );

  // Disagreement is worth showing rather than silently preferring one model.
  const ids = new Set(memberships.map((m) => m.orgId));
  const disagrees = profileOrganizationId
    ? !ids.has(profileOrganizationId)
    : memberships.length > 0;

  return { memberships, profileOrganizationId, disagrees, unreadable };
}
