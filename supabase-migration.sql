-- ============================================================
-- Receipts by Fiorsaoirse — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Saved clients for tagging
CREATE TABLE IF NOT EXISTS clients_receipt (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Saved work trips
CREATE TABLE IF NOT EXISTS trips (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receipt photos and metadata
CREATE TABLE IF NOT EXISTS receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'mac',
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
CREATE INDEX IF NOT EXISTS idx_receipts_user ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_type ON receipts(type);
CREATE INDEX IF NOT EXISTS idx_receipts_client ON receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_receipts_trip ON receipts(trip_id);

-- Storage bucket for receipt photos
-- Run this separately or create via Supabase Dashboard:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true);

-- RLS policies (allow all for anon key — single-user app)
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for receipts" ON receipts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for clients_receipt" ON clients_receipt FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for trips" ON trips FOR ALL USING (true) WITH CHECK (true);
