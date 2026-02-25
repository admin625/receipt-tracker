// ============================================================
// SnapReceipt — PWA with Supabase Auth
// ============================================================

// --- App Config ---
const APP_CONFIG = {
  appName: 'SnapReceipt',
  brandColor: '#7c3aed',
  maxFileSize: 25 * 1024 * 1024, // 25MB
  retentionMonths: 18,
};

// --- Supabase Configuration (dedicated SnapReceipt project) ---
const SUPABASE_URL = 'https://qmpskuawmubxjoyoqdhu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtcHNrdWF3bXVieGpveW9xZGh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NTI3NjUsImV4cCI6MjA4NzUyODc2NX0.j7dHJXdzEnyfKvbwFb8fp_favBeMIAAykNQqC11j6Qw';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Auth State ---
let currentAuthUser = null; // { id: uuid, email: string }

// --- API Config (Anthropic key still user-configured) ---
function getConfig() {
  return {
    anthropicKey: localStorage.getItem('cfg_anthropic_key') || '',
  };
}

// --- Supabase REST helpers (now uses auth token for RLS) ---
async function getAuthToken() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || SUPABASE_ANON_KEY;
}

async function supaFetch(path, opts = {}) {
  const token = await getAuthToken();
  const url = SUPABASE_URL + path;
  return fetch(url, {
    ...opts,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation',
      ...opts.headers,
    },
  }).then(async (r) => {
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Supabase ${r.status}: ${body}`);
    }
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  });
}

async function supaStorage(path, file, contentType) {
  const token = await getAuthToken();
  const url = SUPABASE_URL + '/storage/v1/object/receipts/' + path;
  return fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: file,
  }).then(async (r) => {
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Storage ${r.status}: ${body}`);
    }
    return r.json();
  });
}

function getPublicUrl(path) {
  return SUPABASE_URL + '/storage/v1/object/public/receipts/' + path;
}

// --- State ---
let allReceipts = [];
let allClients = [];
let allTrips = [];
let paymentMethods = JSON.parse(localStorage.getItem('payment_methods') || '["Cash","Credit Card","Debit Card"]');
let currentType = 'all';
let currentFilters = {};
let summaryPeriod = 'month';
let currentReceiptId = null;
let currentPhotoBlob = null;
let currentPhotoBase64 = null;
let pageHistory = [];
let formType = 'personal';

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ============================================================
// AUTH: Login, Logout, Session Management
// ============================================================

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const loginBtn = document.getElementById('loginBtn');
  const errorEl = document.getElementById('loginError');

  errorEl.classList.add('hidden');
  loginBtn.disabled = true;
  loginBtn.textContent = 'Signing in...';

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    errorEl.textContent = error.message;
    errorEl.classList.remove('hidden');
    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';
    return;
  }

  // Auth state change listener will handle showing the app
}

async function handleSignOut() {
  await supabaseClient.auth.signOut();
  currentAuthUser = null;
  allReceipts = [];
  allClients = [];
  allTrips = [];
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.add('hidden');
}

function showApp(user) {
  currentAuthUser = { id: user.id, email: user.email };
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  loadConfig();
  loadData();
}

// --- Init: Check session on page load ---
document.addEventListener('DOMContentLoaded', async () => {
  // Listen for auth state changes (login, logout, token refresh, password recovery)
  supabaseClient.auth.onAuthStateChange((event, session) => {
    console.log('[Auth] onAuthStateChange:', event);
    if (event === 'PASSWORD_RECOVERY') {
      console.log('[Auth] PASSWORD_RECOVERY event — showing reset form');
      showResetScreen();
      return;
    }
    if (event === 'SIGNED_IN' && session?.user) {
      // Don't redirect to app if user is on reset screen
      if (document.getElementById('resetScreen').style.display !== 'none') {
        console.log('[Auth] On reset screen, skipping app redirect');
        return;
      }
      showApp(session.user);
    } else if (event === 'SIGNED_OUT') {
      currentAuthUser = null;
      document.getElementById('appShell').style.display = 'none';
      document.getElementById('loginScreen').style.display = 'flex';
    }
  });

  // Check for existing session
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    showApp(session.user);
  } else {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appShell').style.display = 'none';
  }

  // Wire up forgot password link
  document.getElementById('forgotPasswordLink').addEventListener('click', (e) => {
    e.preventDefault();
    showForgotScreen();
  });
  document.getElementById('backToLoginFromForgot').addEventListener('click', (e) => {
    e.preventDefault();
    showLoginScreen();
  });
});

