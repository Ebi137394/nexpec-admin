-- ============================================================================
-- EARNINGS TABLES — Integer-based financial system for inspectors
-- All amounts in Halalas (100 halalas = 1 SAR)
-- ============================================================================

-- Inspector Earnings Wallet
CREATE TABLE IF NOT EXISTS public.inspector_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  available_balance_halalas BIGINT NOT NULL DEFAULT 0,
  pending_halalas BIGINT NOT NULL DEFAULT 0,
  total_earned_halalas BIGINT NOT NULL DEFAULT 0,
  ytd_gross_halalas BIGINT NOT NULL DEFAULT 0,
  referral_code VARCHAR(20) UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactions table (payouts, job payments, bonuses)
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  description TEXT,
  gross_amount_halalas BIGINT NOT NULL,
  platform_fee_halalas BIGINT NOT NULL DEFAULT 0,
  net_amount_halalas BIGINT GENERATED ALWAYS AS (gross_amount_halalas - platform_fee_halalas) STORED,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('paid', 'processing', 'pending', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Work sessions for time tracking
CREATE TABLE IF NOT EXISTS public.work_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspector_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inspector_earnings_inspector ON public.inspector_earnings(inspector_id);
CREATE INDEX IF NOT EXISTS idx_transactions_inspector ON public.transactions(inspector_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_sessions_inspector ON public.work_sessions(inspector_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_active ON public.work_sessions(inspector_id) WHERE ended_at IS NULL;

-- RLS Policies
ALTER TABLE public.inspector_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_sessions ENABLE ROW LEVEL SECURITY;

-- Inspector can read their own earnings
CREATE POLICY "Inspectors can view own earnings" ON public.inspector_earnings
  FOR SELECT USING (auth.uid() = inspector_id);

-- Inspector can read their own transactions
CREATE POLICY "Inspectors can view own transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = inspector_id);

-- Inspector can read their own work sessions
CREATE POLICY "Inspectors can view own work sessions" ON public.work_sessions
  FOR SELECT USING (auth.uid() = inspector_id);

-- Allow service role to insert/update (for triggers/webhooks)
CREATE POLICY "Service role can manage earnings" ON public.inspector_earnings
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage transactions" ON public.transactions
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role can manage work sessions" ON public.work_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- Get weekly earnings breakdown by day
CREATE OR REPLACE FUNCTION public.get_weekly_earnings(p_inspector_id UUID)
RETURNS TABLE(day DATE, net_halalas BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.created_at::DATE AS day,
    COALESCE(SUM(t.net_amount_halalas), 0)::BIGINT AS net_halalas
  FROM public.transactions t
  WHERE t.inspector_id = p_inspector_id
    AND t.status = 'paid'
    AND t.created_at >= CURRENT_DATE - INTERVAL '7 days'
  GROUP BY t.created_at::DATE
  ORDER BY day;
END;
$$;

-- Get monthly breakdown (gross, fees, net)
CREATE OR REPLACE FUNCTION public.get_monthly_breakdown(p_inspector_id UUID)
RETURNS TABLE(
  gross_halalas BIGINT,
  platform_fee_halalas BIGINT,
  net_halalas BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(t.gross_amount_halalas), 0)::BIGINT AS gross_halalas,
    COALESCE(SUM(t.platform_fee_halalas), 0)::BIGINT AS platform_fee_halalas,
    COALESCE(SUM(t.net_amount_halalas), 0)::BIGINT AS net_halalas
  FROM public.transactions t
  WHERE t.inspector_id = p_inspector_id
    AND t.status = 'paid'
    AND t.created_at >= DATE_TRUNC('month', CURRENT_DATE)
    AND t.created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month';
END;
$$;

-- Function to auto-create inspector_earnings record on user creation
CREATE OR REPLACE FUNCTION public.handle_new_inspector()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.inspector_earnings (
    inspector_id,
    referral_code,
    available_balance_halalas,
    pending_halalas,
    total_earned_halalas,
    ytd_gross_halalas
  ) VALUES (
    NEW.id,
    UPPER(SUBSTRING(MD5(NEW.id::TEXT) FOR 8)),
    0, 0, 0, 0
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create earnings record for new users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_inspector();

-- Comments
COMMENT ON TABLE public.inspector_earnings IS 'Inspector wallet with integer halala balances';
COMMENT ON TABLE public.transactions IS 'Financial transactions in halalas (100 = 1 SAR)';
COMMENT ON TABLE public.work_sessions IS 'Work timer sessions for time tracking';
COMMENT ON FUNCTION public.get_weekly_earnings IS 'Returns weekly earnings grouped by day';
COMMENT ON FUNCTION public.get_monthly_breakdown IS 'Returns current month gross, fee, and net totals';
