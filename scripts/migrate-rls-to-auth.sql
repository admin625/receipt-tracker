-- ============================================================
-- SnapReceipt — Migrate RLS from permissive to auth-based
-- ============================================================
-- Run this in the Supabase SQL Editor AFTER:
--   1. Creating Erinn's auth account (setup-auth-users.js)
--   2. Deploying the auth-enabled app
--
-- This drops the "allow all" policies and creates auth-based ones
-- so each user can only see/modify their own data.
-- ============================================================

-- Step 1: Drop permissive v1 policies
DROP POLICY IF EXISTS "Allow all for receipts" ON receipts;
DROP POLICY IF EXISTS "Allow all for clients_receipt" ON clients_receipt;
DROP POLICY IF EXISTS "Allow all for trips" ON trips;
DROP POLICY IF EXISTS "Allow all for sr_accounts" ON sr_accounts;

-- Step 2: Create auth-based policies
-- Note: user_id is TEXT, auth.uid() returns UUID — cast to text for comparison

CREATE POLICY "Users see own receipts" ON receipts
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users see own clients" ON clients_receipt
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "Users see own trips" ON trips
  FOR ALL USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- sr_accounts: users can read their own account
CREATE POLICY "Users see own account" ON sr_accounts
  FOR SELECT USING (id = auth.uid());

-- sr_accounts: only service role can insert/update (admin operations)
CREATE POLICY "Service role manages accounts" ON sr_accounts
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
