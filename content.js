// VaultMate Content Script — Auto-fill & Form Detection

(function () {
  'use strict';

  let fillOverlay = null;

  function findLoginForm() {
    const pwFields = Array.from(document.querySelectorAll('input[type="password"]'))
      .filter(el => el.offsetParent !== null);
    if (!pwFields.length) return null;

    const pwField = pwFields[0];
    // Find closest username/email field
    let userField = null;
    const allInputs = Array.from(document.querySelectorAll(
      'input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"], input[autocomplete*="username"], input[autocomplete*="email"]'
    )).filter(el => el.offsetParent !== null);

    if (allInputs.length) {
      // Find the closest one before the password field
      userField = allInputs[allInputs.length - 1];
    }

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

    if (!credentials.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#9ca3af;padding:8px 0;text-align:center;';
      empty.textContent = 'No saved passwords for this site';
      overlay.appendChild(empty);
    } else {
      credentials.forEach(cred => {
        const item = document.createElement('div');
        item.style.cssText = `
          display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
          cursor:pointer;transition:background 0.15s;margin-bottom:4px;
          background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);
        `;
        item.innerHTML = `
          <div style="flex:1;overflow:hidden;">
            <div style="font-weight:500;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(cred.username)}</div>
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
        overlay.appendChild(item);
      });
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

  // Detect password fields and show VaultMate hint on focus
  document.addEventListener('focusin', (e) => {
    if (e.target.type === 'password') {
      const domain = getDomain();
      chrome.runtime.sendMessage(
        { action: 'HAS_CREDENTIALS_FOR_SITE', domain },
        (resp) => {
          if (resp?.hasCredentials && !document.getElementById('vaultmate-autofill-picker')) {
            showAutofillPicker(resp.credentials);
          }
        }
      );
    }
  }, true);
})();
