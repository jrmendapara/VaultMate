# 🔑 VaultMate — Password Manager Chrome Extension

A secure, feature-rich password manager built as a Chrome Extension.

---

## ✅ Features

| Feature | Details |
|---|---|
| **Encrypted Local Storage** | AES-256-GCM via Web Crypto API, PBKDF2 key derivation |
| **Master Password** | Protects all entries; never stored, only a hash |
| **Auto-fill** | Detects login forms, fills on click or keyboard shortcut |
| **Update Password** | Edit any saved entry with full form |
| **Excel Export** | Download all passwords as `.xlsx` |
| **Excel Import** | Import from `.xlsx`/`.csv` with smart column detection |
| **Google Sheets Sync** | Push / Pull via Google Sheets API v4 |
| **Keyboard Shortcuts** | `Alt+P` open popup, `Alt+F` auto-fill on active page |
| **Password Generator** | Cryptographically random, with strength meter |
| **Categories** | Email, Social, Banking, Work, Other |

---

## 🚀 Installation

### Step 1 — Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer Mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `vaultmate` folder

### Step 2 — Set up Google Sheets Sync (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project → Enable **Google Sheets API**
3. Go to **APIs & Services → Credentials**
4. Create **OAuth 2.0 Client ID** → Type: **Chrome Extension**
5. Copy the **Client ID**
6. Open `manifest.json` and replace:
   ```
   "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
   ```
   with your actual Client ID
7. Reload the extension in `chrome://extensions/`

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + P` | Open VaultMate popup |
| `Alt + F` | Auto-fill login form on current page |

Shortcuts can be customized at `chrome://extensions/shortcuts`

---

## 📊 Excel Import Format

Your Excel file needs these columns (header row):

| Site | URL | Username | Password | Category | Notes |
|---|---|---|---|---|---|
| Google | https://accounts.google.com | user@gmail.com | yourpass | email | |

- **Required:** Site, Username, Password
- **Optional:** URL, Category (email/social/banking/work/other), Notes

Download the template from the **Excel** tab in the extension.

---

## 🔐 Security Notes

- Master password is **never stored** — only a PBKDF2-derived hash for verification
- All passwords encrypted with **AES-256-GCM** before storage
- Session credentials cached in `chrome.storage.session` (cleared on browser close)
- Google Sheets sync stores passwords in the sheet (use a private sheet!)
- This is a personal/local tool — not a replacement for enterprise solutions

---

## 🗂 File Structure

```
vaultmate/
├── manifest.json       Chrome Extension manifest (MV3)
├── popup.html          Main UI
├── popup.css           Styles (dark theme)
├── popup.js            App logic
├── background.js       Service worker (autofill relay)
├── content.js          Page form detection & filling
├── crypto.js           AES-GCM + PBKDF2 encryption
├── sheets.js           Google Sheets API integration
├── lib/
│   └── xlsx.min.js     SheetJS for Excel I/O
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```
