// VaultMate Crypto Module — AES-GCM + PBKDF2
// All operations are async and use Web Crypto API (no third-party libs)

const CryptoManager = (() => {
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  async function deriveKey(masterPassword, salt) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw', ENC.encode(masterPassword), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function generateSalt() {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  async function hashPassword(password, salt) {
    const key = await deriveKey(password, salt);
    // Encrypt a known string as a verifier
    const iv = new Uint8Array(12);
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      ENC.encode('VAULTMATE_VERIFY')
    );
    return bufToHex(new Uint8Array(enc));
  }

  async function encrypt(text, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      ENC.encode(text)
    );
    // Prepend IV to ciphertext
    const combined = new Uint8Array(iv.length + enc.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(enc), iv.length);
    return bufToBase64(combined);
  }

  async function decrypt(b64, key) {
    const combined = base64ToBuf(b64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const dec = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return DEC.decode(dec);
  }

  function bufToHex(buf) {
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function hexToBuf(hex) {
    return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  }

  function bufToBase64(buf) {
    return btoa(String.fromCharCode(...buf));
  }

  function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  }

  return { deriveKey, generateSalt, hashPassword, encrypt, decrypt, bufToHex, hexToBuf };
})();
