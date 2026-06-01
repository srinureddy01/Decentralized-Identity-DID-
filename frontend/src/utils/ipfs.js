/**
 * ipfs.js
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/utils/ipfs.js
 *
 * Complete IPFS utility module for the DID Protocol.
 * Handles all upload, fetch, pin, and encryption operations
 * needed by RegisterDID.jsx, ProveIdentity.jsx, and Dashboard.jsx.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 *  • Upload JSON / files to IPFS via Infura or a local node
 *  • Fetch content by CID from multiple public gateways with fallback
 *  • Pin CIDs to ensure persistence
 *  • Encrypt DID documents before upload using AES-GCM (Web Crypto API)
 *  • Decrypt on fetch using the same key
 *  • Validate CIDs (v0 and v1)
 *  • Build IPFS gateway URLs for display / linking
 *
 * ── SETUP ────────────────────────────────────────────────────────────────
 *  No npm packages needed — uses the browser Fetch API and Web Crypto API.
 *  For authenticated Infura:
 *    Set VITE_INFURA_IPFS_ID and VITE_INFURA_IPFS_SECRET in your .env file.
 *
 *  .env example:
 *    VITE_INFURA_IPFS_ID=your_project_id
 *    VITE_INFURA_IPFS_SECRET=your_project_secret
 *    VITE_IPFS_GATEWAY=https://ipfs.io/ipfs/        (optional override)
 *
 * ── EXPORTS ──────────────────────────────────────────────────────────────
 *
 *  uploadJSON(data, options?)          → Promise<{ cid, url, size }>
 *  uploadEncryptedJSON(data, key?)     → Promise<{ cid, url, size, key }>
 *  fetchFromIPFS(cid, options?)        → Promise<any>
 *  fetchEncryptedFromIPFS(cid, key)    → Promise<any>
 *  fetchDIDDocument(cid)               → Promise<DIDDocument>
 *  pinCID(cid)                         → Promise<boolean>
 *  buildGatewayURL(cid, gateway?)      → string
 *  isValidCID(cid)                     → boolean
 *  generateEncryptionKey()             → Promise<CryptoKey>
 *  exportKey(cryptoKey)                → Promise<string>   (base64)
 *  importKey(base64Key)                → Promise<CryptoKey>
 *
 *  GATEWAYS                            Array of public gateway base URLs
 *  DEFAULT_GATEWAY                     Primary gateway string
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Configuration ─────────────────────────────────────────────────────────────

const INFURA_API_BASE = "https://ipfs.infura.io:5001/api/v0";

// Infura project credentials (set in .env)
const INFURA_ID     = import.meta.env?.VITE_INFURA_IPFS_ID     ?? "";
const INFURA_SECRET = import.meta.env?.VITE_INFURA_IPFS_SECRET ?? "";

// Build Basic Auth header for Infura authenticated requests
const INFURA_AUTH = INFURA_ID && INFURA_SECRET
  ? "Basic " + btoa(`${INFURA_ID}:${INFURA_SECRET}`)
  : null;

// Public IPFS gateways — tried in order on fetch, fallback if one fails
export const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
  "https://dweb.link/ipfs/",
  "https://ipfs.filebase.io/ipfs/",
];

export const DEFAULT_GATEWAY = import.meta.env?.VITE_IPFS_GATEWAY ?? GATEWAYS[0];

// Timeout for each gateway fetch attempt (ms)
const FETCH_TIMEOUT_MS = 8_000;

// Max file size we allow uploading (5 MB)
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// ── CID Validation ────────────────────────────────────────────────────────────

/**
 * Validate a CID string (supports CIDv0 and CIDv1).
 * CIDv0: starts with "Qm", 46 chars, base58
 * CIDv1: starts with "b", base32 encoded, longer
 *
 * @param {string} cid
 * @returns {boolean}
 */
export function isValidCID(cid) {
  if (!cid || typeof cid !== "string") return false;
  const trimmed = cid.trim();

  // CIDv0: Qm + 44 base58 chars = 46 total
  const cidV0 = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

  // CIDv1: starts with 'b' followed by base32 chars (common format)
  const cidV1 = /^b[a-z2-7]{58,}$/;

  return cidV0.test(trimmed) || cidV1.test(trimmed);
}

// ── Gateway URL Builder ───────────────────────────────────────────────────────

