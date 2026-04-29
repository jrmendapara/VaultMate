// VaultMate — Google Sheets Sync Module

const SheetsManager = (() => {
  const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

  async function getToken(interactive = true) {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, token => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve(token);
        }
      });
    });
  }

  async function revokeToken() {
    return new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(resolve);
    });
  }

  async function createSpreadsheet(token) {
    const res = await fetch(`${API_BASE}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        properties: { title: 'VaultMate Passwords' },
        sheets: [{
          properties: { title: 'Passwords' },
          data: [{
            startRow: 0, startColumn: 0,
            rowData: [{
              values: ['ID', 'Client Name', 'Site', 'URL', 'Username', 'Password', 'Category', 'Notes', 'Created', 'Updated']
                .map(v => ({ userEnteredValue: { stringValue: v } }))
            }]
          }]
        }]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to create spreadsheet');
    return data.spreadsheetId;
  }

  async function readEntries(token, spreadsheetId) {
    const res = await fetch(
      `${API_BASE}/${spreadsheetId}/values/Passwords!A2:J`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to read sheet');
    return (data.values || []).map(row => ({
      id: row[0] || '',
      clientName: row[1] || '',
      site: row[2] || '',
      url: row[3] || '',
      username: row[4] || '',
      password: row[5] || '',  // stored encrypted
      category: row[6] || 'other',
      notes: row[7] || '',
      createdAt: row[8] || '',
      updatedAt: row[9] || ''
    }));
  }

  async function writeAllEntries(token, spreadsheetId, entries) {
    // Clear existing data first
    await fetch(
      `${API_BASE}/${spreadsheetId}/values/Passwords!A2:J?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          range: 'Passwords!A2:J',
          majorDimension: 'ROWS',
          values: entries.map(e => [
            e.id, e.clientName || '', e.site, e.url, e.username, e.password,
            e.category, e.notes, e.createdAt, e.updatedAt
          ])
        })
      }
    );
  }

  async function syncToSheets(entries, spreadsheetId) {
    const token = await getToken(true);
    let sheetId = spreadsheetId;
    if (!sheetId) {
      sheetId = await createSpreadsheet(token);
    }
    await writeAllEntries(token, sheetId, entries);
    return sheetId;
  }

  async function syncFromSheets(spreadsheetId) {
    const token = await getToken(true);
    return readEntries(token, spreadsheetId);
  }

  return { getToken, revokeToken, syncToSheets, syncFromSheets, createSpreadsheet };
})();
