-- ============================================================
-- SnapReceipt — COMPLETE Supabase Setup
-- ============================================================
-- Paste this ENTIRE block into the Supabase SQL Editor and run.
-- URL: https://supabase.com/dashboard/project/kidgcrqxrfcbsaeguwop/sql
--
-- This creates:
--   1. clients_receipt table
--   2. trips table
--   3. receipts table
--   4. sr_accounts table
--   5. Indexes on user_id columns
--   6. RLS policies (auth.uid()-based)
--   7. Storage bucket for receipt photos
--   8. sr_accounts record for admin@fiorsaoirse.com
--   9. Password fix: admin@fiorsaoirse.com → Erinn1971
-- ============================================================

-- ============================================================
-- STEP 1: Create tables
-- ============================================================

-- Saved clients for tagging
CREATE TABLE IF NOT EXISTS clients_receipt (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved work trips
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receipt photos and metadata
CREATE TABLE IF NOT EXISTS receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
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

-- Accounts table (links auth UUID to user profile)
CREATE TABLE IF NOT EXISTS sr_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro')),
  stripe_customer_id TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STEP 2: Indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON receipts(type);
CREATE INDEX IF NOT EXISTS idx_receipts_client ON receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip ON receipts(trip_id);
CREATE INDEX IF NOT EXISTS idx_clients_receipt_user_id ON clients_receipt(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON trips(user_id);

-- ============================================================
-- STEP 3: Enable Row Level Security
-- ============================================================

ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE sr_accounts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 4: Auth-based RLS policies
-- ============================================================
-- user_id is TEXT, auth.uid() returns UUID — cast to text

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

-- ============================================================
-- STEP 5: Storage bucket for receipt photos
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- STEP 6: Insert sr_accounts records for auth users
-- ============================================================
-- admin@fiorsaoirse.com  UUID: 0b95a442-9583-46a6-924f-da88a6929fd6
-- erinnkate@aol.com      UUID: f82a166e-cf98-45b8-89f9-84ad01533038
-- mcdonald1313@gmail.com UUID: 3a3b72aa-c4cb-49a6-9aee-8d2915ce1335

INSERT INTO sr_accounts (id, email, name, plan, is_active) VALUES
  ('0b95a442-9583-46a6-924f-da88a6929fd6', 'admin@fiorsaoirse.com', 'Mac (Admin)', 'pro', true),
  ('f82a166e-cf98-45b8-89f9-84ad01533038', 'erinnkate@aol.com', 'Erinn', 'free', true),
  ('3a3b72aa-c4cb-49a6-9aee-8d2915ce1335', 'mcdonald1313@gmail.com', 'Megan', 'free', true)
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- STEP 7: Fix admin password to Erinn1971
-- ============================================================

UPDATE auth.users
SET encrypted_password = crypt('Erinn1971', gen_salt('bf'))
WHERE email = 'admin@fiorsaoirse.com';

-- ============================================================
-- DONE! Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   ORDER BY table_name;
-- ============================================================
