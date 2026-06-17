-- Create support_messages table for help & support chat functionality
CREATE TABLE IF NOT EXISTS support_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  attachment_url TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('image', 'document')),
  attachment_name TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_sender_id ON support_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_created_at ON support_messages(created_at);

-- Enable Row Level Security
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own support messages
CREATE POLICY "Users can view their support messages"
  ON support_messages FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert messages for themselves
CREATE POLICY "Users can send support messages"
  ON support_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Users can update read status of their messages
CREATE POLICY "Users can update support message read status"
  ON support_messages FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_support_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_support_messages_updated_at ON support_messages;
CREATE TRIGGER update_support_messages_updated_at
  BEFORE UPDATE ON support_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_support_messages_updated_at();

-- Enable Realtime for support_messages table
ALTER PUBLICATION supabase_realtime ADD TABLE support_messages;