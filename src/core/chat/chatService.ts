// ─── Chat Service (Supabase Queries) ────────────────────────────────────────────

import { supabase } from "@/src/core/supabase/supabase";
import type { ChatMessage, MessageRow, SafeProfile } from "@/types/chat";

// ─── Profile Cache ────────────────────────────────────────────
const profileCache = new Map<string, SafeProfile>();

/**
 * Fetch a safe profile (full_name + avatar_url only).
 * Caches results in-memory to avoid redundant queries.
 */
export async function getSafeProfile(
  userId: string
): Promise<SafeProfile> {
  if (profileCache.has(userId)) {
    return profileCache.get(userId)!;
  }

  const { data, error } = await supabase
    .from("safe_profiles") // the secure view — no email/phone
    .select("id, full_name, avatar_url")
    .eq("id", userId)
    .single();

  if (error || !data) {
    // Fallback so the UI never crashes
    const fallback: SafeProfile = {
      id: userId,
      full_name: "Unknown User",
      avatar_url: null,
    };
    profileCache.set(userId, fallback);
    return fallback;
  }

  const profile: SafeProfile = {
    id: data.id,
    full_name: data.full_name ?? "Unknown User",
    avatar_url: data.avatar_url ?? null,
  };

  profileCache.set(userId, profile);
  return profile;
}

/**
 * Hydrate a raw message row with its sender profile.
 */
export async function hydrateMessage(
  row: MessageRow
): Promise<ChatMessage> {
  const sender = await getSafeProfile(row.sender_id);
  return { ...row, sender };
}

// ─── Message Queries ──────────────────────────────────────────

/**
 * Load the last `limit` messages for a room, oldest-first.
 */
export async function fetchMessages(
  roomId: string,
  limit = 50
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, sender_id, content, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[chatService] fetchMessages error:", error.message);
    return [];
  }

  // Reverse so oldest is first (chat order)
  const rows = (data as MessageRow[]).reverse();

  // Hydrate all messages in parallel
  return Promise.all(rows.map(hydrateMessage));
}

/**
 * Send a message to a room. Returns the hydrated message or null.
 */
export async function sendMessage(
  roomId: string,
  content: string
): Promise<ChatMessage | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[chatService] sendMessage: no authenticated user");
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed) return null;

  const { data, error } = await supabase
    .from("messages")
    .insert({
      room_id: roomId,
      sender_id: user.id,
      content: trimmed,
    })
    .select("id, room_id, sender_id, content, created_at")
    .single();

  if (error || !data) {
    console.error("[chatService] sendMessage error:", error?.message);
    return null;
  }

  return hydrateMessage(data as MessageRow);
}

/**
 * Load older messages before a given timestamp (pagination).
 */
export async function fetchOlderMessages(
  roomId: string,
  beforeTimestamp: string,
  limit = 30
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, room_id, sender_id, content, created_at")
    .eq("room_id", roomId)
    .lt("created_at", beforeTimestamp)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[chatService] fetchOlderMessages error:", error.message);
    return [];
  }

  const rows = (data as MessageRow[]).reverse();
  return Promise.all(rows.map(hydrateMessage));
}