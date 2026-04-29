// VaultMate Background Service Worker

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'trigger_autofill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_AUTOFILL' }, () => {
      if (chrome.runtime.lastError) {
        chrome.action.openPopup().catch(() => {});
      }
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'VAULT_SESSION_UPDATE') {
    chrome.storage.session.set({ vaultSession: { entries: msg.entries } });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'VAULT_SESSION_CLEAR') {
    chrome.storage.session.remove('vaultSession');
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'GET_CURRENT_TAB_URL') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      sendResponse({ url: tabs[0]?.url || '', title: tabs[0]?.title || '' });
    });
    return true;
  }
  if (msg.action === 'FILL_CREDENTIALS') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'DO_FILL', username: msg.username, password: msg.password
        }, (resp) => sendResponse(resp || { success: true }));
      }
    });
    return true;
  }
  if (msg.action === 'GET_CREDENTIALS_FOR_SITE' || msg.action === 'HAS_CREDENTIALS_FOR_SITE') {
    chrome.storage.session.get('vaultSession', (data) => {
      const entries = data?.vaultSession?.entries || [];
      const domain = (msg.domain || '').toLowerCase();
      const matches = entries.filter(e => matchesDomain(e, domain));
      sendResponse({ credentials: matches, hasCredentials: matches.length > 0 });
    });
    return true;
  }
});

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function matchesDomain(entry, domain) {
  if (!domain) return false;
  const s = (entry.site || '').toLowerCase();
  const u = extractDomain(entry.url || '');
  return s.includes(domain) || domain.includes(s) || u === domain || domain.includes(u);
}
