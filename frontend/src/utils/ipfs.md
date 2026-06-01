# IPFS Utility Layer for DID Protocol

A lightweight IPFS integration layer built entirely with the browser's native APIs. No npm packages are required — only the built-in Fetch API and Web Crypto API (`crypto.subtle`).

---

## Features

- Zero external dependencies
- Native browser Fetch API support
- Native Web Crypto API encryption
- IPFS upload and retrieval
- DID Document validation
- CID pinning via Infura
- AES-256-GCM encryption support
- Wallet-signature-based deterministic encryption keys
- React hook for easy frontend integration

---

# Installation

No additional packages are required.

The implementation relies entirely on:

- Fetch API
- FormData API
- Web Crypto API (`crypto.subtle`)

Supported in all modern browsers.

---

# Environment Variables

Create a `.env` file:

```env
VITE_INFURA_IPFS_ID=your_project_id
VITE_INFURA_IPFS_SECRET=your_project_secret
VITE_IPFS_GATEWAY=https://ipfs.io/ipfs/
```

---

# Core Functions

## uploadJSON(data, options)

Serializes a JavaScript object into JSON and uploads it to IPFS using Infura.

### Features

- Validates payload size (< 5 MB)
- Builds multipart FormData request
- Uses Basic Authentication when Infura credentials are configured
- Uploads to:

```text
/api/v0/add
```

### Returns

```js
{
  cid: string,
  url: string,
  size: number
}
```

### Example

```js
const result = await uploadJSON(didDocument);

console.log(result.cid);
console.log(result.url);
```

---

## fetchFromIPFS(cid, options)

Retrieves content from IPFS using gateway failover.

### Features

- Tries every gateway in `GATEWAYS[]`
- 8-second timeout per gateway
- Automatically falls back to next gateway
- Supports JSON and text responses

### Example

```js
const data = await fetchFromIPFS(cid);
```

For text files:

```js
const text = await fetchFromIPFS(cid, {
  asText: true
});
```

### Throws

```text
All gateways failed:
- ipfs.io timeout
- cloudflare-ipfs error
- ...
```

---

## fetchDIDDocument(cid)

Retrieves and validates a W3C DID Document.

### Validation

Required fields:

```json
{
  "@context": "...",
  "id": "..."
}
```

### Example

```js
const didDoc = await fetchDIDDocument(cid);
```

### Throws

```text
Invalid DID Document:
Missing @context
```

or

```text
Invalid DID Document:
Missing id
```

---

## pinCID(cid)

Pins an existing CID using Infura.

### Endpoint

```text
/api/v0/pin/add
```

### Behavior

- Requires Infura credentials
- Skips pinning when credentials are missing

### Example

```js
await pinCID(cid);
```

Without credentials:

```text
Warning: IPFS pinning skipped
```

---

# Encryption Layer (AES-256-GCM)

The encryption system uses the browser's native Web Crypto API.

---

## generateEncryptionKey()

Creates a fresh AES-256-GCM key.

### Example

```js
const key = await generateEncryptionKey();
```

---

## deriveKeyFromSignature(signature)

Creates a deterministic encryption key from a wallet signature.

### Why?

Users never need to:

- Store encryption keys
- Backup encryption keys
- Remember passwords

The same wallet signature always produces the same encryption key.

### Process

1. User signs a fixed message
2. Signature is hashed with SHA-256
3. Hash becomes AES-256 key material

### Example

```js
const signature = await wallet.signMessage(
  "DID Protocol Encryption Key v1"
);

const key = await deriveKeyFromSignature(signature);
```

---

## encryptData(plaintext, key)

Encrypts text using AES-256-GCM.

### Features

- Generates random 96-bit IV
- Encrypts using AES-GCM
- Returns Base64 encoded payload

### Output Format

```text
base64(
  iv + ciphertext
)
```

### Example

```js
const encrypted = await encryptData(
  JSON.stringify(data),
  key
);
```

---

## decryptData(base64Cipher, key)

Decrypts encrypted payloads.

### Example

```js
const plaintext = await decryptData(
  encryptedPayload,
  key
);

const data = JSON.parse(plaintext);
```

---

# Encrypted IPFS Functions

## uploadEncryptedJSON(data, key)

Encrypts data before uploading to IPFS.

### Uploaded Structure

```json
{
  "encrypted": true,
  "algorithm": "AES-GCM-256",
  "data": "base64_ciphertext"
}
```

### Example

```js
const result = await uploadEncryptedJSON(
  sensitiveDocument,
  key
);
```

### Returns

```js
{
  cid,
  url,
  key
}
```

---

## fetchEncryptedFromIPFS(cid, key)

Downloads encrypted content from IPFS and decrypts it.

### Validation

Checks:

```json
{
  "encrypted": true
}
```

before attempting decryption.

### Example

```js
const document = await fetchEncryptedFromIPFS(
  cid,
  key
);
```

---

# React Hook

## useIPFS()

Provides a React-friendly wrapper around all core functionality.

### State Management

Automatically manages:

```js
loading
error
result
```

### Example

```jsx
const ipfs = useIPFS();
```

---

## Upload Example

```jsx
const result = await ipfs.upload(didDocument);

if (result) {
  setCID(result.cid);
}
```

---

## Encryption Example

```jsx
const signature = await wallet.signMessage(
  "DID Protocol Encryption Key v1"
);

const key = await deriveKeyFromSignature(
  signature
);

const result = await ipfs.uploadEncrypted(
  sensitiveDoc,
  key
);
```

---

# Example Workflow

## Public DID Document

```js
const result = await uploadJSON(didDocument);

console.log(result.cid);
```

---

## Encrypted DID Document

```js
const signature = await wallet.signMessage(
  "DID Protocol Encryption Key v1"
);

const key = await deriveKeyFromSignature(
  signature
);

const result = await uploadEncryptedJSON(
  didDocument,
  key
);
```

---

# Project Structure

```text
src/
├── ipfs.js
├── encryption.js
├── hooks/
│   └── useIPFS.js
├── components/
│   ├── RegisterDID.jsx
│   ├── ResolveDID.jsx
│   └── ProveIdentity.jsx
└── utils/
```

---

# Remaining Components To Build

| File | Purpose |
|--------|----------|
| deploy.js | Deploys all contracts, sets verifying key, registers claim types |
| generate_proof.js | Compiles circuits and generates SNARK proofs locally |
| zkp.js | Browser-side proof generation utility |
| hardhat.config.js | Hardhat configuration and network setup |

---

# Security Notes

- AES-256-GCM provides authenticated encryption.
- IVs are generated using cryptographically secure randomness.
- Encryption keys are never stored.
- Wallet signatures deterministically regenerate encryption keys.
- DID documents can be stored publicly or encrypted depending on sensitivity.

---

# Summary

This module provides:

 Zero npm dependencies  
 rowser-native IPFS integration  
 Gateway failover support  
 DID document validation  
 CID pinning support  
 AES-256-GCM encryption  
 Wallet-signature-derived keys  
 React hook integration  
 Secure encrypted document storage on IPFS