/**
 * Build a full public gateway URL for a given CID.
 *
 * @param {string} cid      IPFS CID
 * @param {string} gateway  Base gateway URL (default: DEFAULT_GATEWAY)
 * @returns {string}        Full URL e.g. "https://ipfs.io/ipfs/QmAbc..."
 *
 * @example
 *   buildGatewayURL("QmAbc123");
 *   // → "https://ipfs.io/ipfs/QmAbc123"
 */
export function buildGatewayURL(cid, gateway = DEFAULT_GATEWAY) {
  if (!cid) return "";
  const base = gateway.endsWith("/") ? gateway : gateway + "/";
  return base + cid.trim();
}

// ── Fetch Helpers ─────────────────────────────────────────────────────────────

/**
 * Fetch with a timeout — rejects after FETCH_TIMEOUT_MS ms.
 * @param {string} url
 * @param {RequestInit} opts
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── UPLOAD ────────────────────────────────────────────────────────────────────

/**
 * Upload a JSON object to IPFS.
 *
 * Uses Infura IPFS HTTP API (/api/v0/add).
 * If no Infura credentials are set, falls back to the public Infura endpoint
 * (rate-limited — fine for development, use credentials in production).
 *
 * @param {object} data     Plain JS object to serialise and upload
 * @param {object} options
 * @param {boolean} options.pin     Pin the content (default: true)
 * @param {string}  options.name    Filename hint for the upload
 *
 * @returns {Promise<{ cid: string, url: string, size: number }>}
 *
 * @throws {Error} if upload fails or data exceeds MAX_UPLOAD_BYTES
 *
 * @example
 *   const { cid, url } = await uploadJSON({ "@context": [...], id: "did:..." });
 *   console.log(cid); // "QmXxYy..."
 */
export async function uploadJSON(data, options = {}) {
  const { pin = true, name = "did-document.json" } = options;

  // Serialise
  const json = JSON.stringify(data, null, 2);
  const bytes = new TextEncoder().encode(json);

  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Upload rejected: content is ${(bytes.length / 1024).toFixed(1)} KB, ` +
      `max allowed is ${MAX_UPLOAD_BYTES / 1024} KB.`
    );
  }

  // Build multipart form
  const blob = new Blob([bytes], { type: "application/json" });
  const form = new FormData();
  form.append("file", blob, name);

  const headers = {};
  if (INFURA_AUTH) headers["Authorization"] = INFURA_AUTH;

  const endpoint = `${INFURA_API_BASE}/add?pin=${pin}&quieter=true`;

  let res;
  try {
    res = await fetchWithTimeout(endpoint, {
      method:  "POST",
      headers,
      body:    form,
    });
  } catch (err) {
    throw new Error(`IPFS upload network error: ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`IPFS upload failed (${res.status}): ${body || res.statusText}`);
  }

  const result = await res.json();

  if (!result.Hash) {
    throw new Error("IPFS upload succeeded but no CID returned.");
  }

  return {
    cid:  result.Hash,
    url:  buildGatewayURL(result.Hash),
    size: bytes.length,
  };
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

/**
 * Fetch content from IPFS by CID.
 * Tries each gateway in order, returns on the first success.
 *
 * @param {string} cid       IPFS CID to fetch
 * @param {object} options
 * @param {boolean} options.asText      Return raw text instead of parsed JSON
 * @param {string[]} options.gateways   Override gateway list
 *
 * @returns {Promise<any>}   Parsed JSON object (or text if asText=true)
 *
 * @throws {Error} if all gateways fail
 *
 * @example
 *   const doc = await fetchFromIPFS("QmXxYy...");
 *   console.log(doc.id); // "did:ethr:sepolia:0x..."
 */
export async function fetchFromIPFS(cid, options = {}) {
  const { asText = false, gateways = GATEWAYS } = options;

  if (!isValidCID(cid)) {
    throw new Error(`Invalid CID: "${cid}"`);
  }

  const errors = [];

  for (const gateway of gateways) {
    const url = buildGatewayURL(cid, gateway);
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) {
        errors.push(`${gateway}: HTTP ${res.status}`);
        continue;
      }

      if (asText) return await res.text();

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // Not JSON — return raw text
        return text;
      }
    } catch (err) {
      errors.push(`${gateway}: ${err.message}`);
    }
  }

  throw new Error(
    `Failed to fetch CID "${cid}" from all gateways:\n${errors.join("\n")}`
  );
}

// ── FETCH DID DOCUMENT ────────────────────────────────────────────────────────

