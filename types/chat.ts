/** Safe profile shape — NEVER includes email, phone, or other PII */
export interface SafeProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

/** Raw row from the messages table */
export interface MessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/** Hydrated message used in the UI */
export interface ChatMessage extends MessageRow {
  sender: SafeProfile;
}

/** Possible room context types */
export type RoomContext = "job" | "certificate";

/** Helper to build deterministic room IDs */
export function buildRoomId(
  context: RoomContext,
  contextId: string
): string {
  return `${context}_${contextId}`;
}