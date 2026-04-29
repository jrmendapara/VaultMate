// VaultMate Popup — Main App Logic

'use strict';

// ── STATE ─────────────────────────────────────────────────────────────────
let masterKey = null;        // CryptoKey (in-memory only)
let vaultEntries = [];       // Decrypted entries for current session
let editingId = null;        // ID of entry being edited
let importBuffer = [];       // Rows parsed from Excel, pending confirmation
let pendingConfirm = null;   // Resolve fn for confirm dialog

const MASTER_PASSWORD_MIN_LENGTH = 8;

// ── SESSION CACHE (for background autofill) ───────────────────────────────
function syncSessionCache() {
  // Push plain-text credentials to session for background autofill
  // Note: session storage is cleared when browser closes
  const slim = vaultEntries.map(({ id, clientName, site, url, username, password, category }) =>
    ({ id, clientName, site, url, username, password, category })
  );
  chrome.runtime.sendMessage({ action: 'VAULT_SESSION_UPDATE', entries: slim });
}

// ── STORAGE HELPERS ───────────────────────────────────────────────────────
async function loadVaultMeta() {
  return new Promise(r => chrome.storage.local.get('vaultMeta', d => r(d.vaultMeta || null)));
}

async function saveVaultMeta(meta) {
  return new Promise(r => chrome.storage.local.set({ vaultMeta: meta }, r));
}

async function loadEncryptedEntries() {
  return new Promise(r => chrome.storage.local.get('encEntries', d => r(d.encEntries || [])));
}

async function saveEncryptedEntries(entries) {
  return new Promise(r => chrome.storage.local.set({ encEntries: entries }, r));
}

async function loadSettings() {
  return new Promise(r => chrome.storage.local.get('vmSettings', d => r(d.vmSettings || {})));
}

async function saveSettings(s) {
  const cur = await loadSettings();
  return new Promise(r => chrome.storage.local.set({ vmSettings: { ...cur, ...s } }, r));
}

// ── ENCRYPTION ────────────────────────────────────────────────────────────
async function encryptEntry(entry) {
  return {
    ...entry,
    password: await CryptoManager.encrypt(entry.password, masterKey),
    username: await CryptoManager.encrypt(entry.username, masterKey),
  };
}

async function decryptEntry(entry) {
  return {
    ...entry,
    password: await CryptoManager.decrypt(entry.password, masterKey),
    username: await CryptoManager.decrypt(entry.username, masterKey),
  };
}

async function encryptAndSaveAll() {
  const encrypted = await Promise.all(vaultEntries.map(encryptEntry));
  await saveEncryptedEntries(encrypted);
}

async function loadAndDecryptAll() {
  const encEntries = await loadEncryptedEntries();
  vaultEntries = await Promise.all(encEntries.map(decryptEntry));
}

// ── UNLOCK / SETUP ────────────────────────────────────────────────────────
async function handleUnlock() {
  const pw = document.getElementById('master-input').value.trim();
  const errEl = document.getElementById('lock-error');
  errEl.classList.add('hidden');

  if (!pw) { showLockError('Please enter your master password.'); return; }

  const meta = await loadVaultMeta();

  if (!meta) {
    // First time setup
    if (pw.length < MASTER_PASSWORD_MIN_LENGTH) { showLockError(`Password must be at least ${MASTER_PASSWORD_MIN_LENGTH} characters.`); return; }
    const salt = await CryptoManager.generateSalt();
    const hash = await CryptoManager.hashPassword(pw, salt);
    await saveVaultMeta({
      salt: CryptoManager.bufToHex(salt),
      hash,
      createdAt: Date.now()
    });
    masterKey = await CryptoManager.deriveKey(pw, salt);
    vaultEntries = [];
    showApp();
  } else {
    const salt = CryptoManager.hexToBuf(meta.salt);
    const hash = await CryptoManager.hashPassword(pw, salt);
    if (hash !== meta.hash) {
      showLockError('Incorrect master password. Please try again.');
      return;
    }
    masterKey = await CryptoManager.deriveKey(pw, salt);
    await loadAndDecryptAll();
    syncSessionCache();
    showApp();
  }
}

