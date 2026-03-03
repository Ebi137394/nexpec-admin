// src/types/dashboard.ts

export type TabDomain = 'Operations' | 'Assets' | 'Team' | 'Finance';

export interface CriticalAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  source: string;
  timestamp: string;
  acknowledged: boolean;
  organization_id: string;
}

// ── Mapped to the 'projects' table, NOT 'work_orders' ──
export interface StatusBreakdown {
  active: number;
  pending: number;
  completed: number;
  blocked: number;
  total: number;
}

export interface OperationsData {
  statusBreakdown: StatusBreakdown;
  activeWorkOrders: number;
  completionRate: number;
  avgCycleTime: number;
  loading: boolean;
  error: string | null;
}

export interface AssetRecord {
  id: string;
  asset_tag: string;
  name: string;
  category: string;
  status: 'operational' | 'maintenance' | 'decommissioned' | 'in_transit';
  location: string;
  last_inspection: string;
  next_inspection: string;
  organization_id: string;
}

export interface InspectionEvent {
  id: string;
  asset_id: string;
  inspector_id: string;
  inspector_name: string;
  event_type: 'routine' | 'corrective' | 'emergency';
  findings: string;
  status: 'pass' | 'fail' | 'conditional';
  created_at: string;
}

// ── Mapped to 'payments' + 'milestones' tables, NOT 'spend_entries' ──
export interface SpendingData {
  burnRate: { date: string; amount: number; budget: number }[];
  utilization: number;
  totalBudget: number;
  totalSpent: number;
  pendingPayments: number;
  loading: boolean;
  error: string | null;
}

export interface TeamMember {
  id: string;
  full_name: string;
  role: string;
  status: 'active' | 'idle' | 'offline' | 'on_leave';
  avatar_url: string | null;
  current_task: string | null;
  last_seen: string;
  organization_id: string;
}