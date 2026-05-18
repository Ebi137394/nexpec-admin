// ════════════════════════════════════════════════════════════════════════════
//  lib/data/organizations.types.ts — type-only module
//
//  Safe to import from Client Components. Server-only fetchers live in
//  the sibling organizations.ts.
// ════════════════════════════════════════════════════════════════════════════

export interface AdminOrg {
  id: string;
  name: string;
  slug: string | null;
  kind: 'enterprise' | 'agency' | string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  logo_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  is_active: boolean;
  created_at: string | null;
  /** Count of rows in org_members. */
  member_count: number;
}

export interface OrgsResult {
  orgs: AdminOrg[];
  total: number;
  tableMissing: boolean;
}