// ============================================================
// CONFIG (Anthropic key only — Supabase is now hardcoded)
// ============================================================

function loadConfig() {
  const cfg = getConfig();
  document.getElementById('cfgAnthropicKey').value = cfg.anthropicKey;
}

function saveConfig() {
  localStorage.setItem('cfg_anthropic_key', document.getElementById('cfgAnthropicKey').value.trim());
  toast('Configuration saved');
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadData() {
  if (!currentAuthUser) return;

  try {
    const uid = currentAuthUser.id;
    const [receipts, clients, trips] = await Promise.all([
      supaFetch(`/rest/v1/receipts?select=*,clients_receipt(name),trips(name)&user_id=eq.${uid}&order=receipt_date.desc.nullsfirst,created_at.desc`),
      supaFetch(`/rest/v1/clients_receipt?select=*&user_id=eq.${uid}&order=name`),
      supaFetch(`/rest/v1/trips?select=*&user_id=eq.${uid}&order=created_at.desc`),
    ]);
    allReceipts = receipts || [];
    allClients = clients || [];
    allTrips = trips || [];
    renderReceiptList();
    populateDropdowns();
  } catch (e) {
    console.error('Load error:', e);
  }
}

// --- Navigation ---
function showPage(id) {
  if (!currentAuthUser) return; // guard

  const prev = document.querySelector('.page.active');
  if (prev) pageHistory.push(prev.id);
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.page === id);
  });

  // Back button
  const backBtn = document.getElementById('backBtn');
  backBtn.classList.toggle('visible', id === 'pageDetail');

  // Header title
  const titles = {
    pageDashboard: APP_CONFIG.appName,
    pageScan: 'Scan Receipt',
    pageSummary: 'Summary',
    pageSettings: 'Settings',
    pageDetail: 'Receipt Detail',
  };
  document.getElementById('headerTitle').textContent = titles[id] || APP_CONFIG.appName;

  // FAB visibility
  document.getElementById('scanFab').style.display = id === 'pageDashboard' ? 'flex' : 'none';

  // Load summary when switching to that tab
  if (id === 'pageSummary') renderSummary();

  // Reset scan page
  if (id === 'pageScan') resetScanForm();
}

function goBack() {
  const prev = pageHistory.pop();
  if (prev) {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.getElementById(prev).classList.add('active');
    document.querySelectorAll('.nav-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.page === prev);
    });
    document.getElementById('backBtn').classList.remove('visible');
    document.getElementById('headerTitle').textContent = APP_CONFIG.appName;
    document.getElementById('scanFab').style.display = prev === 'pageDashboard' ? 'flex' : 'none';
  }
}

