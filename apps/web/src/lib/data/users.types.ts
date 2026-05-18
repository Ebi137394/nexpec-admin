// ════════════════════════════════════════════════════════════════════════════
//  lib/data/users.types.ts — type-only + pure-constant module
//  Safe to import from Client Components.
// ════════════════════════════════════════════════════════════════════════════

export interface AdminUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  avatar_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  cci_active: boolean;
  cci_tier: string | null;
}

export interface UsersPageResult {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UsersQuery {
  page?: number;
  pageSize?: number;
  role?: string;
  search?: string;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const KNOWN_ROLES = [
  'super_admin',
  'admin',
  'agency',
  'enterprise',
  'client',
  'inspector',
  'contractor',
] as const;
