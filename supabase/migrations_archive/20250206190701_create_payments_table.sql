-- Create payments table for financial tracking
-- Replay-safety: payment_status was created out-of-band on the live DB and is in
-- no migration, so a from-scratch replay (db reset / --include-all) dies here.
-- Create it guarded + make the table idempotent. No effect on prod (which already
-- has the type). Values cover the migration's default ('pending'); confirm against
-- prod if the legacy payments table is ever brought back into active use.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'refunded', 'cancelled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inspector_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'SAR',
  status payment_status NOT NULL DEFAULT 'pending',
  description TEXT,
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  paid_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for performance
CREATE INDEX idx_payments_client_id ON payments(client_id);
CREATE INDEX idx_payments_project_id ON payments(project_id);
CREATE INDEX idx_payments_inspector_id ON payments(inspector_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_due_date ON payments(due_date);

-- Enable Row Level Security
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payments
CREATE POLICY "Clients can view payments for their projects" ON payments
  FOR SELECT USING (
    client_id = auth.uid()
  );

CREATE POLICY "Inspectors can view payments for their projects" ON payments
  FOR SELECT USING (
    inspector_id = auth.uid()
  );

CREATE POLICY "Clients can insert payments" ON payments
  FOR INSERT WITH CHECK (client_id = auth.uid());

CREATE POLICY "Clients can update payments" ON payments
  FOR UPDATE USING (client_id = auth.uid());

CREATE POLICY "Clients can delete payments" ON payments
  FOR DELETE USING (client_id = auth.uid());

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_payments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_payments_updated_at();