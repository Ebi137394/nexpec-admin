// ============================================================================
// DATABASE TYPES — Strict interfaces matching your Supabase schema
// ============================================================================

export interface Profile {
  id: string;
  full_name: string;
  role: 'client' | 'inspector';
  avatar_url: string | null;
  email: string;
  created_at: string;
}

export interface Job {
  id: string;
  title: string;
  address: string | null;
  status: 'pending' | 'active' | 'completed' | 'cancelled';
  inspector_id: string | null;
  client_id: string;
  scheduled_date: string | null;
  created_at: string;
  updated_at: string;
  // Joined relations (populated via .select with foreign keys)
  inspector?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
  client?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

export interface Transaction {
  id: string;
  job_id: string;
  user_id: string;
  amount: number;
  status: 'pending' | 'completed' | 'refunded';
  created_at: string;
}

export interface Message {
  id: string;
  job_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  // Joined relation
  sender?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
}

// GiftedChat-compatible message shape used in useChat/ChatScreen
export interface ChatMessage {
  _id: string;
  text: string;
  createdAt: Date;
  user: {
    _id: string;
    name: string;
    avatar?: string;
  };
}