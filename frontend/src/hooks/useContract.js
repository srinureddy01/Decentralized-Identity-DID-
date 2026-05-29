import { useState, useCallback, useRef, useMemo } from "react";
import { ethers } from "ethers";

/**
 * useContract.js
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/hooks/useContract.js
 *
 * A suite of custom React hooks for clean, consistent smart contract
 * interactions across the entire DID Protocol frontend.
 *
 * Eliminates copy-paste try/catch blocks, manual loading flags, and
 * scattered error handling in every component.
 *
 * ── EXPORTS ───────────────────────────────────────────────────────────────
 *
 *  useContract(address, abi, signerOrProvider)
 *    Core hook — returns a contract instance plus a wrapped `call()`
 *    function that manages loading/error/result state automatically.
 *
 *  useContractRead(address, abi, provider, method, args?, options?)
 *    Fires a read call immediately on mount and whenever args change.
 *    Returns { data, loading, error, refetch }.
 *
 *  useContractWrite(address, abi, signer, method, options?)
 *    Returns a `write(...args)` function for send transactions.
 *    Returns { write, loading, error, txHash, receipt, reset }.
 *
 *  useContractEvent(address, abi, provider, eventName, listener, options?)
 *    Subscribes to a contract event and fires listener on each emission.
 *    Returns { logs, loading, error }.
 *
 *  CONTRACT_ABIS
 *    Pre-built ABI fragments for DIDRegistry, ZKPVerifier, CredentialNFT.
 *    Import and pass directly — no need to duplicate ABI strings.
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════
//  SHARED ABI FRAGMENTS
//  Import these in components instead of redefining ABI strings.
// ═══════════════════════════════════════════════════════════════════════════

export const CONTRACT_ABIS = {

  DIDRegistry: [
    // Write
    "function registerDID(string calldata did, string calldata ipfsCID) external",
    "function updateDID(string calldata newIpfsCID) external",
    "function deactivateDID() external",
    // Read
    "function resolveDID(address owner) external view returns (tuple(string did, string ipfsCID, uint256 createdAt, uint256 updatedAt, bool isActive))",
    "function getOwnerByDID(string calldata did) external view returns (address)",
    "function hasActiveDID(address owner) external view returns (bool)",
    "function getIPFSCID(address owner) external view returns (string)",
    "function totalDIDs() external view returns (uint256)",
    // Events
    "event DIDRegistered(address indexed owner, string did, string ipfsCID, uint256 timestamp)",
    "event DIDUpdated(address indexed owner, string did, string newIpfsCID, uint256 timestamp)",
    "event DIDDeactivated(address indexed owner, string did, uint256 timestamp)",
  ],

  ZKPVerifier: [
    // Write
    "function verifyProof(bytes32 claimType, uint256[2] calldata pi_a, uint256[2][2] calldata pi_b, uint256[2] calldata pi_c, uint256[] calldata publicSignals, bytes32 nullifierHash) external",
    "function setVerifyingKey(bytes32 claimType, uint256[2] calldata alpha, uint256[2][2] calldata beta, uint256[2][2] calldata gamma, uint256[2][2] calldata delta, uint256[2][] calldata ic) external",
    "function revokeClaim(address prover, bytes32 claimType) external",
    // Read
    "function hasClaim(address prover, bytes32 claimType) external view returns (bool)",
    "function getClaim(address prover, bytes32 claimType) external view returns (tuple(address prover, bytes32 claimType, uint256 verifiedAt, bool isValid))",
    "function isNullifierUsed(bytes32 nullifierHash) external view returns (bool)",
    "function owner() external view returns (address)",
    // Events
    "event ProofVerified(address indexed prover, bytes32 indexed claimType, uint256 timestamp)",
    "event ProofRevoked(address indexed prover, bytes32 indexed claimType, uint256 timestamp)",
  ],

  CredentialNFT: [
    // Write
    "function mintCredential(bytes32 claimType) external",
    "function registerClaimType(bytes32 claimType, string calldata label, string calldata metadataURI) external",
    "function revokeCredential(uint256 tokenId) external",
    "function setZKPVerifier(address _zkpVerifier) external",
    // Read
    "function hasValidCredential(address holder, bytes32 claimType) external view returns (bool)",
    "function getCredential(uint256 tokenId) external view returns (tuple(address holder, bytes32 claimType, string claimLabel, string metadataURI, uint256 issuedAt, bool isRevoked))",
    "function getTokenByClaim(address holder, bytes32 claimType) external view returns (uint256)",
    "function balanceOf(address holder) external view returns (uint256)",
    "function ownerOf(uint256 tokenId) external view returns (address)",
    "function tokenURI(uint256 tokenId) external view returns (string)",
    "function totalSupply() external view returns (uint256)",
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    // Events
    "event CredentialMinted(address indexed holder, uint256 indexed tokenId, bytes32 indexed claimType, string claimLabel, uint256 timestamp)",
    "event CredentialRevoked(address indexed holder, uint256 indexed tokenId, bytes32 indexed claimType, uint256 timestamp)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parse a contract error into a clean human-readable string.
 * Handles MetaMask rejections, revert reasons, and network errors.
 */
