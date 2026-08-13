// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/types.ts — row shapes for the SSO / SCIM console
//
//  Import-free shapes shared across the server/client boundary, matching the
//  convention already used by admin/programs/types.ts, admin/scorecards/types.ts
//  and admin/reports/seniorReviewTypes.ts.
//
//  These were previously declared un-exported inside page.tsx, so the client
//  islands (SsoConsole, TokenRoster) could not import them and five of the ten
//  did not exist at all. Every field below is taken from the table definitions
//  in supabase/migrations/20260801472000_enterprise_sso_scim.sql — nullability
//  included — so a projection that drops a column fails the typecheck rather
//  than surfacing `undefined` in the console at runtime.
//
//  NOTHING here may import from react/next: these cross the RSC boundary.
// ════════════════════════════════════════════════════════════════════════════

/** public.organizations — only what the console needs to label a connection. */
export interface OrgRow {
  id: string;
  name: string;
}

/** public.org_sso_connections (472000:201). */
export interface ConnectionRow {
  id: string;
  org_id: string;
  protocol: string;
  display_name: string;
  status: string;
  default_member_role: string;
  /** Nullable: a profile role is only pinned when JIT provisioning is on. */
  default_profile_role: string | null;
  jit_provisioning_enabled: boolean;
  /** Set once Supabase Auth has minted the provider; null until then. */
  auth_sso_provider_id: string | null;
  // SAML-only — null on an OIDC connection.
  idp_entity_id: string | null;
  idp_metadata_url: string | null;
  // OIDC-only — null on a SAML connection.
  oidc_issuer: string | null;
  oidc_client_id: string | null;
  created_at: string;
  updated_at: string;
}

/** public.org_sso_domains (472000:281). `verified_at` null = unverified claim. */
export interface DomainRow {
  id: string;
  connection_id: string;
  /** Required by SsoConsole's `inScope<T extends { org_id: string }>` filter. */
  org_id: string;
  domain: string;
  verified_at: string | null;
}

/** public.org_departments — target of a SCIM group mapping. */
export interface DepartmentRow {
  id: string;
  name: string;
}

/**
 * public.org_scim_tokens (472000:313).
 * The token secret itself is never selected — only `token_prefix`. A row here
 * must never carry the bearer value; OneTimeSecret renders it once, from the
 * mint response, and it is not persisted in readable form.
 */
export interface TokenRow {
  id: string;
  org_id: string;
  connection_id: string | null;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_used_at: string | null;
  rotated_from_id: string | null;
}

/** public.org_scim_group_mappings (472000:378). */
export interface MappingRow {
  id: string;
  org_id: string;
  connection_id: string;
  /** Nullable: some IdPs send only a display name. */
  external_group_id: string | null;
  external_group_name: string;
  org_role: string;
  department_id: string | null;
  is_active: boolean;
}

/** public.org_scim_identities (472000:425) — IdP user ↔ profile link. */
export interface IdentityRow {
  id: string;
  org_id: string;
  connection_id: string;
  external_id: string;
  user_id: string;
  is_active: boolean;
  deactivated_at: string | null;
}

/**
 * public.org_scim_membership_archive (472000:477).
 * Deprovisioning archives the membership rather than deleting it, so a
 * re-provisioned user can be restored with their prior role intact.
 * `restored_at` non-null means the archive row has already been replayed.
 */
export interface ArchiveRow {
  id: string;
  org_id: string;
  user_id: string;
  archived_role: string;
  membership_created_at: string | null;
  reason: string;
  archived_at: string;
  restored_at: string | null;
}

/** public.org_scim_events (472000:504) — the SCIM audit trail. */
export interface EventRow {
  id: string;
  /** Required by SsoConsole's `inScope<T extends { org_id: string }>` filter. */
  org_id: string;
  connection_id: string | null;
  operation: string;
  resource_type: string;
  external_id: string | null;
  target_user_id: string | null;
  outcome: string;
  http_status: number | null;
  request_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

/**
 * public.profiles, narrowed. Only what is needed to name a person in the
 * console — never a role, never a credential, never anything commercial.
 */
export interface PersonRow {
  id: string;
  email: string | null;
  full_name: string | null;
}