/**
 * Fetch and validate a DID Document from IPFS.
 * Checks for required W3C DID document fields.
 *
 * @param {string} cid   IPFS CID of the DID document
 * @returns {Promise<object>}  The parsed DID document
 *
 * @throws {Error} if the document is missing required fields
 *
 * @example
 *   const didDoc = await fetchDIDDocument("QmXxYy...");
 *   console.log(didDoc["@context"]);
 *   console.log(didDoc.id); // "did:ethr:sepolia:0x..."
 */
export async function fetchDIDDocument(cid) {
  const doc = await fetchFromIPFS(cid);

  // Basic W3C DID document validation
  if (typeof doc !== "object" || doc === null) {
    throw new Error("DID document is not a valid JSON object.");
  }
  if (!doc["@context"]) {
    throw new Error("DID document missing '@context' field.");
  }
  if (!doc.id) {
    throw new Error("DID document missing 'id' field.");
  }

  return doc;
}

// ── PIN ───────────────────────────────────────────────────────────────────────

/**
 * Pin a CID to Infura IPFS to prevent garbage collection.
 * Requires Infura credentials (VITE_INFURA_IPFS_ID + VITE_INFURA_IPFS_SECRET).
 *
 * @param {string} cid   CID to pin
 * @returns {Promise<boolean>}  true if pinned successfully
 *
 * @example
 *   await pinCID("QmXxYy...");
 */
