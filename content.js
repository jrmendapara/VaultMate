// VaultMate Content Script — Auto-fill & Form Detection

(function () {
  'use strict';

  let fillOverlay = null;

  function findLoginForm() {
    const pwFields = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter(el => el.offsetParent !== null);
    if (!pwFields.length) return null;

    const pwField = pwFields[0];
    // Find closest username/user-id/email field before password field
    let userField = null;
    const allInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="password"])'
    )).filter(el => el.offsetParent !== null);

    const scored = allInputs.map((el, idx) => {
      const key = `${(el.name || '')} ${(el.id || '')} ${(el.placeholder || '')} ${(el.autocomplete || '')}`.toLowerCase();
      let score = 0;
      if (/user|userid|user-id|login|email|account|member|customer|client/.test(key)) score += 5;
      if (el.type === 'email' || (el.autocomplete || '').includes('username')) score += 4;
      if (el.form && pwField.form && el.form === pwField.form) score += 2;
      const pos = (el.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) ? 1 : 0;
      return { el, idx, score, beforePw: pos === 1 };
    }).filter(x => x.beforePw);

    scored.sort((a, b) => (b.score - a.score) || (b.idx - a.idx));
    userField = scored[0]?.el || null;

    return { userField, pwField };
  }

  function fillForm(username, password) {
    const form = findLoginForm();
    if (!form) return false;

    const { userField, pwField } = form;

    function setNativeValue(el, value) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      ).set;
      nativeInputValueSetter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (userField && username) setNativeValue(userField, username);
    if (pwField && password) setNativeValue(pwField, password);
    return true;
  }

  function showAutofillPicker(credentials) {
    removePicker();

    const overlay = document.createElement('div');
    overlay.id = 'vaultmate-autofill-picker';
    overlay.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 2147483647;
      background: #1e1e2e; border: 1px solid #6366f1; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); padding: 12px; min-width: 260px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #fff; font-size: 13px;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    header.innerHTML = `
      <span style="font-weight:600;color:#a5b4fc;">🔑 VaultMate Auto-fill</span>
      <span id="vm-close" style="cursor:pointer;color:#6b7280;font-size:16px;padding:0 4px;">✕</span>
    `;
    overlay.appendChild(header);


    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'margin-bottom:10px;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search saved logins…';
    searchInput.style.cssText = 'width:100%;padding:7px 9px;border-radius:8px;border:1px solid #374151;background:#111827;color:#e5e7eb;font-size:12px;outline:none;';
    searchWrap.appendChild(searchInput);
    overlay.appendChild(searchWrap);

    if (!credentials.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#9ca3af;padding:8px 0;text-align:center;';
      empty.textContent = 'No saved passwords for this site';
      overlay.appendChild(empty);
    } else {
      const renderItems = (filterText = '') => {
        const q = String(filterText || '').toLowerCase();
        overlay.querySelectorAll('.vm-cred-item').forEach(x => x.remove());
        credentials.filter(cred => !q || `${cred.username} ${cred.site} ${cred.clientName || ''}`.toLowerCase().includes(q)).forEach(cred => {
        const displayName = (cred.clientName || '').trim() || cred.username;
        const item = document.createElement('div');
        item.style.cssText = `
          display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
          cursor:pointer;transition:background 0.15s;margin-bottom:4px;
          background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);
        `;
        item.innerHTML = `
          <div style="flex:1;overflow:hidden;">
            <div style="font-weight:500;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(displayName)}</div>
            <div style="color:#6b7280;font-size:11px;">${escHtml(cred.site)}</div>
          </div>
          <div style="color:#6366f1;font-size:11px;white-space:nowrap;">Click to fill</div>
        `;
        item.onmouseenter = () => item.style.background = 'rgba(99,102,241,0.25)';
        item.onmouseleave = () => item.style.background = 'rgba(99,102,241,0.1)';
        item.onclick = () => {
          fillForm(cred.username, cred.password);
          removePicker();
        };
        item.className = 'vm-cred-item';
        overlay.appendChild(item);
        });
      };
      renderItems();
      searchInput.addEventListener('input', (e) => renderItems(e.target.value));
    }

    document.body.appendChild(overlay);
    fillOverlay = overlay;

    overlay.querySelector('#vm-close').onclick = removePicker;
    setTimeout(removePicker, 15000); // Auto-dismiss after 15s
  }

  function removePicker() {
    const el = document.getElementById('vaultmate-autofill-picker');
    if (el) el.remove();
    fillOverlay = null;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getDomain() {
    return window.location.hostname.replace(/^www\./, '');
  }

  // Listen for messages from background/popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'TRIGGER_AUTOFILL') {
      const domain = getDomain();
      chrome.runtime.sendMessage(
        { action: 'GET_CREDENTIALS_FOR_SITE', domain },
        (resp) => {
          if (resp?.credentials) {
            if (resp.credentials.length === 1) {
              fillForm(resp.credentials[0].username, resp.credentials[0].password);
            } else {
              showAutofillPicker(resp.credentials);
            }
          } else {
            showAutofillPicker([]);
          }
        }
      );
    }

    if (msg.action === 'DO_FILL') {
      const ok = fillForm(msg.username, msg.password);
      sendResponse({ success: ok });
    }

    if (msg.action === 'SHOW_PICKER') {
      showAutofillPicker(msg.credentials || []);
    }

    if (msg.action === 'GET_DOMAIN') {
      sendResponse({ domain: getDomain(), url: window.location.href });
    }
  });

  // Keep autofill picker manual-only (popup/context menu/keyboard shortcut).
  // Do not auto-open when password fields receive focus.
})();