// --- Receipt List ---
function renderReceiptList() {
  const list = document.getElementById('receiptList');
  let filtered = applyAllFilters(allReceipts);

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>
        <h3>No receipts yet</h3>
        <p>Tap the + button to scan your first receipt</p>
      </div>`;
    return;
  }

  list.innerHTML = filtered
    .map((r) => {
      const clientName = r.clients_receipt?.name || '';
      const tripName = r.trips?.name || '';
      const meta = [formatDate(r.receipt_date), clientName, tripName].filter(Boolean).join(' · ');
      return `
      <div class="receipt-item" onclick="showDetail('${r.id}')">
        <img class="receipt-thumb" src="${r.photo_url || ''}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="receipt-info">
          <div class="receipt-vendor">${esc(r.vendor || 'Unknown')}</div>
          <div class="receipt-meta">${esc(meta)}</div>
        </div>
        <div>
          <div class="receipt-amount">$${num(r.amount)}</div>
          <span class="badge badge-${r.type}">${r.type}</span>
        </div>
      </div>`;
    })
    .join('');
}

function applyAllFilters(receipts) {
  let result = receipts;
  const search = document.getElementById('searchInput')?.value?.toLowerCase() || '';

  if (currentType !== 'all') {
    result = result.filter((r) => r.type === currentType);
  }
  if (search) {
    result = result.filter(
      (r) =>
        (r.vendor || '').toLowerCase().includes(search) ||
        (r.notes || '').toLowerCase().includes(search) ||
        (r.clients_receipt?.name || '').toLowerCase().includes(search) ||
        (r.trips?.name || '').toLowerCase().includes(search)
    );
  }
  if (currentFilters.dateFrom) {
    result = result.filter((r) => r.receipt_date >= currentFilters.dateFrom);
  }
  if (currentFilters.dateTo) {
    result = result.filter((r) => r.receipt_date <= currentFilters.dateTo);
  }
  if (currentFilters.category) {
    result = result.filter((r) => r.category === currentFilters.category);
  }
  if (currentFilters.clientId) {
    result = result.filter((r) => r.client_id === currentFilters.clientId);
  }
  if (currentFilters.tripId) {
    result = result.filter((r) => r.trip_id === currentFilters.tripId);
  }
  if (currentFilters.payment) {
    result = result.filter((r) => r.payment_method === currentFilters.payment);
  }
  return result;
}

function setTypeFilter(type, el) {
  currentType = type;
  document.querySelectorAll('#typeFilter .filter-chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  renderReceiptList();
}

function filterReceipts() {
  renderReceiptList();
}

// --- Filter Modal ---
function showFilterModal() {
  populateFilterDropdowns();
  document.getElementById('filterModal').classList.remove('hidden');
}

function closeFilterModal() {
  document.getElementById('filterModal').classList.add('hidden');
}

function populateFilterDropdowns() {
  const clientSel = document.getElementById('filterClient');
  clientSel.innerHTML = '<option value="">All clients</option>' +
    allClients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const tripSel = document.getElementById('filterTrip');
  tripSel.innerHTML = '<option value="">All trips</option>' +
    allTrips.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  const paySel = document.getElementById('filterPayment');
  paySel.innerHTML = '<option value="">All methods</option>' +
    paymentMethods.map((p) => `<option>${esc(p)}</option>`).join('');
}

function applyFilters() {
  currentFilters = {
    dateFrom: document.getElementById('filterDateFrom').value || null,
    dateTo: document.getElementById('filterDateTo').value || null,
    category: document.getElementById('filterCategory').value || null,
    clientId: document.getElementById('filterClient').value || null,
    tripId: document.getElementById('filterTrip').value || null,
    payment: document.getElementById('filterPayment').value || null,
  };
  closeFilterModal();
  renderReceiptList();
}

function clearFilters() {
  document.getElementById('filterDateFrom').value = '';
  document.getElementById('filterDateTo').value = '';
  document.getElementById('filterCategory').value = '';
  document.getElementById('filterClient').value = '';
  document.getElementById('filterTrip').value = '';
  document.getElementById('filterPayment').value = '';
  currentFilters = {};
  closeFilterModal();
  renderReceiptList();
}

// --- Detail View ---
function showDetail(id) {
  const r = allReceipts.find((x) => x.id === id);
  if (!r) return;
  currentReceiptId = id;

  document.getElementById('detailPhoto').src = r.photo_url || '';
  const fields = [
    ['Vendor', r.vendor],
    ['Amount', r.amount != null ? '$' + num(r.amount) : ''],
    ['Date', formatDate(r.receipt_date)],
    ['Type', r.type],
    ['Category', r.category],
    ['Client', r.clients_receipt?.name],
    ['Trip', r.trips?.name],
    ['Payment', r.payment_method],
    ['Notes', r.notes],
  ];
  document.getElementById('detailFields').innerHTML = fields
    .filter(([, v]) => v)
    .map(([l, v]) => `<div class="detail-row"><span class="detail-label">${l}</span><span class="detail-value">${esc(String(v))}</span></div>`)
    .join('');

  showPage('pageDetail');
}

async function deleteReceipt() {
  if (!currentReceiptId || !currentAuthUser) return;
  if (!confirm('Delete this receipt?')) return;
  try {
    showLoading('Deleting...');
    await supaFetch(`/rest/v1/receipts?id=eq.${currentReceiptId}&user_id=eq.${currentAuthUser.id}`, { method: 'DELETE' });
    allReceipts = allReceipts.filter((r) => r.id !== currentReceiptId);
    hideLoading();
    toast('Receipt deleted');
    goBack();
    renderReceiptList();
  } catch (e) {
    hideLoading();
    toast('Error: ' + e.message);
  }
}

function editReceipt() {
  const r = allReceipts.find((x) => x.id === currentReceiptId);
  if (!r) return;

  showPage('pageScan');
  document.getElementById('scanPrompt').style.display = 'none';
  document.getElementById('receiptForm').style.display = 'block';
  document.getElementById('photoPreview').src = r.photo_url || '';
  document.getElementById('fVendor').value = r.vendor || '';
  document.getElementById('fAmount').value = r.amount || '';
  document.getElementById('fDate').value = r.receipt_date || '';
  document.getElementById('fCategory').value = r.category || '';
  document.getElementById('fNotes').value = r.notes || '';
  document.getElementById('fPayment').value = r.payment_method || '';

  formType = r.type || 'personal';
  document.querySelectorAll('.toggle-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === formType);
  });
  document.getElementById('businessFields').style.display = formType === 'business' ? 'block' : 'none';

  if (r.client_id) document.getElementById('fClient').value = r.client_id;
  if (r.trip_id) document.getElementById('fTrip').value = r.trip_id;

  // Mark as editing
  document.getElementById('saveBtn').textContent = 'Update Receipt';
  document.getElementById('saveBtn').onclick = () => updateReceipt(r.id);
}

async function updateReceipt(id) {
  const data = gatherFormData();
  try {
    showLoading('Updating...');
    const [updated] = await supaFetch(`/rest/v1/receipts?id=eq.${id}&user_id=eq.${currentAuthUser.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
    });
    hideLoading();
    toast('Receipt updated');
    await loadData();
    showPage('pageDashboard');
  } catch (e) {
    hideLoading();
    toast('Error: ' + e.message);
  }
}