export async function pinCID(cid) {
  if (!isValidCID(cid)) throw new Error(`Invalid CID: "${cid}"`);
  if (!INFURA_AUTH) {
    console.warn("[ipfs.js] pinCID: No Infura credentials set. Skipping pin.");
    return false;
  }

  const endpoint = `${INFURA_API_BASE}/pin/add?arg=${cid}`;
  try {
    const res = await fetchWithTimeout(endpoint, {
      method:  "POST",
      headers: { Authorization: INFURA_AUTH },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Pin failed (${res.status}): ${body}`);
    }
    return true;
  } catch (err) {
    throw new Error(`IPFS pin error: ${err.message}`);
  }
}

// ── ENCRYPTION HELPERS (Web Crypto API) ──────────────────────────────────────

const CRYPTO_ALGO  = "AES-GCM";
const CRYPTO_BITS  = 256;
const IV_LENGTH    = 12; // bytes (96 bits — standard for AES-GCM)

/**
 * Generate a new AES-256-GCM CryptoKey for DID document encryption.
 * The user must store this key (e.g. derived from their wallet signature)
 * to decrypt the document later.
 *
 * @returns {Promise<CryptoKey>}
 *
 * @example
 *   const key = await generateEncryptionKey();
 *   const b64 = await exportKey(key);
 *   // store b64 safely
 */
export async function generateEncryptionKey() {
  return crypto.subtle.generateKey(
    { name: CRYPTO_ALGO, length: CRYPTO_BITS },
    true,          // extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to a base64 string for storage.
 * @param {CryptoKey} cryptoKey
 * @returns {Promise<string>}  base64-encoded raw key bytes
 */
export async function exportKey(cryptoKey) {
  const raw = await crypto.subtle.exportKey("raw", cryptoKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/**
 * Import a base64 key string back into a CryptoKey.
 * @param {string} base64Key
 * @returns {Promise<CryptoKey>}
 */
export async function importKey(base64Key) {
  const raw = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: CRYPTO_ALGO, length: CRYPTO_BITS },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive an AES key deterministically from a wallet signature.
 * The user signs a fixed message with their wallet → same wallet always
 * produces the same key → no key storage needed.
 *
 * @param {string} signature   Hex signature string from wallet.signMessage()
 * @returns {Promise<CryptoKey>}
 *
 * @example
 *   const sig = await wallet.signMessage("DID Protocol Encryption Key v1");
 *   const key = await deriveKeyFromSignature(sig);
 */
export async function deriveKeyFromSignature(signature) {
  // Hash the signature bytes to get consistent 256-bit key material
  const sigBytes = new TextEncoder().encode(signature);
  const hashBuf  = await crypto.subtle.digest("SHA-256", sigBytes);

  return crypto.subtle.importKey(
    "raw",
    hashBuf,
    { name: CRYPTO_ALGO, length: CRYPTO_BITS },
    false,          // non-extractable when derived (more secure)
    ["encrypt", "decrypt"]
  );
}

// ── AES-GCM Encrypt / Decrypt ─────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 string using AES-256-GCM.
 * Returns a base64-encoded string containing IV + ciphertext.
 *
 * @param {string}    plaintext  UTF-8 string to encrypt
 * @param {CryptoKey} key        AES-GCM CryptoKey
 * @returns {Promise<string>}    base64(iv || ciphertext)
 */
export async function encryptData(plaintext, key) {
  const iv        = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded   = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: CRYPTO_ALGO, iv },
    key,
    encoded
  );

  // Concatenate iv + ciphertext into a single Uint8Array, then base64-encode
  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded AES-GCM ciphertext string.
 *
 * @param {string}    base64Cipher  base64(iv || ciphertext)
 * @param {CryptoKey} key           AES-GCM CryptoKey
 * @returns {Promise<string>}       Decrypted UTF-8 string
 */
export async function decryptData(base64Cipher, key) {
  const combined  = Uint8Array.from(atob(base64Cipher), c => c.charCodeAt(0));
  const iv        = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: CRYPTO_ALGO, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// ── UPLOAD ENCRYPTED ─────────────────────────────────────────────────────────

/**
 * Encrypt a JSON object and upload the ciphertext to IPFS.
 * Useful for storing sensitive DID document fields privately.
 *
 * If no key is provided, a new random key is generated and returned.
 * If a CryptoKey is provided, it is used directly.
 *
 * @param {object}          data    JSON-serialisable object
 * @param {CryptoKey|null}  key     Encryption key (generated if not provided)
 * @param {object}          options Same options as uploadJSON
 *
 * @returns {Promise<{
 *   cid:  string,
 *   url:  string,
 *   size: number,
 *   key:  CryptoKey,      the key used (generated or passed in)
 *   keyB64: string,       base64-exported key for storage
 * }>}
 *
 * @example
 *   // Derive key from wallet signature so user never needs to store it
 *   const sig = await wallet.signMessage("DID Protocol v1");
 *   const key = await deriveKeyFromSignature(sig);
 *   const { cid } = await uploadEncryptedJSON(sensitiveData, key);
 */
export async function uploadEncryptedJSON(data, key = null, options = {}) {
  // Generate key if not provided
  const encKey = key ?? await generateEncryptionKey();

  const plaintext = JSON.stringify(data, null, 2);
  const ciphertext = await encryptData(plaintext, encKey);

  // Upload the encrypted payload as a JSON wrapper
  const payload = {
    encrypted: true,
    algorithm: `${CRYPTO_ALGO}-${CRYPTO_BITS}`,
    data:      ciphertext,
  };

  const result = await uploadJSON(payload, {
    ...options,
    name: options.name ?? "did-document-encrypted.json",
  });

  const keyB64 = await exportKey(encKey).catch(() => "");

  return {
    ...result,
    key:    encKey,
    keyB64,
  };
}

// ── FETCH ENCRYPTED ───────────────────────────────────────────────────────────

/**
 * Fetch and decrypt an encrypted JSON document from IPFS.
 *
 * @param {string}    cid   IPFS CID of the encrypted document
 * @param {CryptoKey} key   The AES-GCM key used during upload
 * @returns {Promise<any>}  Decrypted and parsed JSON object
 *
 * @throws {Error} if the document is not an encrypted payload or decryption fails
 *
 * @example
 *   const sig = await wallet.signMessage("DID Protocol v1");
 *   const key = await deriveKeyFromSignature(sig);
 *   const doc = await fetchEncryptedFromIPFS("QmXxYy...", key);
 */
export async function fetchEncryptedFromIPFS(cid, key) {
  const payload = await fetchFromIPFS(cid);

  if (!payload?.encrypted || !payload?.data) {
    throw new Error("Document is not an encrypted DID payload.");
  }

  try {
    const plaintext = await decryptData(payload.data, key);
    return JSON.parse(plaintext);
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}. Check that the correct key is being used.`);
  }
}

// ── BATCH UTILITIES ───────────────────────────────────────────────────────────

/**
 * Fetch multiple CIDs in parallel with a concurrency limit.
 * Returns an array of { cid, data, error } — never throws.
 *
 * @param {string[]} cids         Array of CIDs to fetch
 * @param {number}   concurrency  Max parallel fetches (default: 3)
 * @returns {Promise<Array<{ cid: string, data: any, error: string|null }>>}
 *
 * @example
 *   const results = await batchFetch(["QmAbc…", "QmDef…"]);
 *   results.forEach(r => {
 *     if (r.error) console.error(r.cid, r.error);
 *     else console.log(r.cid, r.data);
 *   });
 */
export async function batchFetch(cids, concurrency = 3) {
  const results = [];
  const queue   = [...cids];

  async function worker() {
    while (queue.length > 0) {
      const cid = queue.shift();
      try {
        const data = await fetchFromIPFS(cid);
        results.push({ cid, data, error: null });
      } catch (err) {
        results.push({ cid, data: null, error: err.message });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cids.length) }, worker)
  );

  // Restore original order
  return cids.map(cid => results.find(r => r.cid === cid));
}

