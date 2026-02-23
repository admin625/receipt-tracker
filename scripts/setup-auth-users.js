#!/usr/bin/env node
// ============================================================
// SnapReceipt — Create Supabase Auth Users
// ============================================================
// Usage:
//   SUPABASE_SERVICE_KEY=your-service-role-key node scripts/setup-auth-users.js
//
// This script:
//   1. Creates auth accounts for Erinn and Megan
//   2. Links their Auth UIDs to the sr_accounts table
//   3. Migrates existing data (user_id 'erinn' → Erinn's auth UUID)
//
// Run this ONCE before deploying the auth-enabled app.
// ============================================================

const SUPABASE_URL = 'https://kidgcrqxrfcbsaeguwop.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SERVICE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_KEY environment variable');
  console.error('Usage: SUPABASE_SERVICE_KEY=xxx node scripts/setup-auth-users.js');
  process.exit(1);
}

const USERS = [
  {
    email: 'erinnkate@aol.com',
    password: '***REDACTED***',
    name: 'Erinn',
    migrateFrom: 'erinn', // Existing user_id in database
  },
  {
    email: 'mcdonald1313@gmail.com',
    password: '***REDACTED***',
    name: 'Megan',
    migrateFrom: null, // New user, no existing data
  },
];

async function supaAdmin(path, opts = {}) {
  const resp = await fetch(SUPABASE_URL + path, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`${resp.status} ${path}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function createUser(user) {
  try {
    const result = await supaAdmin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: { name: user.name },
      }),
    });

    console.log(`  Created: ${user.email}`);
    console.log(`    UID: ${result.id}`);
    return result;
  } catch (err) {
    if (err.message.includes('already been registered') || err.message.includes('already exists')) {
      console.log(`  Skipped: ${user.email} (already exists)`);
      // Fetch existing user to get UID
      const users = await supaAdmin('/auth/v1/admin/users?page=1&per_page=50');
      const existing = users.users.find(u => u.email === user.email);
      if (existing) {
        console.log(`    UID: ${existing.id}`);
        return existing;
      }
      return null;
    }
    throw err;
  }
}

async function main() {
  console.log('=== SnapReceipt Auth User Setup ===\n');

  const createdUsers = [];

  for (const user of USERS) {
    console.log(`\nProcessing: ${user.name} (${user.email})`);

    // 1. Create auth user
    const authUser = await createUser(user);
    if (!authUser) {
      console.log(`  WARNING: Could not create or find user ${user.email}`);
      continue;
    }

    createdUsers.push({ ...user, uid: authUser.id });

    // 2. Upsert into sr_accounts
    await supaAdmin('/rest/v1/sr_accounts', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: authUser.id,
        email: user.email,
        name: user.name,
        plan: 'free',
        is_active: true,
      }),
    });
    console.log(`  Linked to sr_accounts table`);

    // 3. Migrate existing data if needed
    if (user.migrateFrom) {
      console.log(`  Migrating data from user_id='${user.migrateFrom}' to '${authUser.id}'...`);

      for (const table of ['receipts', 'clients_receipt', 'trips']) {
        const resp = await supaAdmin(`/rest/v1/${table}?user_id=eq.${user.migrateFrom}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ user_id: authUser.id }),
        });
        const count = Array.isArray(resp) ? resp.length : 0;
        console.log(`    ${table}: ${count} rows migrated`);
      }
    }
  }

  console.log('\n=== Summary ===');
  createdUsers.forEach(u => {
    console.log(`  ${u.name}: ${u.email} → UID: ${u.uid}`);
  });

  console.log('\n--- Temporary Passwords ---');
  USERS.forEach(u => {
    console.log(`  ${u.email}: ${u.password}`);
  });

  console.log('\nUsers should change their passwords after first login.');
  console.log('Done!');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
