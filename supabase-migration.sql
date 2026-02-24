-- ============================================================
-- SnapReceipt — Supabase Schema (DEPRECATED)
-- Use snapreceipt-complete-setup.sql instead.
-- Target project: qmpskuawmubxjoyoqdhu (dedicated SnapReceipt)
-- ============================================================

-- Saved clients for tagging (with user_id for multi-tenancy)
CREATE TABLE IF NOT EXISTS clients_receipt (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'erinn',
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved work trips (with user_id for multi-tenancy)
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'erinn',
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receipt photos and metadata
CREATE TABLE IF NOT EXISTS receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'erinn',
  photo_url TEXT NOT NULL,
  vendor TEXT,
  amount DECIMAL(10,2),
  receipt_date DATE,
  type TEXT NOT NULL CHECK (type IN ('business', 'personal')),
  category TEXT,
  client_id UUID REFERENCES clients_receipt(id) ON DELETE SET NULL,
  trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  payment_method TEXT,
  notes TEXT,
  ocr_raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON receipts(type);
CREATE INDEX IF NOT EXISTS idx_receipts_client ON receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip ON receipts(trip_id);
CREATE INDEX IF NOT EXISTS idx_clients_receipt_user_id ON clients_receipt(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);

-- Accounts table (not used in v1, ready for multi-user subscription)
CREATE TABLE IF NOT EXISTS sr_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro')),
  stripe_customer_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage bucket for receipt photos
-- Run this separately or create via Supabase Dashboard:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

-- RLS: Enable on all tables
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE sr_accounts ENABLE ROW LEVEL SECURITY;

-- Auth-based RLS policies (user_id is TEXT, auth.uid() is UUID — cast to text)
CREATE POLICY "Users see own receipts" ON receipts
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users see own clients" ON clients_receipt
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users see own trips" ON trips
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users see own account" ON sr_accounts
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Service role manages accounts" ON sr_accounts
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