function showLockError(msg) {
  const el = document.getElementById('lock-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function checkFirstTime() {
  const meta = await loadVaultMeta();
  if (!meta) {
    document.getElementById('setup-hint').classList.remove('hidden');
    document.getElementById('lock-label').textContent = 'Create Master Password';
  }
}

// ── SHOW / HIDE SCREENS ───────────────────────────────────────────────────
function showApp() {
  document.getElementById('lock-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  renderPasswordList();
  // Fill current tab URL into add form
  chrome.runtime.sendMessage({ action: 'GET_CURRENT_TAB_URL' }, (resp) => {
    if (resp?.url && !resp.url.startsWith('chrome')) {
      document.getElementById('f-url').value = resp.url;
      const domain = new URL(resp.url).hostname.replace(/^www\./, '');
      document.getElementById('f-site').placeholder = domain;
    }
  });
}

function lockVault() {
  masterKey = null;
  vaultEntries = [];
  chrome.runtime.sendMessage({ action: 'VAULT_SESSION_CLEAR' });
  document.getElementById('app-screen').classList.add('hidden');
  document.getElementById('lock-screen').classList.remove('hidden');
  document.getElementById('master-input').value = '';
  document.getElementById('lock-error').classList.add('hidden');
}

// ── UTILS ─────────────────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID();
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function getFaviconLetter(site) {
  return (site || '?').charAt(0).toUpperCase();
}

function categoryColor(cat) {
  const map = { email: '#3b82f6', social: '#8b5cf6', banking: '#22c55e', work: '#f59e0b', other: '#6366f1' };
  return map[cat] || map.other;
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showStatus(id, msg, type = 'success') {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `status-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3500);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    return true;
  }
}

// ── PASSWORD LIST ─────────────────────────────────────────────────────────
function renderPasswordList(filter = '') {
  const list = document.getElementById('password-list');
  const emptyState = document.getElementById('empty-state');
  const q = filter.toLowerCase();

  let entries = vaultEntries.filter(e => {
    const haystack = `${e.site || ''} ${e.username || ''} ${e.clientName || ''}`.toLowerCase();
    return !q || haystack.includes(q);
  });

  if (!entries.length) {
    list.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  list.innerHTML = entries.map(e => `
    <div class="pw-card" data-id="${escHtml(e.id)}">
      <div class="pw-favicon" style="color:${categoryColor(e.category)};background:${categoryColor(e.category)}22;">
        ${escHtml(getFaviconLetter(e.site))}
      </div>
      <div class="pw-info">
        <div class="pw-site">${escHtml(e.clientName ? e.clientName + ' • ' : '')}${escHtml(e.site)}</div>
        <div class="pw-username">${escHtml(e.username)}</div>
        <span class="pw-cat-badge">${escHtml(e.category || 'other')}</span>
      </div>
      <div class="pw-actions">
        <button class="icon-btn" data-action="autofill" data-id="${escHtml(e.id)}" title="Auto-fill">⚡</button>
        <button class="icon-btn" data-action="copy-pw" data-id="${escHtml(e.id)}" title="Copy Password">📋</button>
        <button class="icon-btn" data-action="copy-user" data-id="${escHtml(e.id)}" title="Copy Username">👤</button>
        <button class="icon-btn" data-action="edit" data-id="${escHtml(e.id)}" title="Edit">✏️</button>
        <button class="icon-btn" data-action="delete" data-id="${escHtml(e.id)}" title="Delete">🗑</button>
      </div>
    </div>
  `).join('');
}

// ── CARD ACTIONS ──────────────────────────────────────────────────────────
document.getElementById('password-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const entry = vaultEntries.find(x => x.id === id);
  if (!entry) return;

  const action = btn.dataset.action;

  if (action === 'copy-pw') {
    await copyToClipboard(entry.password);
    btn.textContent = '✅';
    setTimeout(() => btn.textContent = '📋', 1500);
  }

  if (action === 'copy-user') {
    await copyToClipboard(entry.username);
    btn.textContent = '✅';
    setTimeout(() => btn.textContent = '👤', 1500);
  }

  if (action === 'edit') {
    openModal(entry);
  }

  if (action === 'delete') {
    const ok = await showConfirm(`Delete password for "${entry.site}"? This cannot be undone.`);
    if (ok) {
      vaultEntries = vaultEntries.filter(x => x.id !== id);
      await encryptAndSaveAll();
      renderPasswordList(document.getElementById('search-input').value);
    }
  }

  if (action === 'autofill') {
    chrome.runtime.sendMessage({
      action: 'FILL_CREDENTIALS',
      username: entry.username,
      password: entry.password
    });
    window.close();
  }
});

// ── ADD / EDIT MODAL ──────────────────────────────────────────────────────
function openModal(entry = null) {
  editingId = entry?.id || null;
  document.getElementById('modal-title').textContent = entry ? 'Edit Password' : 'Add Password';

  document.getElementById('f-client').value = entry?.clientName || '';
  document.getElementById('f-site').value = entry?.site || '';
  document.getElementById('f-url').value = entry?.url || '';
  document.getElementById('f-username').value = entry?.username || '';
  document.getElementById('f-password').value = entry?.password || '';
  document.getElementById('f-category').value = entry?.category || 'other';
  document.getElementById('f-notes').value = entry?.notes || '';

  // Pre-fill URL if adding new
  if (!entry) {
    const urlInput = document.getElementById('f-url');
    // URL already set on showApp
  }

  updatePwStrength(document.getElementById('f-password').value);
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('f-site').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  editingId = null;
}

async function saveEntry() {
  const site = document.getElementById('f-site').value.trim();
  const url = document.getElementById('f-url').value.trim();
  const username = document.getElementById('f-username').value.trim();
  const password = document.getElementById('f-password').value;
  const category = document.getElementById('f-category').value;
  const notes = document.getElementById('f-notes').value.trim();
  const clientName = document.getElementById('f-client').value.trim();

  if (!site || !username || !password) {
    alert('Site, Username, and Password are required.');
    return;
  }

  const now = Date.now();
  if (editingId) {
    const idx = vaultEntries.findIndex(x => x.id === editingId);
    if (idx >= 0) {
      vaultEntries[idx] = { ...vaultEntries[idx], clientName, site, url, username, password, category: (category || 'other').toLowerCase(), notes, updatedAt: now };
    }
  } else {
    vaultEntries.push({ id: uuid(), clientName, site, url, username, password, category: (category || 'other').toLowerCase(), notes, createdAt: now, updatedAt: now });
  }

  await encryptAndSaveAll();
  syncSessionCache();
  closeModal();
  renderPasswordList(document.getElementById('search-input').value);
}

// ── PASSWORD GENERATOR ────────────────────────────────────────────────────
function generatePassword(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, n => chars[n % chars.length]).join('');
}

function updatePwStrength(pw) {
  const bar = document.getElementById('pw-strength-bar');
  const label = document.getElementById('pw-strength-label');
  if (!pw) { bar.style.width = '0'; label.textContent = ''; return; }

  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;

  const levels = [
    { label: 'Very Weak', color: '#ef4444' },
    { label: 'Weak', color: '#f97316' },
    { label: 'Fair', color: '#f59e0b' },
    { label: 'Good', color: '#84cc16' },
    { label: 'Strong', color: '#22c55e' },
    { label: 'Very Strong', color: '#06b6d4' },
  ];
  const lvl = levels[Math.min(score, 5)];
  bar.style.cssText = `height:3px;border-radius:2px;width:${(score/5)*100}%;background:${lvl.color};transition:all 0.3s;`;
  label.style.color = lvl.color;
  label.textContent = lvl.label;
}

// ── CONFIRM DIALOG ────────────────────────────────────────────────────────
function showConfirm(message) {
  return new Promise(resolve => {
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-overlay').classList.remove('hidden');
    pendingConfirm = resolve;
  });
}

// ── EXCEL EXPORT ──────────────────────────────────────────────────────────

function isXlsxAvailable() {
  return typeof XLSX !== 'undefined';
}

function downloadCsv(filename, rows) {
  const csv = rows
    .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportToExcel() {
  const rows = [
    ['ID', 'Client Name', 'Site', 'URL', 'Username', 'Password', 'Category', 'Notes', 'Created', 'Updated'],
    ...vaultEntries.map(e => [
      e.id, e.clientName || '', e.site, e.url, e.username, e.password, e.category, e.notes,
      e.createdAt ? new Date(e.createdAt).toLocaleDateString() : '',
      e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : ''
    ])
  ];

  if (!isXlsxAvailable()) {
    downloadCsv(`VaultMate_Export_${new Date().toISOString().slice(0,10)}.csv`, rows);
    showStatus('import-status', '⚠️ Excel library missing. Downloaded CSV instead.', 'info');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    {wch:10},{wch:20},{wch:20},{wch:35},{wch:25},{wch:25},{wch:12},{wch:30},{wch:12},{wch:12}
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VaultMate Passwords');
  XLSX.writeFile(wb, `VaultMate_Export_${new Date().toISOString().slice(0,10)}.xlsx`);
}

function downloadTemplate() {
  const rows = [
    ['Client Name', 'Site', 'URL', 'Username', 'Password', 'Category', 'Notes'],
    ['Personal', 'Google', 'https://accounts.google.com', 'user@gmail.com', 'yourpassword', 'email', ''],
    ['Work', 'Facebook', 'https://facebook.com', 'user@email.com', 'yourpassword', 'social', ''],
  ];
  if (!isXlsxAvailable()) {
    downloadCsv('VaultMate_Import_Template.csv', rows);
    showStatus('import-status', '⚠️ Excel library missing. Downloaded CSV template instead.', 'info');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:20},{wch:20},{wch:35},{wch:25},{wch:25},{wch:12},{wch:30}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'VaultMate_Import_Template.xlsx');
}

// ── EXCEL IMPORT ──────────────────────────────────────────────────────────
function handleFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    if (!isXlsxAvailable() && !file.name.toLowerCase().endsWith('.csv')) {
      showStatus('import-status', 'Excel parser not available. Please import CSV or include lib/xlsx.min.js', 'error');
      return;
    }

    let rows;
    if (file.name.toLowerCase().endsWith('.csv') || !isXlsxAvailable()) {
      rows = String(ev.target.result || '')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => line.split(',').map(cell => cell.replace(/^"|"$/g, '').replace(/""/g, '"').trim()));
    } else {
      const wb = XLSX.read(ev.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    }

    if (rows.length < 2) {
      showStatus('import-status', 'File has no data rows.', 'error');
      return;
    }

    // Find header row
    const header = rows[0].map(h => String(h).toLowerCase().trim());
    const getIdx = (...names) => names.map(n => header.indexOf(n)).find(i => i >= 0) ?? -1;

    const clientIdx = getIdx('client name', 'client', 'account');
    const siteIdx = getIdx('site', 'app', 'name');
    const urlIdx = getIdx('url', 'website', 'link');
    const userIdx = getIdx('username', 'user', 'email', 'login');
    const pwIdx = getIdx('password', 'pass', 'pwd');
    const catIdx = getIdx('category', 'cat', 'type');
    const notesIdx = getIdx('notes', 'note', 'remarks');

    if (siteIdx < 0 || userIdx < 0 || pwIdx < 0) {
      showStatus('import-status', 'Required columns not found. Need: Site, Username, Password', 'error');
      return;
    }

    importBuffer = rows.slice(1)
      .filter(r => r[siteIdx] || r[userIdx])
      .map(r => ({
        id: uuid(),
        clientName: String(clientIdx >= 0 ? r[clientIdx] : '').trim(),
        site: String(r[siteIdx] || '').trim(),
        url: String(urlIdx >= 0 ? r[urlIdx] : '').trim(),
        username: String(r[userIdx] || '').trim(),
        password: String(r[pwIdx] || '').trim(),
        category: String(catIdx >= 0 ? r[catIdx] : 'other').trim().toLowerCase() || 'other',
        notes: String(notesIdx >= 0 ? r[notesIdx] : '').trim(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      }));

    const preview = document.getElementById('import-preview');
    preview.innerHTML = `
      <strong>${importBuffer.length} passwords found</strong><br>
      <span style="color:var(--text-muted)">Preview (first 3):</span><br>
      ${importBuffer.slice(0, 3).map(e => `• ${escHtml(e.clientName ? e.clientName + ' / ' : '')}${escHtml(e.site)} — ${escHtml(e.username)}`).join('<br>')}
      ${importBuffer.length > 3 ? `<br><span style="color:var(--text-dim)">…and ${importBuffer.length - 3} more</span>` : ''}
    `;
    preview.classList.remove('hidden');
    document.getElementById('import-confirm-btn').classList.remove('hidden');
  };

  if (file.name.toLowerCase().endsWith('.csv') || !isXlsxAvailable()) reader.readAsText(file);
  else reader.readAsBinaryString(file);
}

async function confirmImport() {
  if (!importBuffer.length) return;

  // Merge: update existing, add new
  let added = 0, updated = 0;
  for (const imp of importBuffer) {
    const existing = vaultEntries.find(
      e => e.site.toLowerCase() === imp.site.toLowerCase() && e.username.toLowerCase() === imp.username.toLowerCase()
    );
    if (existing) {
      Object.assign(existing, { ...imp, id: existing.id });
      updated++;
    } else {
      vaultEntries.push(imp);
      added++;
    }
  }

  await encryptAndSaveAll();
  showStatus('import-status', `✅ Imported: ${added} added, ${updated} updated.`, 'success');
  document.getElementById('import-preview').classList.add('hidden');
  document.getElementById('import-confirm-btn').classList.add('hidden');
  document.getElementById('import-file').value = '';
  importBuffer = [];
}

// ── GOOGLE SHEETS SYNC ────────────────────────────────────────────────────
async function updateSyncUI() {
  const settings = await loadSettings();
  if (settings.sheetId) {
    document.getElementById('sync-disconnected').classList.add('hidden');
    document.getElementById('sync-connected').classList.remove('hidden');
    document.getElementById('sheet-id-display').textContent = settings.sheetId;
    document.getElementById('last-sync-display').textContent = settings.lastSync
      ? new Date(settings.lastSync).toLocaleString()
      : 'Never';
  } else {
    document.getElementById('sync-disconnected').classList.remove('hidden');
    document.getElementById('sync-connected').classList.add('hidden');
  }
}

async function handleSyncConnect() {
  try {
    showStatus('sync-status', '⏳ Connecting to Google…', 'info');
    const token = await SheetsManager.getToken(true);
    const sheetId = await SheetsManager.createSpreadsheet(token);
    await saveSettings({ sheetId });
    await updateSyncUI();
    showStatus('sync-status', '✅ Connected! Sheet created.', 'success');
  } catch (err) {
    showStatus('sync-status', `❌ ${err}`, 'error');
  }
}

async function handleSyncPush() {
  try {
    showStatus('sync-status', '⏳ Pushing to Google Sheets…', 'info');
    const settings = await loadSettings();
    const newId = await SheetsManager.syncToSheets(vaultEntries, settings.sheetId);
    await saveSettings({ sheetId: newId, lastSync: Date.now() });
    await updateSyncUI();
    showStatus('sync-status', `✅ Pushed ${vaultEntries.length} entries to Sheets.`, 'success');
  } catch (err) {
    showStatus('sync-status', `❌ ${err}`, 'error');
  }
}

async function handleSyncPull() {
  try {
    showStatus('sync-status', '⏳ Pulling from Google Sheets…', 'info');
    const settings = await loadSettings();
    const sheetEntries = await SheetsManager.syncFromSheets(settings.sheetId);
    // Merge: sheet wins for conflicts
    const merged = [...vaultEntries];
    for (const se of sheetEntries) {
      const idx = merged.findIndex(x => x.id === se.id);
      if (idx >= 0) merged[idx] = { ...merged[idx], ...se };
      else if (se.id) merged.push({ ...se, updatedAt: Date.now() });
    }
    vaultEntries = merged;
    await encryptAndSaveAll();
    await saveSettings({ lastSync: Date.now() });
    await updateSyncUI();
    renderPasswordList();
    showStatus('sync-status', `✅ Pulled ${sheetEntries.length} entries from Sheets.`, 'success');
  } catch (err) {
    showStatus('sync-status', `❌ ${err}`, 'error');
  }
}

async function handleSyncDisconnect() {
  const ok = await showConfirm('Disconnect Google account? Your local passwords will not be deleted.');
  if (ok) {
    try {
      await SheetsManager.revokeToken();
    } catch {}
    await saveSettings({ sheetId: null, lastSync: null });
    await updateSyncUI();
  }
}

// ── MASTER PASSWORD CHANGE ────────────────────────────────────────────────
async function changeMasterPassword() {
  const p1 = document.getElementById('new-master-1').value;
  const p2 = document.getElementById('new-master-2').value;

  if (p1.length < MASTER_PASSWORD_MIN_LENGTH) { showStatus('master-status', `Minimum ${MASTER_PASSWORD_MIN_LENGTH} characters required.`, 'error'); return; }
  if (p1 !== p2) { showStatus('master-status', 'Passwords do not match.', 'error'); return; }

  const salt = await CryptoManager.generateSalt();
  const hash = await CryptoManager.hashPassword(p1, salt);
  masterKey = await CryptoManager.deriveKey(p1, salt);
  await saveVaultMeta({ salt: CryptoManager.bufToHex(salt), hash, createdAt: Date.now() });
  await encryptAndSaveAll();

  document.getElementById('new-master-1').value = '';
  document.getElementById('new-master-2').value = '';
  showStatus('master-status', '✅ Master password changed successfully.', 'success');
}

// ── BACKGROUND MESSAGE: provide credentials for autofill ─────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'GET_CREDENTIALS_FOR_SITE' || msg.action === 'HAS_CREDENTIALS_FOR_SITE') {
    // Background relays this; popup won't usually receive it
    // But handle if popup is open
    const domain = msg.domain?.toLowerCase();
    const matches = vaultEntries.filter(e =>
      e.site?.toLowerCase().includes(domain) ||
      (e.url && getDomain(e.url).toLowerCase().includes(domain))
    );
    sendResponse({ credentials: matches, hasCredentials: matches.length > 0 });
    return true;
  }
});

// ── EVENT LISTENERS ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkFirstTime();

  // Lock screen
  document.getElementById('unlock-btn').addEventListener('click', handleUnlock);
  document.getElementById('master-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleUnlock();
  });
  document.getElementById('toggle-master-vis').addEventListener('click', () => {
    const inp = document.getElementById('master-input');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // Header
  document.getElementById('lock-btn').addEventListener('click', lockVault);
  document.getElementById('add-btn').addEventListener('click', () => openModal());

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
      if (tab.dataset.tab === 'sync') updateSyncUI();
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    renderPasswordList(e.target.value);
  });

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-save').addEventListener('click', saveEntry);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Password visibility & generator
  document.getElementById('toggle-pw-vis').addEventListener('click', () => {
    const inp = document.getElementById('f-password');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('gen-pw-btn').addEventListener('click', () => {
    const pw = generatePassword();
    document.getElementById('f-password').value = pw;
    document.getElementById('f-password').type = 'text';
    updatePwStrength(pw);
  });
  document.getElementById('f-password').addEventListener('input', (e) => {
    updatePwStrength(e.target.value);
  });

  // Confirm dialog
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.add('hidden');
    if (pendingConfirm) { pendingConfirm(false); pendingConfirm = null; }
  });
  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('confirm-overlay').classList.add('hidden');
    if (pendingConfirm) { pendingConfirm(true); pendingConfirm = null; }
  });

  // Import / Export
  document.getElementById('export-btn').addEventListener('click', exportToExcel);
  document.getElementById('template-btn').addEventListener('click', downloadTemplate);
  document.getElementById('import-file').addEventListener('change', handleFileImport);
  document.getElementById('import-confirm-btn').addEventListener('click', confirmImport);

  // Sync
  document.getElementById('sync-connect-btn').addEventListener('click', handleSyncConnect);
  document.getElementById('sync-push-btn').addEventListener('click', handleSyncPush);
  document.getElementById('sync-pull-btn').addEventListener('click', handleSyncPull);
  document.getElementById('sync-disconnect-btn').addEventListener('click', handleSyncDisconnect);

  // Settings
  document.getElementById('change-master-btn').addEventListener('click', changeMasterPassword);
  document.getElementById('clear-vault-btn').addEventListener('click', async () => {
    const ok = await showConfirm('⚠️ This will permanently delete ALL passwords. Are you absolutely sure?');
    if (ok) {
      vaultEntries = [];
      await encryptAndSaveAll();
      renderPasswordList();
      showStatus('master-status', '✅ Vault cleared.', 'success');
    }
  });
});