// --- Camera / Photo ---
async function handlePhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  currentPhotoBlob = file;

  // Show preview and form
  const url = URL.createObjectURL(file);
  document.getElementById('photoPreview').src = url;
  document.getElementById('scanPrompt').style.display = 'none';
  document.getElementById('receiptForm').style.display = 'block';
  document.getElementById('saveBtn').textContent = 'Save Receipt';
  document.getElementById('saveBtn').onclick = saveReceipt;

  // Set today's date as default
  document.getElementById('fDate').value = new Date().toISOString().split('T')[0];

  // Convert to base64 for OCR
  const reader = new FileReader();
  reader.onload = () => {
    currentPhotoBase64 = reader.result.split(',')[1];
    runOCR();
  };
  reader.readAsDataURL(file);
}

async function runOCR() {
  const cfg = getConfig();
  if (!cfg.anthropicKey) return;

  const ocrStatus = document.getElementById('ocrStatus');
  ocrStatus.style.display = 'block';

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: currentPhotoBlob.type || 'image/jpeg', data: currentPhotoBase64 },
              },
              {
                type: 'text',
                text: 'Extract the following from this receipt image: vendor/store name, total amount (just the number), date (YYYY-MM-DD format), and payment method if visible. Return as JSON: {"vendor", "amount", "date", "payment_method"}. If any field is not readable, return null for that field. Return ONLY the JSON object, no other text.',
              },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) throw new Error(`API ${resp.status}`);
    const result = await resp.json();
    const text = result.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (data.vendor) document.getElementById('fVendor').value = data.vendor;
      if (data.amount) document.getElementById('fAmount').value = parseFloat(data.amount);
      if (data.date) document.getElementById('fDate').value = data.date;
      if (data.payment_method) {
        // Try to match existing payment method or add it
        const existing = paymentMethods.find((p) => p.toLowerCase().includes(data.payment_method.toLowerCase()));
        if (existing) {
          document.getElementById('fPayment').value = existing;
        }
      }
      toast('Receipt data extracted');
    }
  } catch (e) {
    console.error('OCR error:', e);
    toast('OCR failed — fill in manually');
  } finally {
    ocrStatus.style.display = 'none';
  }
}

