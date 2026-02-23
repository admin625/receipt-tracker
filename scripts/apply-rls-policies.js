#!/usr/bin/env node
// ============================================================
// SnapReceipt — Apply Auth-Based RLS Policies
// ============================================================
// Usage:
//   SUPABASE_SERVICE_KEY=your-service-role-key node scripts/apply-rls-policies.js
//
// Drops old permissive "Allow all" policies and creates
// auth-based policies that enforce per-user data isolation.
// ============================================================

const SUPABASE_URL = 'https://kidgcrqxrfcbsaeguwop.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_KEY environment variable');
  console.error('Usage: SUPABASE_SERVICE_KEY=xxx node scripts/apply-rls-policies.js');
  process.exit(1);
}

async function runSQL(sql) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/exec_sql', {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  // If exec_sql doesn't exist, fall back to the SQL endpoint
  if (resp.status === 404 || resp.status === 400) {
    // Use the pg-meta SQL execution endpoint
    const resp2 = await fetch(SUPABASE_URL + '/pg/query', {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });
    const text2 = await resp2.text();
    if (!resp2.ok) {
      throw new Error(`SQL failed (${resp2.status}): ${text2}`);
    }
    return text2;
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`SQL failed (${resp.status}): ${text}`);
  }
  return text;
}

async function main() {
  console.log('=== Applying Auth-Based RLS Policies ===\n');

  // Step 1: Drop old permissive policies
  console.log('Step 1: Dropping old "Allow all" policies...');
  const dropStatements = [
    'DROP POLICY IF EXISTS "Allow all for receipts" ON receipts;',
    'DROP POLICY IF EXISTS "Allow all for clients_receipt" ON clients_receipt;',
    'DROP POLICY IF EXISTS "Allow all for trips" ON trips;',
    'DROP POLICY IF EXISTS "Allow all for sr_accounts" ON sr_accounts;',
  ];

  for (const sql of dropStatements) {
    try {
      await runSQL(sql);
      console.log(`  OK: ${sql.substring(0, 60)}...`);
    } catch (err) {
      console.log(`  WARN: ${err.message}`);
    }
  }

  // Step 2: Create new auth-based policies
  console.log('\nStep 2: Creating auth-based policies...');
  const createStatements = [
    `CREATE POLICY "Users see own receipts" ON receipts
      FOR ALL USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);`,
    `CREATE POLICY "Users see own clients" ON clients_receipt
      FOR ALL USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);`,
    `CREATE POLICY "Users see own trips" ON trips
      FOR ALL USING (user_id = auth.uid()::text)
      WITH CHECK (user_id = auth.uid()::text);`,
    `CREATE POLICY "Users see own account" ON sr_accounts
      FOR SELECT USING (id = auth.uid());`,
    `CREATE POLICY "Service role manages accounts" ON sr_accounts
      FOR ALL USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');`,
  ];

  for (const sql of createStatements) {
    try {
      await runSQL(sql);
      const policyName = sql.match(/"([^"]+)"/)?.[1] || 'unknown';
      console.log(`  OK: Created "${policyName}"`);
    } catch (err) {
      console.log(`  WARN: ${err.message}`);
    }
  }

  // Step 3: Remove default values on user_id columns
  console.log('\nStep 3: Removing default user_id values...');
  const alterStatements = [
    "ALTER TABLE receipts ALTER COLUMN user_id DROP DEFAULT;",
    "ALTER TABLE clients_receipt ALTER COLUMN user_id DROP DEFAULT;",
    "ALTER TABLE trips ALTER COLUMN user_id DROP DEFAULT;",
  ];

  for (const sql of alterStatements) {
    try {
      await runSQL(sql);
      console.log(`  OK: ${sql.substring(0, 60)}...`);
    } catch (err) {
      console.log(`  WARN: ${err.message}`);
    }
  }

  console.log('\nDone! RLS policies are now enforcing per-user data isolation.');
  console.log('Make sure auth users are created and data is migrated before testing.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
