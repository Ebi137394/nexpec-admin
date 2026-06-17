-- Create messages table for chat functionality
CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL,
  sender_id UUID NOT NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- Enable Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies — GUARDED for clean-replay ordering.
-- The canonical `conversations` table is created later
-- (20260518160000_conversations_and_messages_v2), so on a from-scratch replay it
-- does not exist yet and these subqueries would fail. These legacy policies are
-- also SUPERSEDED by v2's msg_* policies. Create them only where conversations
-- already exists (the live DB this migration first ran against); skip on a fresh
-- reset, where v2 installs the operative policies. No effect on prod.
DO $msgpol$
BEGIN
  IF to_regclass('public.conversations') IS NOT NULL THEN
    EXECUTE $p$
      CREATE POLICY "Users can view messages in their conversations"
        ON messages FOR SELECT
        USING (conversation_id IN (SELECT id FROM conversations WHERE user1_id = auth.uid() OR user2_id = auth.uid()))
    $p$;
    EXECUTE $p$
      CREATE POLICY "Users can send messages in their conversations"
        ON messages FOR INSERT
        WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE user1_id = auth.uid() OR user2_id = auth.uid()))
    $p$;
    EXECUTE $p$
      CREATE POLICY "Users can update read status"
        ON messages FOR UPDATE
        USING (conversation_id IN (SELECT id FROM conversations WHERE user1_id = auth.uid() OR user2_id = auth.uid()))
        WITH CHECK (conversation_id IN (SELECT id FROM conversations WHERE user1_id = auth.uid() OR user2_id = auth.uid()))
    $p$;
  END IF;
END
$msgpol$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_messages_updated_at ON messages;
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_messages_updated_at();

-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;