// ── FORMAT HELPERS ────────────────────────────────────────────────────────────

/**
 * Shorten a CID for display in the UI.
 * e.g. "QmXxYyZz..." → "QmXxYy···ZzAaBb"
 *
 * @param {string} cid
 * @param {number} head  Chars to show at the start (default 8)
 * @param {number} tail  Chars to show at the end   (default 6)
 * @returns {string}
 */
export function shortenCID(cid, head = 8, tail = 6) {
  if (!cid || cid.length <= head + tail + 3) return cid;
  return `${cid.slice(0, head)}···${cid.slice(-tail)}`;
}

/**
 * Build an IPFS gateway URL with a specific file path inside a directory CID.
 * e.g. buildPathURL("QmDir...", "metadata.json")
 *
 * @param {string} dirCID    CID of the IPFS directory
 * @param {string} filename  Filename inside the directory
 * @param {string} gateway   Gateway base URL
 * @returns {string}
 */
export function buildPathURL(dirCID, filename, gateway = DEFAULT_GATEWAY) {
  const base = gateway.endsWith("/") ? gateway : gateway + "/";
  return `${base}${dirCID}/${filename}`;
}

// ── REACT HOOK ────────────────────────────────────────────────────────────────

/**
 * useIPFS()
 * React hook that wraps uploadJSON and fetchFromIPFS with
 * loading / error / result state management.
 *
 * @returns {{
 *   upload:      (data, options?) => Promise<{ cid, url, size } | null>
 *   fetch:       (cid, options?)  => Promise<any | null>
 *   uploadEncrypted: (data, key?, options?) => Promise<{ cid, url, size, key, keyB64 } | null>
 *   fetchEncrypted:  (cid, key)   => Promise<any | null>
 *   loading:     boolean
 *   error:       string | null
 *   result:      any
 *   reset:       () => void
 * }}
 *
 * @example
 *   const ipfs = useIPFS();
 *
 *   const handleUpload = async () => {
 *     const result = await ipfs.upload({ id: "did:ethr:..." });
 *     if (result) console.log(result.cid);
 *   };
 */
export function useIPFS() {
  // Lazy import React hooks to keep this file usable outside React too
  const { useState, useCallback } = require("react");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [result,  setResult]  = useState(null);

  const _wrap = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fn();
      setResult(res);
      return res;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const upload = useCallback((data, opts) =>
    _wrap(() => uploadJSON(data, opts)), [_wrap]);

  const fetchCID = useCallback((cid, opts) =>
    _wrap(() => fetchFromIPFS(cid, opts)), [_wrap]);

  const uploadEncrypted = useCallback((data, key, opts) =>
    _wrap(() => uploadEncryptedJSON(data, key, opts)), [_wrap]);

  const fetchEncrypted = useCallback((cid, key) =>
    _wrap(() => fetchEncryptedFromIPFS(cid, key)), [_wrap]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return {
    upload,
    fetch:           fetchCID,
    uploadEncrypted,
    fetchEncrypted,
    loading,
    error,
    result,
    reset,
  };
}

// ── Default export: all named utilities bundled ───────────────────────────────
export default {
  // Core
  uploadJSON,
  fetchFromIPFS,
  fetchDIDDocument,
  pinCID,

  // Encryption
  uploadEncryptedJSON,
  fetchEncryptedFromIPFS,
  generateEncryptionKey,
  exportKey,
  importKey,
  deriveKeyFromSignature,
  encryptData,
  decryptData,

  // Batch
  batchFetch,

  // Helpers
  buildGatewayURL,
  buildPathURL,
  shortenCID,
  isValidCID,

  // React
  useIPFS,

  // Constants
  GATEWAYS,
  DEFAULT_GATEWAY,
};
