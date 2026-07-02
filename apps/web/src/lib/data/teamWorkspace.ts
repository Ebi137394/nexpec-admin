// ════════════════════════════════════════════════════════════════════════════
//  lib/data/teamWorkspace.ts — Agency/Enterprise Team Workspace reads (RSC)
//
//  fetchTeamJobs() → the org's missions, visible to the whole team. Backed by the
//  nx_team_jobs() RPC (price-free, org-scoped). Detail/report/chat access for each
//  row is enforced by the team RLS (migrations 184000 + 186000). Fail-closed.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchConversationMessages } from '@/lib/data/conversations';
import type { MessageRow } from '@/lib/data/conversations.types';
import { ORG_MEMBER_ROLE_LABELS, type OrgMemberRole } from '@/lib/data/clientTeam.types';

export interface TeamJob {
  id: string;
  title: string | null;
  status: string;
  domain: string | null;
  location_city: string | null;
  scheduled_date: string | null;
  created_at: string;
  contractor_id: string | null;
  can_manage: boolean;
}

export async function fetchTeamJobs(): Promise<TeamJob[]> {
  try {
    const sb = await createSupabaseServerClient();
    const { data, error } = await sb.rpc('nx_team_jobs');
    if (error) return [];
    return (data ?? []) as TeamJob[];
  } catch {
    return [];
  }
}

export interface TeamChatContext {
  conversationId: string;
  messages: MessageRow[];
  canPost: boolean;
  senderRoles: Record<string, string>; // user id → org-role label (pseudonymous attribution)
}

// The buyer-side (agency↔admin) thread for a mission, with pseudonymous role
// labels for attribution. Returns null if no such conversation exists yet.
export async function fetchTeamChatContext(jobId: string): Promise<TeamChatContext | null> {
  try {
    const sb = await createSupabaseServerClient();
    const { data: conv } = await sb
      .from('conversations')
      .select('id')
      .eq('job_id', jobId)
      .eq('kind', 'job_client_admin')
      .maybeSingle();
    if (!conv) return null;
    const conversationId = (conv as { id: string }).id;

    const [messages, canPostRes, jobRes] = await Promise.all([
      fetchConversationMessages(conversationId),
      sb.rpc('nx_can_team_manage_conversation', { p_conversation_id: conversationId }),
      sb.from('jobs').select('agency_id, client_id').eq('id', jobId).maybeSingle(),
    ]);

    const senderRoles: Record<string, string> = {};
    const job = jobRes.data as { agency_id: string | null; client_id: string | null } | null;
    const owner = job?.agency_id ?? job?.client_id ?? null;
    if (owner) {
      const { data: ownerOrgs } = await sb.from('org_members').select('org_id').eq('user_id', owner);
      const orgIds = ((ownerOrgs ?? []) as Array<{ org_id: string }>).map((r) => r.org_id);
      if (orgIds.length) {
        const { data: mems } = await sb
          .from('org_members')
          .select('user_id, role')
          .in('org_id', orgIds);
        for (const m of (mems ?? []) as Array<{ user_id: string; role: OrgMemberRole }>) {
          senderRoles[m.user_id] = ORG_MEMBER_ROLE_LABELS[m.role] ?? 'Team';
        }
      }
    }

    return { conversationId, messages, canPost: canPostRes.data === true, senderRoles };
  } catch {
    return null;
  }
}

// The PRIVATE internal team thread for a mission (job_team_internal) — the platform
// admin is NOT a visible participant (Ghost Mode: read-only, never posts). Uses
// ensure_team_internal_conversation() which AUTO-CREATES the shared room for any
// teammate, so this returns a context whenever the caller is on the org. canPost is
// true only for non-viewer roles (nx_can_team_manage_internal). Returns null if the
// caller isn't a teammate (the RPC raises → caught) or on any error (fail-closed).
export async function fetchTeamInternalChatContext(jobId: string): Promise<TeamChatContext | null> {
  try {
    const sb = await createSupabaseServerClient();
    const { data: convId, error } = await sb.rpc('ensure_team_internal_conversation', {
      p_job_id: jobId,
    });
    if (error || !convId) return null;
    const conversationId = convId as string;

    const [messages, canPostRes, jobRes] = await Promise.all([
      fetchConversationMessages(conversationId),
      sb.rpc('nx_can_team_manage_internal', { p_conversation_id: conversationId }),
      sb.from('jobs').select('agency_id, client_id').eq('id', jobId).maybeSingle(),
    ]);

    const senderRoles: Record<string, string> = {};
    const job = jobRes.data as { agency_id: string | null; client_id: string | null } | null;
    const owner = job?.agency_id ?? job?.client_id ?? null;
    if (owner) {
      const { data: ownerOrgs } = await sb.from('org_members').select('org_id').eq('user_id', owner);
      const orgIds = ((ownerOrgs ?? []) as Array<{ org_id: string }>).map((r) => r.org_id);
      if (orgIds.length) {
        const { data: mems } = await sb
          .from('org_members')
          .select('user_id, role')
          .in('org_id', orgIds);
        for (const m of (mems ?? []) as Array<{ user_id: string; role: OrgMemberRole }>) {
          senderRoles[m.user_id] = ORG_MEMBER_ROLE_LABELS[m.role] ?? 'Team';
        }
      }
    }

    return { conversationId, messages, canPost: canPostRes.data === true, senderRoles };
  } catch {
    return null;
  }
}
