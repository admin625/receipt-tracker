# CLAUDE.md — SnapReceipt

> Read this file at the start of every session. Do not skip it.
> Update the changelog at the bottom after every session.

---

## 1. What Is This Project?

**SnapReceipt** is a mobile-first PWA receipt tracker for small business owners. Users photograph receipts, Claude OCR extracts vendor/amount/date/category, and receipts are tagged by client, trip, or expense type for tax prep and accounting.

- **Live URL:** https://receipt-tracker-fiorsaoirse.netlify.app
- **Primary user:** Erinn (erinnkate@aol.com) — treat her data as production
- **Status:** Live and in use. One paying-adjacent user. Treat every change as production-risk.

---

## 2. How This Fits the Broader Ecosystem

SnapReceipt is **fully isolated** from all other Fiorsaoirse products (FCA, HeardChef, Lead Concierge, Amazon PPC Agent).

**Shared infrastructure only** (no shared data, auth, or code):
| Resource | Shared With |
|---|---|
| Netlify account | Other Fiorsaoirse products |
| Stripe account | Other Fiorsaoirse products |
| n8n instance | jmac.app.n8n.cloud |
| GitHub org | admin625 |

**Never share or cross-wire:**
- The Supabase project (`qmpskuawmubxjoyoqdhu`) — dedicated to SnapReceipt only
- Database tables — no foreign keys or references to FCA or any other product
- Auth — completely separate user pool

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS PWA — no framework, no build step |
| Hosting | Netlify (publish dir: `.` / repo root) |
| Database | Supabase (`qmpskuawmubxjoyoqdhu`) |
| Auth | Supabase Auth (email/password + password reset) |
| Storage | Supabase Storage — `receipts` bucket |
| OCR | Anthropic Claude API (`claude-sonnet-4-5-20250514`) via Netlify Function proxy |
| Payments | Stripe ($9.95/mo) |
| Automation | n8n webhook handler for Stripe events |
| PWA | Service Worker (`sw.js`, cache v3), `manifest.json`, iOS-installable |

---

## 4. Key Files

```
/
├── index.html          # SPA shell — 5 pages: Dashboard, Scan, Summary, Settings, Detail
├── app.js              # ENTIRE application logic (~1,133 lines) — auth, CRUD, OCR, filtering, export, analytics
├── app.css             # Full design system — purple brand (#7c3aed), dark mode support
├── manifest.json       # PWA config
├── sw.js               # Service Worker — offline-first, cache v3 (skips Supabase/Anthropic calls)
├── netlify.toml        # Publish from root, security headers, SPA redirect rule
├── snapreceipt-complete-setup.sql  # ✅ CURRENT schema — tables, indexes, RLS, storage RLS, seed users
└── supabase-migration.sql          # ❌ DEPRECATED — do not use or reference
```

---

## 5. Database Schema (Supabase: `qmpskuawmubxjoyoqdhu`)

| Table | Purpose |
|---|---|
| `receipts` | Core receipt data: vendor, amount, date, category, type, photo_url, client_id, trip_id, payment_method, notes |
| `clients_receipt` | Client entities for tagging |
| `trips` | Trip entities for grouping receipts |
| `sr_accounts` | User accounts with plan info |

**Storage bucket:** `receipts`
**Path pattern:** `receipts/{user_id}/{timestamp}.ext` — always user-scoped

**Pre-created seed users (do not delete):**
- `admin@fiorsaoirse.com` — Pro plan
- `erinnkate@aol.com` — Free plan (primary live user)
- `mcdonald1313@gmail.com` — Free plan

---

## 6. Critical Rules & Conventions

### 🔴 Never Do This
- **Never touch `supabase-migration.sql`** — deprecated, use `snapreceipt-complete-setup.sql` only
- **Never run schema changes directly against the live Supabase project** without explicit user approval — use the SQL editor at `qmpskuawmubxjoyoqdhu.supabase.co`
- **Never add Fiorsaoirse branding to the UI** — this product is independently branded as "SnapReceipt"
- **Never share or reference the SnapReceipt Supabase project from any other product**
- **Never introduce a build step or framework** — this is intentionally plain HTML/CSS/JS, published from root
- **Never activate RLS policies** until the `user_id` column has been migrated from string → UUID (this migration is pending and intentionally deferred)
- **Never delete or modify seed users** (`erinnkate@aol.com` is a live user)

### 🟡 Important Conventions
- `APP_CONFIG.currentUser` in `app.js` is the **single source of truth** for user context — all user-scoped logic flows from here
- `app.js` is a monolith by design — do not split it unless explicitly asked
- The Service Worker (`sw.js`) skips all Supabase and Anthropic API calls — do not cache those routes
- Netlify Function proxy handles the Claude API call — never call the Anthropic API directly from the client
- Pricing is $9.95/mo — reference `Fiorsaoirse-Brain/Decisions/pricing-models.md` for canonical pricing decisions

### 🟢 Work Style (from global conventions)
- **Direct action:** "Fix it" or "handle it" = use APIs via Claude Code MCP. Do not suggest manual steps unless the task truly requires dashboard-only access (Stripe UI, Supabase SQL editor).
- **End every session** with a changelog saved to `C:\Users\gurum\Fiorsaoirse-Brain\SnapReceipt\`
- Changelog format: what file changed, what changed, what was deployed, what was tested, open bugs/blockers

---

## 7. Intentionally Deferred (Do Not Implement Without Being Asked)

- Subscription gating UI — Stripe integration exists, UI enforcement does not
- Multi-user public signup flow
- RLS policy activation (blocked on user_id UUID migration)
- Marketing page on fiorsaoirse.com (product is listed there as "Live" but no dedicated landing page)

---

## 8. MCP Servers Available

| Server | Endpoint / Notes |
|---|---|
| GitHub | `admin625` org |
| n8n Cloud | `jmac.app.n8n.cloud` |
| Supabase | `qmpskuawmubxjoyoqdhu.supabase.co` — use SQL editor or HTTP requests for DB work |

---

## 9. Session Changelog

<!-- Append a new entry after every session. Do not delete old entries. -->

| Date | Files Changed | What Changed | Deployed | Tested | Open Issues |
|---|---|---|---|---|---|
| 2026-03-19 | `CLAUDE.md` | Created this file | No | No | None |