// --- Save Receipt ---
function gatherFormData() {
  return {
    vendor: document.getElementById('fVendor').value.trim() || null,
    amount: parseFloat(document.getElementById('fAmount').value) || null,
    receipt_date: document.getElementById('fDate').value || null,
    type: formType,
    category: document.getElementById('fCategory').value || null,
    client_id: formType === 'business' ? document.getElementById('fClient').value || null : null,
    trip_id: formType === 'business' ? document.getElementById('fTrip').value || null : null,
    payment_method: document.getElementById('fPayment').value || null,
    notes: document.getElementById('fNotes').value.trim() || null,
  };
}

async function saveReceipt() {
  if (!currentAuthUser) return;
  const data = gatherFormData();

  try {
    showLoading('Saving receipt...');

    // Upload photo
    let photoUrl = '';
    if (currentPhotoBlob) {
      if (currentPhotoBlob.size > APP_CONFIG.maxFileSize) {
        throw new Error(`File too large (max ${APP_CONFIG.maxFileSize / 1024 / 1024}MB)`);
      }
      const ext = currentPhotoBlob.name?.split('.').pop() || 'jpg';
      const path = `${currentAuthUser.id}/${Date.now()}.${ext}`;
      await supaStorage(path, currentPhotoBlob, currentPhotoBlob.type || 'image/jpeg');
      photoUrl = getPublicUrl(path);
    }

    // Save receipt
    await supaFetch('/rest/v1/receipts', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        user_id: currentAuthUser.id,
        photo_url: photoUrl,
        ocr_raw: currentPhotoBase64 ? { processed: true } : null,
      }),
    });

    hideLoading();
    toast('Receipt saved!');
    resetScanForm();
    await loadData();
    showPage('pageDashboard');
  } catch (e) {
    hideLoading();
    toast('Error: ' + e.message);
  }
}

function resetScanForm() {
  document.getElementById('scanPrompt').style.display = 'flex';
  document.getElementById('receiptForm').style.display = 'none';
  document.getElementById('fVendor').value = '';
  document.getElementById('fAmount').value = '';
  document.getElementById('fDate').value = '';
  document.getElementById('fCategory').value = '';
  document.getElementById('fClient').value = '';
  document.getElementById('fTrip').value = '';
  document.getElementById('fPayment').value = '';
  document.getElementById('fNotes').value = '';
  document.getElementById('cameraInput').value = '';
  document.getElementById('fileInput').value = '';
  currentPhotoBlob = null;
  currentPhotoBase64 = null;
  formType = 'personal';
  document.querySelectorAll('.toggle-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.val === 'personal');
  });
  document.getElementById('businessFields').style.display = 'none';
  document.getElementById('saveBtn').textContent = 'Save Receipt';
  document.getElementById('saveBtn').onclick = saveReceipt;
}

function cancelScan() {
  resetScanForm();
  showPage('pageDashboard');
}

function setFormType(type, el) {
  formType = type;
  document.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('businessFields').style.display = type === 'business' ? 'block' : 'none';
}

// --- Dropdowns ---
function populateDropdowns() {
  const clientSel = document.getElementById('fClient');
  clientSel.innerHTML = '<option value="">No client</option>' +
    allClients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  const tripSel = document.getElementById('fTrip');
  tripSel.innerHTML = '<option value="">No trip</option>' +
    allTrips.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

  const paySel = document.getElementById('fPayment');
  paySel.innerHTML = '<option value="">Select payment...</option>' +
    paymentMethods.map((p) => `<option>${esc(p)}</option>`).join('');
}

function toggleInlineAdd(id) {
  const row = document.getElementById(id);
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
}

