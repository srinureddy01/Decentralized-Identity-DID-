# CONTRACT_ABIS — Shared ABI Fragments

All three contract ABIs (`DIDRegistry`, `ZKPVerifier`, `CredentialNFT`) are defined once at the top level.

Every hook imports from this shared object:

```js
import { CONTRACT_ABIS } from "../hooks/useContract";
```

This eliminates ABI duplication and keeps contract definitions centralized and maintainable.

---

# Hooks Overview

## 1. useContract()

Base contract interaction hook.

### Signature

```js
useContract(address, abi, signerOrProvider)
```

### Returns

- `contract` → Raw `ethers.Contract` instance
- `call(method, ...args)` → Generic contract method wrapper
- `loading`
- `error`
- `result`

### Features

- Automatic loading state management
- Error handling
- Result tracking
- Suitable for one-off contract interactions

### Use Cases

- Custom contract calls
- Utility operations
- Non-reactive interactions

---

## 2. useContractRead()

Reactive read-only contract hook.

### Signature

```js
useContractRead(
  address,
  abi,
  provider,
  method,
  args,
  options
)
```

### Features

- Executes immediately on mount
- Re-fetches when arguments change
- JSON-based argument comparison
- Manual refresh support

### Options

```js
{
  skip: false,
  refreshInterval: 5000
}
```

### Returns

```js
{
  data,
  loading,
  error,
  refetch
}
```

### Use Cases

- DID status checks
- Claim verification state
- NFT balances
- Contract metadata

---

## 3. useContractWrite()

Transaction execution hook.

### Signature

```js
useContractWrite(
  address,
  abi,
  signer,
  method,
  options
)
```

### Features

- Sends state-changing transactions
- Tracks transaction hash immediately
- Waits for confirmation receipt
- Callback support

### Options

```js
{
  overrides: {
    gasLimit: 500000
  },

  onSuccess(receipt) {},
  onError(message) {}
}
```

### Returns

```js
{
  write,
  loading,
  error,
  txHash,
  receipt
}
```

### Transaction Flow

```txt
write()
  ↓
tx.hash
  ↓
tx.wait(1)
  ↓
receipt
```

---

## 4. useContractEvent()

Real-time event subscription hook.

### Signature

```js
useContractEvent(
  address,
  abi,
  provider,
  eventName,
  listener
)
```

### Features

- Subscribes via:

```js
contract.on(...)
```

- Stores event logs in state
- Auto-cleanup on unmount
- Configurable log retention

### Options

```js
{
  maxLogs: 100
}
```

### Use Cases

- DID registration feeds
- Proof verification events
- NFT mint notifications

---

## 5. useDIDRegistry()

Project-specific DID registry hook.

### Signature

```js
useDIDRegistry(
  address,
  signer,
  provider,
  userAddr
)
```

### Auto-Fetched State

```js
hasDID
didDoc
totalDIDs
```

### Actions

```js
register(did, cid)
update(newCid)
deactivate()
```

### Features

- Automatic state refresh after writes
- Encapsulates DID contract logic
- Simplifies component code

---

## 6. useZKPVerifier()

Zero-Knowledge Proof verification hook.

### Signature

```js
useZKPVerifier(
  address,
  signer,
  provider,
  userAddr
)
```

### Internal State

```js
claimCache = {
  claimType: verified
}
```

### Methods

```js
hasClaim(claimType)

getClaim(claimType)

refreshClaims(types)

verifyProof(...)
```

### Features

- Local verification cache
- Automatic cache refresh
- Optimized claim lookups

---

## 7. useCredentialNFT()

Credential NFT management hook.

### Signature

```js
useCredentialNFT(
  address,
  signer,
  provider,
  userAddr
)
```

### Tracked State

```js
balance
totalSupply
tokenMap
credentialData
```

### Methods

```js
mint(claimType)

hasCredential(claimType)

getToken(claimType)

refreshCredentials(types)
```

### Special Feature

After minting, the hook parses the `Transfer` event directly from the transaction receipt to obtain the new `tokenId`.

```txt
Mint Transaction
      ↓
Receipt
      ↓
Transfer Event
      ↓
tokenId Extracted
```

No additional contract read is required.

---

# parseContractError()

Unified ethers v6 error handling utility.

| Error Code | Human-Friendly Message |
|------------|------------------------|
| `4001` | Transaction rejected by user. |
| `ACTION_REJECTED` | Transaction rejected by user. |
| Revert with reason | Contract reverted: `[reason]` |
| `INSUFFICIENT_FUNDS` | Insufficient ETH for gas. |
| `NETWORK_ERROR` | Network error. Check your connection. |
| `CALL_EXCEPTION` | Call reverted without a reason. |

### Example

```js
try {
  await contract.register(...);
} catch (err) {
  const message = parseContractError(err);
  console.error(message);
}
```

---

# Example Usage

## RegisterDID.jsx

Replace manual ethers calls with project hooks.

```jsx
import { useDIDRegistry } from "../hooks/useContract";
import { useWallet } from "../hooks/useWallet";

function RegisterDID({ contractAddress }) {
  const wallet = useWallet({
    requiredChainId: 11155111
  });

  const did = useDIDRegistry(
    contractAddress,
    wallet.signer,
    wallet.provider,
    wallet.address
  );

  // Auto-fetched state
  console.log(did.hasDID);
  console.log(did.didDoc);
  console.log(did.totalDIDs);

  // Register DID
  await did.register(
    "did:ethr:sepolia:0x...",
    "QmCID..."
  );

  return null;
}
```

### Available State

```js
did.hasDID;      // boolean
did.didDoc;      // DID document
did.totalDIDs;   // total registrations
```

### Transaction State

```js
did.writeLoading;
did.txHash;
did.receipt;
did.error;
```

---

# Remaining Infrastructure

| File | Purpose |
|--------|---------|
| `deploy.js` | Deploys all three contracts and configures the verifier key. |
| `generate_proof.js` | Compiles circuits and generates SNARK proofs using `snarkjs`. |
| `zkp.js` | Browser-side proof generation utilities. |
| `ipfs.js` | IPFS upload and retrieval helpers. |

---

# Architecture Summary

```txt
                 CONTRACT_ABIS
                        │
 ┌──────────────────────┼──────────────────────┐
 │                      │                      │
 DIDRegistry       ZKPVerifier         CredentialNFT
 │                      │                      │
 └─────────────── Shared Hooks ────────────────┘
                        │
 ┌──────────────────────┼──────────────────────┐
 │                      │                      │
 useContract      useContractRead     useContractWrite
                        │
                 Project Hooks
                        │
 ┌──────────────────────┼──────────────────────┐
 │                      │                      │
 useDIDRegistry   useZKPVerifier   useCredentialNFT
                        │
                    Components
```
