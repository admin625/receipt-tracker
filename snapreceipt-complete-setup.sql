-- ============================================================
-- SnapReceipt — COMPLETE Supabase Setup
-- ============================================================
-- Target: NEW dedicated SnapReceipt project (qmpskuawmubxjoyoqdhu)
-- URL: https://supabase.com/dashboard/project/qmpskuawmubxjoyoqdhu/sql
--
-- Paste this ENTIRE block into the Supabase SQL Editor and run.
--
-- Auth users already created via Admin API:
--   erinnkate@aol.com      → c1048478-fb41-4521-a131-839290226425
--   mcdonald1313@gmail.com → a76ebded-234f-4d2c-980e-f75bd4d40d1f
--   admin@fiorsaoirse.com  → bbf89f02-428d-458a-822b-0d2e352b1cb8
--
-- Storage bucket already created via API.
--
-- This script creates:
--   1. clients_receipt, trips, receipts, sr_accounts tables
--   2. Indexes on user_id columns
--   3. RLS policies (auth.uid()-based)
--   4. Storage RLS policies for receipt photos
--   5. sr_accounts records for all 3 users
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
-- STEP 5: Storage RLS policies for receipt photos
-- ============================================================
-- Bucket 'receipts' already created via API.
-- Files are stored as: {user_id}/{filename}
-- Each user can only upload/read/delete their own files.

CREATE POLICY "Users upload own receipts" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users read own receipts" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users delete own receipts" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'receipts'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Public read access for receipt images (bucket is public)
CREATE POLICY "Public read receipt images" ON storage.objects
  FOR SELECT USING (bucket_id = 'receipts');

-- ============================================================
-- STEP 6: Insert sr_accounts records for auth users
-- ============================================================

INSERT INTO sr_accounts (id, email, name, plan, is_active) VALUES
  ('bbf89f02-428d-458a-822b-0d2e352b1cb8', 'admin@fiorsaoirse.com', 'Mac (Admin)', 'pro', true),
  ('c1048478-fb41-4521-a131-839290226425', 'erinnkate@aol.com', 'Erinn', 'free', true),
  ('a76ebded-234f-4d2c-980e-f75bd4d40d1f', 'mcdonald1313@gmail.com', 'Megan', 'free', true)
ON CONFLICT (email) DO NOTHING;

-- ============================================================
-- DONE! Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   ORDER BY table_name;
-- ============================================================