async function saveNewClient() {
  if (!currentAuthUser) return;
  const name = document.getElementById('newClientName').value.trim();
  if (!name) return;
  try {
    const [client] = await supaFetch('/rest/v1/clients_receipt', {
      method: 'POST',
      body: JSON.stringify({ name, user_id: currentAuthUser.id }),
    });
    allClients.push(client);
    populateDropdowns();
    document.getElementById('fClient').value = client.id;
    document.getElementById('newClientName').value = '';
    document.getElementById('addClientRow').style.display = 'none';
    toast('Client added');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

async function saveNewTrip() {
  if (!currentAuthUser) return;
  const name = document.getElementById('newTripName').value.trim();
  if (!name) return;
  try {
    const [trip] = await supaFetch('/rest/v1/trips', {
      method: 'POST',
      body: JSON.stringify({ name, user_id: currentAuthUser.id }),
    });
    allTrips.push(trip);
    populateDropdowns();
    document.getElementById('fTrip').value = trip.id;
    document.getElementById('newTripName').value = '';
    document.getElementById('addTripRow').style.display = 'none';
    toast('Trip added');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

function saveNewPayment() {
  const name = document.getElementById('newPaymentName').value.trim();
  if (!name) return;
  paymentMethods.push(name);
  localStorage.setItem('payment_methods', JSON.stringify(paymentMethods));
  populateDropdowns();
  document.getElementById('fPayment').value = name;
  document.getElementById('newPaymentName').value = '';
  document.getElementById('addPaymentRow').style.display = 'none';
  toast('Payment method added');
}

// --- Summary ---
function setSummaryPeriod(period, el) {
  summaryPeriod = period;
  document.querySelectorAll('.period-tab').forEach((t) => t.classList.remove('active'));
  el.classList.add('active');
  renderSummary();
}

function renderSummary() {
  const now = new Date();
  let filtered = allReceipts;

  if (summaryPeriod === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    filtered = filtered.filter((r) => r.receipt_date >= start);
  } else if (summaryPeriod === 'quarter') {
    const qMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), qMonth, 1).toISOString().split('T')[0];
    filtered = filtered.filter((r) => r.receipt_date >= start);
  } else if (summaryPeriod === 'year') {
    const start = `${now.getFullYear()}-01-01`;
    filtered = filtered.filter((r) => r.receipt_date >= start);
  }

  const total = filtered.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const biz = filtered.filter((r) => r.type === 'business');
  const pers = filtered.filter((r) => r.type === 'personal');
  const bizTotal = biz.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  const persTotal = pers.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  document.getElementById('summaryStats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Total</div><div class="stat-value purple">$${num(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Receipts</div><div class="stat-value">${filtered.length}</div></div>
    <div class="stat-card"><div class="stat-label">Business</div><div class="stat-value">$${num(bizTotal)}</div></div>
    <div class="stat-card"><div class="stat-label">Personal</div><div class="stat-value">$${num(persTotal)}</div></div>
  `;

  // Category breakdown
  const cats = {};
  filtered.forEach((r) => {
    const cat = r.category || 'Uncategorized';
    cats[cat] = (cats[cat] || 0) + (parseFloat(r.amount) || 0);
  });
  const maxCat = Math.max(...Object.values(cats), 1);
  document.getElementById('categoryBreakdown').innerHTML = Object.entries(cats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="breakdown-item">
        <div style="flex:1">
          <div class="breakdown-label">${esc(k)}</div>
          <div class="breakdown-bar"><div class="breakdown-fill" style="width:${(v / maxCat) * 100}%"></div></div>
        </div>
        <div class="breakdown-value">$${num(v)}</div>
      </div>`)
    .join('') || '<p style="color:var(--text-muted);font-size:14px">No data</p>';

  // Client breakdown
  const clients = {};
  filtered.filter((r) => r.clients_receipt?.name).forEach((r) => {
    const name = r.clients_receipt.name;
    clients[name] = (clients[name] || 0) + (parseFloat(r.amount) || 0);
  });
  document.getElementById('clientBreakdown').innerHTML = Object.entries(clients)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="breakdown-item">
        <div class="breakdown-label">${esc(k)}</div>
        <div class="breakdown-value">$${num(v)}</div>
      </div>`)
    .join('') || '<p style="color:var(--text-muted);font-size:14px">No client data</p>';

  // Trip breakdown
  const trips = {};
  filtered.filter((r) => r.trips?.name).forEach((r) => {
    const name = r.trips.name;
    trips[name] = (trips[name] || 0) + (parseFloat(r.amount) || 0);
  });
  document.getElementById('tripBreakdown').innerHTML = Object.entries(trips)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div class="breakdown-item">
        <div class="breakdown-label">${esc(k)}</div>
        <div class="breakdown-value">$${num(v)}</div>
      </div>`)
    .join('') || '<p style="color:var(--text-muted);font-size:14px">No trip data</p>';
}

// --- CSV Export ---
function exportCSV() {
  const filtered = applyAllFilters(allReceipts);
  if (filtered.length === 0) {
    toast('No receipts to export');
    return;
  }

  const headers = ['Date', 'Vendor', 'Amount', 'Type', 'Category', 'Client', 'Trip', 'Payment Method', 'Notes'];
  const rows = filtered.map((r) => [
    r.receipt_date || '',
    csvEsc(r.vendor || ''),
    r.amount || '',
    r.type || '',
    csvEsc(r.category || ''),
    csvEsc(r.clients_receipt?.name || ''),
    csvEsc(r.trips?.name || ''),
    csvEsc(r.payment_method || ''),
    csvEsc(r.notes || ''),
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapreceipt-export-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

function csvEsc(str) {
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// --- Manage (clients, trips, payment methods) ---
function manageClients() {
  document.getElementById('manageTitle').textContent = 'Clients';
  const list = document.getElementById('manageList');
  list.innerHTML = allClients.map((c) => `
    <div class="settings-item">
      <span>${esc(c.name)}</span>
      <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">Delete</button>
    </div>`).join('') || '<p style="color:var(--text-muted)">No clients yet</p>';
  document.getElementById('manageModal').classList.remove('hidden');
}

function manageTrips() {
  document.getElementById('manageTitle').textContent = 'Trips';
  const list = document.getElementById('manageList');
  list.innerHTML = allTrips.map((t) => `
    <div class="settings-item">
      <span>${esc(t.name)}</span>
      <button class="btn btn-sm btn-danger" onclick="deleteTrip('${t.id}')">Delete</button>
    </div>`).join('') || '<p style="color:var(--text-muted)">No trips yet</p>';
  document.getElementById('manageModal').classList.remove('hidden');
}

function managePayments() {
  document.getElementById('manageTitle').textContent = 'Payment Methods';
  const list = document.getElementById('manageList');
  list.innerHTML = paymentMethods.map((p, i) => `
    <div class="settings-item">
      <span>${esc(p)}</span>
      <button class="btn btn-sm btn-danger" onclick="deletePayment(${i})">Delete</button>
    </div>`).join('');
  document.getElementById('manageModal').classList.remove('hidden');
}

function closeManageModal() {
  document.getElementById('manageModal').classList.add('hidden');
}

async function deleteClient(id) {
  if (!confirm('Delete this client?') || !currentAuthUser) return;
  try {
    await supaFetch(`/rest/v1/clients_receipt?id=eq.${id}&user_id=eq.${currentAuthUser.id}`, { method: 'DELETE' });
    allClients = allClients.filter((c) => c.id !== id);
    populateDropdowns();
    manageClients();
    toast('Client deleted');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

async function deleteTrip(id) {
  if (!confirm('Delete this trip?') || !currentAuthUser) return;
  try {
    await supaFetch(`/rest/v1/trips?id=eq.${id}&user_id=eq.${currentAuthUser.id}`, { method: 'DELETE' });
    allTrips = allTrips.filter((t) => t.id !== id);
    populateDropdowns();
    manageTrips();
    toast('Trip deleted');
  } catch (e) {
    toast('Error: ' + e.message);
  }
}

function deletePayment(idx) {
  if (!confirm('Delete this payment method?')) return;
  paymentMethods.splice(idx, 1);
  localStorage.setItem('payment_methods', JSON.stringify(paymentMethods));
  populateDropdowns();
  managePayments();
  toast('Payment method deleted');
}

// --- Utilities ---
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function num(n) {
  return parseFloat(n || 0).toFixed(2);
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function showLoading(text) {
  document.getElementById('loadingText').textContent = text || 'Loading...';
  document.getElementById('loadingOverlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loadingOverlay').classList.add('hidden');
}

function toast(msg) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ============================================================
// PASSWORD RESET FLOW
// ============================================================

function hideAllScreens() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('forgotScreen').style.display = 'none';
  document.getElementById('resetScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
}

function showLoginScreen() {
  hideAllScreens();
  document.getElementById('loginScreen').style.display = 'flex';
}

function showForgotScreen() {
  hideAllScreens();
  document.getElementById('forgotScreen').style.display = 'flex';
  document.getElementById('forgotEmail').value = document.getElementById('loginEmail').value || '';
  document.getElementById('forgotError').classList.add('hidden');
  document.getElementById('forgotSuccess').classList.add('hidden');
  document.getElementById('forgotBtn').disabled = false;
  document.getElementById('forgotBtn').textContent = 'Send Reset Link';
}

function showResetScreen() {
  hideAllScreens();
  document.getElementById('resetScreen').style.display = 'flex';
  document.getElementById('resetNewPassword').value = '';
  document.getElementById('resetConfirmPassword').value = '';
  document.getElementById('resetError').classList.add('hidden');
  document.getElementById('resetSuccess').classList.add('hidden');
  document.getElementById('resetBtn').disabled = false;
  document.getElementById('resetBtn').textContent = 'Update Password';
}

function togglePwVis(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '&#128064;';
  } else {
    input.type = 'password';
    btn.innerHTML = '&#128065;';
  }
}

async function handleForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const btn = document.getElementById('forgotBtn');
  const errEl = document.getElementById('forgotError');
  const successEl = document.getElementById('forgotSuccess');

  errEl.classList.add('hidden');
  successEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://receipt-tracker-fiorsaoirse.netlify.app'
    });
    if (error) {
      errEl.textContent = error.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
      return;
    }
    successEl.textContent = 'Check your email! We sent a password reset link to ' + email;
    successEl.classList.remove('hidden');
    btn.textContent = 'Email Sent';
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Resend Link'; }, 5000);
  } catch (err) {
    errEl.textContent = 'Failed to send reset email: ' + (err.message || 'Unknown error');
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Send Reset Link';
  }
}

async function handleResetPassword(event) {
  event.preventDefault();
  const newPw = document.getElementById('resetNewPassword').value;
  const confirmPw = document.getElementById('resetConfirmPassword').value;
  const btn = document.getElementById('resetBtn');
  const errEl = document.getElementById('resetError');
  const successEl = document.getElementById('resetSuccess');

  errEl.classList.add('hidden');
  successEl.classList.add('hidden');

  if (newPw.length < 8) {
    errEl.textContent = 'Password must be at least 8 characters long.';
    errEl.classList.remove('hidden');
    return;
  }
  if (newPw !== confirmPw) {
    errEl.textContent = 'Passwords do not match.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    const { error } = await supabaseClient.auth.updateUser({ password: newPw });
    if (error) {
      let msg = error.message;
      if (msg.includes('expired') || msg.includes('invalid')) {
        msg = 'This reset link has expired or is invalid. Please request a new one.';
      }
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Update Password';
      return;
    }
    successEl.textContent = 'Password updated successfully! Redirecting to login...';
    successEl.classList.remove('hidden');
    btn.textContent = 'Password Updated';
    setTimeout(async () => {
      await supabaseClient.auth.signOut();
      currentAuthUser = null;
      showLoginScreen();
    }, 2000);
  } catch (err) {
    errEl.textContent = 'Failed to update password: ' + (err.message || 'Unknown error');
    errEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Update Password';
  }
}
