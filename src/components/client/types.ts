// ============================================================
// NEXPEC Client-Side Data Contracts
// These mirror the Supabase table shapes used by client queries.
//
// EXPECTED TABLES:
//   projects  – id, title, location, status, client_id, inspector_id,
//               is_on_site, asset_tag, created_at, updated_at
//   profiles  – id, full_name, avatar_url, role
//   findings  – id, project_id, category, severity, description,
//               photo_url, created_at
//   payments  – id, project_id, client_id, description, amount,
//               status, due_date
// ============================================================

export type ProjectStatus =
  | 'pending'
  | 'in_progress'
  | 'reviewing'
  | 'finalized';

export type FindingSeverity =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'paid';

// ── Row Types ──────────────────────────────────────────────

export interface InspectorProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface Project {
  id: string;
  title: string;
  location: string;
  status: ProjectStatus;
  client_id: string;
  inspector_id: string | null;
  is_on_site: boolean;
  asset_tag: string | null;
  created_at: string;
  updated_at: string;
  inspector?: InspectorProfile;
}

export interface Finding {
  id: string;
  project_id: string;
  category: string;
  severity: FindingSeverity;
  description: string;
  photo_url: string | null;
  created_at: string;
  project?: {
    title: string;
    location: string;
  };
}

export interface Payment {
  id: string;
  project_id: string;
  client_id: string;
  description: string;
  amount: number;
  status: PaymentStatus;
  due_date: string;
  project?: {
    title: string;
  };
}

// ── Pipeline Aggregate ─────────────────────────────────────

export interface PipelineBucket {
  status: ProjectStatus;
  label: string;
  icon: string;
  color: string;
  projects: Project[];
}

// ── Risk Aggregate ─────────────────────────────────────────

export interface RiskCategory {
  category: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  riskScore: number; // weighted score for sorting
}

// ── Monthly Spend ──────────────────────────────────────────

export interface MonthlySpend {
  month: string;       // "Jan", "Feb" …
  amount: number;
}