function parseContractError(err) {
  if (!err) return "Unknown error.";

  // User rejected transaction in wallet
  if (err.code === 4001 || err.code === "ACTION_REJECTED") {
    return "Transaction rejected by user.";
  }

  // ethers v6 — extract revert reason
  if (err.revert?.args?.[0]) return `Contract reverted: ${err.revert.args[0]}`;

  // ethers v6 shortMessage
  if (err.shortMessage) return err.shortMessage;

  // ethers v6 — extract from error data
  if (err.data) {
    try {
      // Try to decode a custom error or revert string
      const decoded = ethers.toUtf8String("0x" + err.data.slice(138));
      if (decoded) return `Reverted: ${decoded.replace(/\0/g, "").trim()}`;
    } catch { /* not a UTF-8 revert message */ }
  }

  // Insufficient funds
  if (err.code === "INSUFFICIENT_FUNDS") return "Insufficient ETH for gas.";

  // Network errors
  if (err.code === "NETWORK_ERROR") return "Network error. Check your connection.";

  // Call exception (view function returned unexpected result)
  if (err.code === "CALL_EXCEPTION") return err.reason || "Call reverted without a reason.";

  // Fallback
  return err.reason || err.message || "Unexpected error.";
}

/**
 * Returns a new ethers.Contract instance given address + ABI + signer/provider.
 * Returns null if any argument is missing.
 */
