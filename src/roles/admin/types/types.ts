// lib/super-admin/types.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Shared TypeScript interfaces for the Super Admin module.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  avatar_url: string | null;
  phone: string | null;
  company_name: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  status: string;
  client_id: string | null;
  agency_id: string | null;
  inspector_id: string | null;
  contractor_id: string | null;
  created_at: string;
  updated_at: string | null;
  scheduled_date: string | null;
  budget_cents: number | null;          // ★ Task 4
  client_price_cents: number | null;    // ★ Task 4
  payout_amount_cents: number | null;   // ★ Task 4
  platform_spread_cents: number | null; // ★ Task 4
  payout_status: string;
  admin_confirmed_at: string | null;
  admin_confirmed_by: string | null;
  // Joined
  client?: Profile | null;
  inspector?: Profile | null;
  agency?: Profile | null;
}

export interface Conversation {
  id: string;
  job_id: string | null;
  created_at: string;
  updated_at: string | null;
  participants?: { user_id: string; profile?: Profile }[];
  last_message_text?: string | null;
  last_message_at?: string | null;
  job?: { id: string; title: string; status: string } | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: Profile | null;
}

export interface SupportMessage {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;          // 'open' | 'pending' | 'resolved'
  created_at: string;
  admin_reply: string | null;
  admin_reply_at: string | null;
  replied_by: string | null;
  user?: Profile | null;
}

export interface VerificationDoc {
  id: string;
  user_id: string;
  document_type: string;
  document_url: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  notes?: string;
  user?: Profile;
}

export interface DashboardKPI {
  totalVolume: number;
  platformProfit: number;
  pendingPayouts: number;
  activeJobs: number;
  pendingModeration: number;
  pendingVerifications: number;
  openSupport: number;
  openHelpdesk: number;
  totalJobs: number;
}