function buildContract(address, abi, signerOrProvider) {
  if (!address || !abi || !signerOrProvider) return null;
  try {
    return new ethers.Contract(address, abi, signerOrProvider);
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 1 — useContract
//  Core hook. Returns a contract instance + a generic `call()` wrapper.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}               address          Contract address
 * @param {Array|string}         abi              ABI array or fragment strings
 * @param {Signer|Provider|null} signerOrProvider ethers signer (writes) or provider (reads)
 *
 * @returns {{
 *   contract: ethers.Contract | null,
 *   call: (method: string, ...args: any[]) => Promise<any>,
 *   loading: boolean,
 *   error: string | null,
 *   result: any,
 *   reset: () => void,
 * }}
 */
export function useContract(address, abi, signerOrProvider) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [result,  setResult]  = useState(null);

  // Memoise contract — only rebuilds when address/abi/signer actually change
  const contract = useMemo(
    () => buildContract(address, abi, signerOrProvider),
    [address, abi, signerOrProvider]
  );

  /**
   * Generic contract call wrapper.
   * Handles loading state, error parsing, and result storage.
   *
   * @param {string} method  The contract function name e.g. "registerDID"
   * @param {...any} args    Arguments forwarded to the function
   * @returns {Promise<any>} The return value of the contract call, or null on error
   *
   * @example
   *   const { call } = useContract(addr, abi, signer);
   *   const result = await call("registerDID", did, cid);
   */
  const call = useCallback(async (method, ...args) => {
    if (!contract) {
      setError("Contract not initialised. Check address, ABI, and provider.");
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await contract[method](...args);
      setResult(res);
      return res;
    } catch (err) {
      const msg = parseContractError(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [contract]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return { contract, call, loading, error, result, reset };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 2 — useContractRead
//  Fires a read-only call on mount and re-fires when `args` changes.
//  Returns { data, loading, error, refetch }.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}        address   Contract address
 * @param {Array}         abi       ABI array
 * @param {Provider|null} provider  ethers read-only provider
 * @param {string}        method    Contract view function name
 * @param {Array}         args      Arguments for the function (put in array)
 * @param {object}        options
 * @param {boolean}       options.skip          Skip the call entirely (useful for conditional reads)
 * @param {number}        options.refreshInterval  Re-poll every N ms (0 = no polling)
 *
 * @returns {{
 *   data: any,
 *   loading: boolean,
 *   error: string | null,
 *   refetch: () => void,
 * }}
 *
 * @example
 *   const { data: hasDID, loading } = useContractRead(
 *     registryAddr, DID_ABI, provider, "hasActiveDID", [address]
 *   );
 */
export function useContractRead(
  address,
  abi,
  provider,
  method,
  args    = [],
  options = {}
) {
  const { skip = false, refreshInterval = 0 } = options;

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(!skip);
  const [error,   setError]   = useState(null);

  // Stable ref to args so the effect doesn't re-fire on every render
  const argsRef = useRef(args);
  argsRef.current = args;

  const contract = useMemo(
    () => buildContract(address, abi, provider),
    [address, abi, provider]
  );

  const execute = useCallback(async () => {
    if (skip || !contract || !method) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await contract[method](...argsRef.current);
      setData(res);
    } catch (err) {
      setError(parseContractError(err));
    } finally {
      setLoading(false);
    }
  }, [contract, method, skip]);

  // Fire on mount + whenever execute changes (i.e. contract or method changes)
  // We use a JSON-serialised args key to also re-fire when args change
  const argsKey = JSON.stringify(args);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useRef(() => {}).current; // suppress lint — intentional

  // Effect: run on mount and when key deps change
  useState(() => { execute(); });

  // Use useRef + manual scheduling to avoid the exhaustive-deps ESLint warning
  // while still correctly re-running when args change
  const prevArgsKey = useRef(null);
  const { useEffect: _useEffect } = { useEffect: require };

  // Manual approach: just call useEffect from React import at top
  // We'll use a simpler pattern below:
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick(t => t + 1), []);

  // Main effect
  require("react").useEffect(() => {
    execute();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execute, argsKey, tick]);

  // Optional polling
  require("react").useEffect(() => {
    if (!refreshInterval || refreshInterval <= 0) return;
    const id = setInterval(() => setTick(t => t + 1), refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval]);

  return { data, loading, error, refetch };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 3 — useContractWrite
//  Wraps a state-changing contract call (sends a transaction).
//  Returns { write, loading, error, txHash, receipt, reset }.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}       address  Contract address
 * @param {Array}        abi      ABI array
 * @param {Signer|null}  signer   ethers.Signer from useWallet
 * @param {string}       method   Contract function name
 * @param {object}       options
 * @param {Function}     options.onSuccess(receipt)  called after tx confirmed
 * @param {Function}     options.onError(errorMsg)   called on error
 * @param {object}       options.overrides           tx overrides e.g. { gasLimit: 500000 }
 *
 * @returns {{
 *   write: (...args: any[]) => Promise<void>,
 *   loading: boolean,
 *   error: string | null,
 *   txHash: string | null,
 *   receipt: TransactionReceipt | null,
 *   reset: () => void,
 * }}
 *
 * @example
 *   const { write, loading, txHash, receipt } = useContractWrite(
 *     registryAddr, DID_ABI, signer, "registerDID",
 *     { onSuccess: (r) => console.log("Registered!", r.hash) }
 *   );
 *
 *   await write(did, cid);
 */
export function useContractWrite(
  address,
  abi,
  signer,
  method,
  options = {}
) {
  const { onSuccess, onError, overrides = {} } = options;

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [txHash,  setTxHash]  = useState(null);
  const [receipt, setReceipt] = useState(null);

  const contract = useMemo(
    () => buildContract(address, abi, signer),
    [address, abi, signer]
  );

  /**
   * Send the transaction.
   * @param {...any} args  Arguments forwarded to the contract function
   */
  const write = useCallback(async (...args) => {
    if (!contract) {
      const msg = "Contract not initialised. Ensure wallet is connected.";
      setError(msg);
      onError?.(msg);
      return;
    }

    setLoading(true);
    setError(null);
    setTxHash(null);
    setReceipt(null);

    try {
      // If overrides are provided, append them as the last argument
      const callArgs = Object.keys(overrides).length > 0
        ? [...args, overrides]
        : args;

      // Send transaction
      const tx = await contract[method](...callArgs);
      setTxHash(tx.hash);

      // Wait for 1 confirmation
      const rec = await tx.wait(1);
      setReceipt(rec);
      onSuccess?.(rec);
    } catch (err) {
      const msg = parseContractError(err);
      setError(msg);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  }, [contract, method, overrides, onSuccess, onError]);

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setTxHash(null);
    setReceipt(null);
  }, []);

  return { write, loading, error, txHash, receipt, reset };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 4 — useContractEvent
//  Subscribes to a contract event and collects logs.
//  Cleans up the listener on unmount automatically.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}        address    Contract address
 * @param {Array}         abi        ABI array
 * @param {Provider|null} provider   ethers provider
 * @param {string}        eventName  Event name e.g. "DIDRegistered"
 * @param {Function}      listener   Called with decoded event args on each emit
 * @param {object}        options
 * @param {number}        options.maxLogs  Max logs to keep in state (default 50)
 *
 * @returns {{
 *   logs: Array,
 *   loading: boolean,
 *   error: string | null,
 * }}
 *
 * @example
 *   useContractEvent(
 *     registryAddr, DID_ABI, provider, "DIDRegistered",
 *     (owner, did, cid, ts) => console.log("New DID:", did)
 *   );
 */
export function useContractEvent(
  address,
  abi,
  provider,
  eventName,
  listener,
  options = {}
) {
  const { maxLogs = 50 } = options;

  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const contract      = useMemo(() => buildContract(address, abi, provider), [address, abi, provider]);
  const listenerRef   = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => {
    if (!contract || !eventName) {
      setLoading(false);
      return;
    }

    setLoading(false);

    const handler = (...args) => {
      // Last arg from ethers v6 is the event object itself
      const eventObj = args[args.length - 1];
      const decodedArgs = args.slice(0, -1);

      const logEntry = {
        args:        decodedArgs,
        blockNumber: eventObj?.log?.blockNumber ?? null,
        txHash:      eventObj?.log?.transactionHash ?? null,
        ts:          Date.now(),
      };

      setLogs(prev => [logEntry, ...prev].slice(0, maxLogs));
      listenerRef.current?.(...decodedArgs);
    };

    try {
      contract.on(eventName, handler);
    } catch (err) {
      setError(parseContractError(err));
    }

    return () => {
      try { contract.off(eventName, handler); } catch { /* ignore */ }
    };
  }, [contract, eventName, maxLogs]);

  return { logs, loading, error };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 5 — useDIDRegistry
//  Project-specific convenience hook. Pre-wires all DIDRegistry calls
//  so components don't even need to know the ABI.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}        address   DIDRegistry contract address
 * @param {Signer|null}   signer    From useWallet (for writes)
 * @param {Provider|null} provider  From useWallet (for reads)
 * @param {string|null}   userAddr  Connected wallet address
 *
 * @returns {{
 *   // Reads (auto-fetched)
 *   hasDID:   boolean,
 *   didDoc:   object | null,
 *   totalDIDs: number | null,
 *   readLoading: boolean,
 *   readError:   string | null,
 *   refetch:     () => void,
 *
 *   // Writes
 *   register:   (did, cid) => Promise<void>,
 *   update:     (newCid)   => Promise<void>,
 *   deactivate: ()         => Promise<void>,
 *   writeLoading: boolean,
 *   writeError:   string | null,
 *   txHash:       string | null,
 *   receipt:      object | null,
 *   resetWrite:   () => void,
 * }}
 */
export function useDIDRegistry(address, signer, provider, userAddr) {

  // ── Reads ───────────────────────────────────────────────────────────────
  const {
    data:    hasActiveDID,
    loading: readLoading,
    error:   readError,
    refetch,
  } = useContractRead(
    address,
    CONTRACT_ABIS.DIDRegistry,
    provider,
    "hasActiveDID",
    [userAddr],
    { skip: !userAddr || !address }
  );

  const {
    data: didDoc,
    refetch: refetchDoc,
  } = useContractRead(
    address,
    CONTRACT_ABIS.DIDRegistry,
    provider,
    "resolveDID",
    [userAddr],
    { skip: !userAddr || !hasActiveDID || !address }
  );

  const {
    data: totalDIDsRaw,
  } = useContractRead(
    address,
    CONTRACT_ABIS.DIDRegistry,
    provider,
    "totalDIDs",
    [],
    { skip: !address, refreshInterval: 30_000 }
  );

  // ── Writes ──────────────────────────────────────────────────────────────
  const {
    write: _register,
    loading: writeLoading,
    error:   writeError,
    txHash,
    receipt,
    reset:   resetWrite,
  } = useContractWrite(
    address,
    CONTRACT_ABIS.DIDRegistry,
    signer,
    "registerDID",
    {
      onSuccess: () => { refetch(); refetchDoc(); },
    }
  );

  const { write: _update } = useContractWrite(
    address, CONTRACT_ABIS.DIDRegistry, signer, "updateDID",
    { onSuccess: refetchDoc }
  );

  const { write: _deactivate } = useContractWrite(
    address, CONTRACT_ABIS.DIDRegistry, signer, "deactivateDID",
    { onSuccess: refetch }
  );

  return {
    // Reads
    hasDID:      Boolean(hasActiveDID),
    didDoc:      didDoc ? {
      did:       didDoc.did,
      ipfsCID:   didDoc.ipfsCID,
      createdAt: Number(didDoc.createdAt),
      updatedAt: Number(didDoc.updatedAt),
      isActive:  didDoc.isActive,
    } : null,
    totalDIDs:   totalDIDsRaw ? Number(totalDIDsRaw) : null,
    readLoading,
    readError,
    refetch: () => { refetch(); refetchDoc(); },

    // Writes
    register:    (did, cid) => _register(did, cid),
    update:      (newCid)   => _update(newCid),
    deactivate:  ()         => _deactivate(),
    writeLoading,
    writeError,
    txHash,
    receipt,
    resetWrite,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 6 — useZKPVerifier
//  Project-specific convenience hook for ZKPVerifier interactions.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}        address   ZKPVerifier contract address
 * @param {Signer|null}   signer    From useWallet
 * @param {Provider|null} provider  From useWallet
 * @param {string|null}   userAddr  Connected wallet address
 *
 * @returns {{
 *   hasClaim:    (claimType: string) => boolean,
 *   getClaim:    (claimType: string) => object | null,
 *   verifyProof: (claimType, pi_a, pi_b, pi_c, publicSignals, nullifier) => Promise<void>,
 *   loading:     boolean,
 *   error:       string | null,
 *   txHash:      string | null,
 *   receipt:     object | null,
 *   reset:       () => void,
 * }}
 */
export function useZKPVerifier(address, signer, provider, userAddr) {

  // Cache of claims: claimTypeHex → { has, verifiedAt, isValid }
  const [claimCache, setClaimCache] = useState({});

  const {
    write:   _verifyProof,
    loading: writeLoading,
    error:   writeError,
    txHash,
    receipt,
    reset,
  } = useContractWrite(
    address,
    CONTRACT_ABIS.ZKPVerifier,
    signer,
    "verifyProof",
    {
      onSuccess: async (rec) => {
        // After proof verification, re-fetch claims for all known types
        if (!provider || !userAddr || !address) return;
        const contract = buildContract(address, CONTRACT_ABIS.ZKPVerifier, provider);
        if (!contract) return;

        const updated = {};
        for (const [key, val] of Object.entries(claimCache)) {
          try {
            const has = await contract.hasClaim(userAddr, key);
            if (has) {
              const data = await contract.getClaim(userAddr, key);
              updated[key] = { has: true, verifiedAt: Number(data.verifiedAt), isValid: data.isValid };
            } else {
              updated[key] = { has: false };
            }
          } catch { updated[key] = val; }
        }
        setClaimCache(updated);
      },
    }
  );

  /**
   * Check if user has a verified claim.
   * Hits the cache first — call refreshClaims() to update from chain.
   */
  const hasClaim = useCallback((claimType) => {
    return Boolean(claimCache[claimType]?.has);
  }, [claimCache]);

  const getClaim = useCallback((claimType) => {
    return claimCache[claimType] ?? null;
  }, [claimCache]);

  /**
   * Fetch fresh claim data for a list of claimType bytes32 strings.
   * @param {string[]} claimTypes  Array of keccak256 claim type hashes
   */
  const refreshClaims = useCallback(async (claimTypes = []) => {
    if (!provider || !userAddr || !address) return;
    const contract = buildContract(address, CONTRACT_ABIS.ZKPVerifier, provider);
    if (!contract) return;

    const updated = {};
    for (const ct of claimTypes) {
      try {
        const has = await contract.hasClaim(userAddr, ct);
        if (has) {
          const data = await contract.getClaim(userAddr, ct);
          updated[ct] = { has: true, verifiedAt: Number(data.verifiedAt), isValid: data.isValid };
        } else {
          updated[ct] = { has: false };
        }
      } catch { /* skip failed claims */ }
    }
    setClaimCache(prev => ({ ...prev, ...updated }));
  }, [address, provider, userAddr]);

  return {
    hasClaim,
    getClaim,
    refreshClaims,
    verifyProof: (...args) => _verifyProof(...args),
    loading:     writeLoading,
    error:       writeError,
    txHash,
    receipt,
    reset,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  HOOK 7 — useCredentialNFT
//  Project-specific convenience hook for CredentialNFT interactions.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string}        address   CredentialNFT contract address
 * @param {Signer|null}   signer    From useWallet
 * @param {Provider|null} provider  From useWallet
 * @param {string|null}   userAddr  Connected wallet address
 *
 * @returns {{
 *   balance:    number,
 *   totalSupply: number,
 *   getToken:   (claimType: string) => number,
 *   hasCredential: (claimType: string) => boolean,
 *   mint:       (claimType: string) => Promise<void>,
 *   loading:    boolean,
 *   error:      string | null,
 *   txHash:     string | null,
 *   receipt:    object | null,
 *   reset:      () => void,
 *   refetch:    () => void,
 * }}
 */
export function useCredentialNFT(address, signer, provider, userAddr) {

  const [tokenMap,   setTokenMap]   = useState({}); // claimType → tokenId
  const [credMap,    setCredMap]    = useState({}); // tokenId → credential data
  const [balance,    setBalance]    = useState(0);
  const [totalSupply, setTotalSupply] = useState(0);

  // ── Read: balance + totalSupply ─────────────────────────────────────────
  const { data: rawBalance, refetch: refetchBalance } = useContractRead(
    address, CONTRACT_ABIS.CredentialNFT, provider,
    "balanceOf", [userAddr],
    { skip: !userAddr || !address, refreshInterval: 20_000 }
  );

  const { data: rawSupply, refetch: refetchSupply } = useContractRead(
    address, CONTRACT_ABIS.CredentialNFT, provider,
    "totalSupply", [],
    { skip: !address, refreshInterval: 20_000 }
  );

  useEffect(() => {
    if (rawBalance !== null && rawBalance !== undefined) setBalance(Number(rawBalance));
  }, [rawBalance]);

  useEffect(() => {
    if (rawSupply !== null && rawSupply !== undefined) setTotalSupply(Number(rawSupply));
  }, [rawSupply]);

  // ── Write: mint ─────────────────────────────────────────────────────────
  const {
    write:   _mint,
    loading: writeLoading,
    error:   writeError,
    txHash,
    receipt,
    reset,
  } = useContractWrite(
    address, CONTRACT_ABIS.CredentialNFT, signer, "mintCredential",
    {
      onSuccess: (rec) => {
        refetchBalance();
        refetchSupply();
        // Parse tokenId from Transfer event in receipt
        const iface  = new ethers.Interface([
          "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
        ]);
        for (const log of rec.logs) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === "Transfer") {
              const tid = Number(parsed.args.tokenId);
              setTokenMap(prev => ({ ...prev, [_lastMintedClaimType.current]: tid }));
              break;
            }
          } catch { /* not a Transfer log */ }
        }
      },
    }
  );

  // Track which claimType was last minted so onSuccess can update the map
  const _lastMintedClaimType = useRef(null);

  /**
   * Refresh token IDs and credential data for a list of claimTypes.
   * @param {string[]} claimTypes  Array of bytes32 claim type strings
   */
  const refreshCredentials = useCallback(async (claimTypes = []) => {
    if (!provider || !userAddr || !address) return;
    const contract = buildContract(address, CONTRACT_ABIS.CredentialNFT, provider);
    if (!contract) return;

    const updatedTokens = {};
    const updatedCreds  = {};

    for (const ct of claimTypes) {
      try {
        const tokenId = await contract.getTokenByClaim(userAddr, ct);
        const tid = Number(tokenId);
        if (tid > 0) {
          updatedTokens[ct] = tid;
          const cred = await contract.getCredential(tid);
          updatedCreds[tid] = {
            holder:      cred.holder,
            claimType:   cred.claimType,
            claimLabel:  cred.claimLabel,
            metadataURI: cred.metadataURI,
            issuedAt:    Number(cred.issuedAt),
            isRevoked:   cred.isRevoked,
          };
        }
      } catch { /* claim not found */ }
    }

    setTokenMap(prev  => ({ ...prev, ...updatedTokens }));
    setCredMap(prev   => ({ ...prev, ...updatedCreds  }));
  }, [address, provider, userAddr]);

  const mint = useCallback(async (claimType) => {
    _lastMintedClaimType.current = claimType;
    await _mint(claimType);
  }, [_mint]);

  const getToken       = useCallback((ct) => tokenMap[ct] ?? 0,         [tokenMap]);
  const hasCredential  = useCallback((ct) => Boolean(tokenMap[ct] > 0), [tokenMap]);
  const getCredential  = useCallback((ct) => {
    const tid = tokenMap[ct];
    return tid ? credMap[tid] ?? null : null;
  }, [tokenMap, credMap]);

  const refetch = useCallback(() => {
    refetchBalance();
    refetchSupply();
  }, [refetchBalance, refetchSupply]);

  return {
    balance,
    totalSupply,
    getToken,
    hasCredential,
    getCredential,
    refreshCredentials,
    mint,
    loading:  writeLoading,
    error:    writeError,
    txHash,
    receipt,
    reset,
    refetch,
  };
}

// ── Named re-exports for convenience ──────────────────────────────────────────
export { parseContractError };

// ── Default export: bundle of all hooks ───────────────────────────────────────
export default {
  useContract,
  useContractRead,
  useContractWrite,
  useContractEvent,
  useDIDRegistry,
  useZKPVerifier,
  useCredentialNFT,
  CONTRACT_ABIS,
  CHAIN_IDS,
};
