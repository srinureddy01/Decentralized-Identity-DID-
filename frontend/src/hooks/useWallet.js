import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

/**
 * useWallet.js
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/hooks/useWallet.js
 *
 * Custom React hook that fully manages wallet connection state.
 * Wraps ethers.js BrowserProvider + MetaMask (or any injected EIP-1193
 * wallet) so every component in the app shares one consistent source
 * of truth — no prop drilling, no duplicate event listeners.
 *
 * ── WHAT IT HANDLES ──────────────────────────────────────────────────────
 *  • Detecting whether an injected wallet exists
 *  • Auto-reconnecting silently on page load if already authorised
 *  • Requesting wallet connection (triggers MetaMask popup)
 *  • Network detection + one-click switch to the required chain
 *  • Listening to accountsChanged / chainChanged events
 *  • Disconnecting cleanly
 *  • Exposing provider, signer, address, chainId, and ENS name
 *  • Tracking connection status with a granular status enum
 *  • Surfacing human-readable error messages
 *
 * ── USAGE ────────────────────────────────────────────────────────────────
 *
 *  import { useWallet } from "../hooks/useWallet";
 *
 *  function App() {
 *    const wallet = useWallet({ requiredChainId: 11155111 });
 *
 *    if (wallet.status === "connected") {
 *      console.log(wallet.address);   // "0xAbCd…"
 *      console.log(wallet.chainId);   // 11155111
 *      // wallet.signer  → ethers.Signer (use for write txs)
 *      // wallet.provider → ethers.BrowserProvider (use for reads)
 *    }
 *
 *    return (
 *      <button onClick={wallet.connect}>Connect</button>
 *    );
 *  }
 *
 * ── RETURNED OBJECT ──────────────────────────────────────────────────────
 *
 *  {
 *    // State
 *    status       "idle" | "connecting" | "connected" |
 *                 "wrong_network" | "error" | "no_wallet"
 *    address      string | null          checksummed wallet address
 *    chainId      number | null          current chain ID
 *    provider     BrowserProvider | null use for read-only calls
 *    signer       JsonRpcSigner | null   use for write transactions
 *    ensName      string | null          ENS name if resolved
 *    balance      string | null          ETH balance formatted (e.g. "0.42")
 *    error        string | null          human-readable error message
 *    isConnected  boolean                shorthand for status==="connected"
 *    isWrongNet   boolean                shorthand for status==="wrong_network"
 *    hasWallet    boolean                true if window.ethereum exists
 *
 *    // Actions
 *    connect()         request wallet connection
 *    disconnect()      clear all wallet state
 *    switchNetwork()   switch to requiredChainId
 *    refreshBalance()  re-fetch ETH balance
 *    signMessage(msg)  sign an arbitrary message → signature string
 *  }
 *
 * ── OPTIONS ──────────────────────────────────────────────────────────────
 *
 *  useWallet({
 *    requiredChainId: 11155111,   // enforce Sepolia (default)
 *    autoConnect:     true,       // silently reconnect on load (default)
 *    watchBalance:    true,       // poll balance every 15s (default)
 *  })
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const CHAIN_IDS = {
  MAINNET:       1,
  SEPOLIA:       11155111,
  POLYGON:       137,
  MUMBAI:        80001,
  HARDHAT_LOCAL: 31337,
};

const CHAIN_PARAMS = {
  [CHAIN_IDS.SEPOLIA]: {
    chainId:           "0xaa36a7",
    chainName:         "Sepolia Testnet",
    nativeCurrency:    { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
    rpcUrls:           ["https://rpc.sepolia.org"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
  },
  [CHAIN_IDS.POLYGON]: {
    chainId:           "0x89",
    chainName:         "Polygon Mainnet",
    nativeCurrency:    { name: "MATIC", symbol: "MATIC", decimals: 18 },
    rpcUrls:           ["https://polygon-rpc.com"],
    blockExplorerUrls: ["https://polygonscan.com"],
  },
  [CHAIN_IDS.MUMBAI]: {
    chainId:           "0x13881",
    chainName:         "Polygon Mumbai Testnet",
    nativeCurrency:    { name: "MATIC", symbol: "MATIC", decimals: 18 },
    rpcUrls:           ["https://rpc-mumbai.maticvigil.com"],
    blockExplorerUrls: ["https://mumbai.polygonscan.com"],
  },
};

export const WALLET_STATUS = {
  IDLE:          "idle",
  CONNECTING:    "connecting",
  CONNECTED:     "connected",
  WRONG_NETWORK: "wrong_network",
  ERROR:         "error",
  NO_WALLET:     "no_wallet",
};

const CHAIN_NAMES = {
  1:       "Ethereum Mainnet",
  11155111:"Sepolia Testnet",
  137:     "Polygon",
  80001:   "Mumbai Testnet",
  31337:   "Hardhat Local",
};

const BALANCE_POLL_MS = 15_000; // 15 seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseError(err) {
  if (!err) return "Unknown error.";
  // MetaMask user rejection
  if (err.code === 4001 || err.code === "ACTION_REJECTED") return "Connection cancelled by user.";
  // Already pending
  if (err.code === -32002) return "A connection request is already pending in your wallet.";
  // No wallet
  if (err.code === -32603) return "Internal wallet error. Try reloading.";
  // Generic
  return err.reason || err.message || "Unknown error.";
}

function chainIdToHex(id) {
  return "0x" + id.toString(16);
}

async function resolveENS(provider, address) {
  try {
    const name = await provider.lookupAddress(address);
    return name;
  } catch {
    return null;
  }
}

async function fetchBalance(provider, address) {
  try {
    const raw = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(raw)).toFixed(4);
  } catch {
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useWallet({
  requiredChainId = CHAIN_IDS.SEPOLIA,
  autoConnect     = true,
  watchBalance    = true,
} = {}) {

  const [status,   setStatus]   = useState(WALLET_STATUS.IDLE);
  const [address,  setAddress]  = useState(null);
  const [chainId,  setChainId]  = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer,   setSigner]   = useState(null);
  const [ensName,  setEnsName]  = useState(null);
  const [balance,  setBalance]  = useState(null);
  const [error,    setError]    = useState(null);

  // Stable ref to avoid stale closures in event listeners
  const stateRef = useRef({});
  stateRef.current = { address, chainId, requiredChainId };

  // ── Core: build provider + signer from a given account ─────────────────────
  const _buildSession = useCallback(async (account) => {
    if (!window.ethereum) return;

    try {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer   = await _provider.getSigner();
      const network   = await _provider.getNetwork();
      const _chainId  = Number(network.chainId);

      setProvider(_provider);
      setSigner(_signer);
      setAddress(account);
      setChainId(_chainId);
      setError(null);

      // Determine status
      if (_chainId !== requiredChainId) {
        setStatus(WALLET_STATUS.WRONG_NETWORK);
      } else {
        setStatus(WALLET_STATUS.CONNECTED);
      }

      // Fetch balance + ENS in background (non-blocking)
      fetchBalance(_provider, account).then(setBalance);
      // ENS only available on mainnet — skip on testnets
      if (_chainId === CHAIN_IDS.MAINNET) {
        resolveENS(_provider, account).then(setEnsName);
      }

    } catch (err) {
      setError(parseError(err));
      setStatus(WALLET_STATUS.ERROR);
    }
  }, [requiredChainId]);

  // ── Teardown: clear all state ───────────────────────────────────────────────
  const _clearSession = useCallback(() => {
    setStatus(WALLET_STATUS.IDLE);
    setAddress(null);
    setChainId(null);
    setProvider(null);
    setSigner(null);
    setEnsName(null);
    setBalance(null);
    setError(null);
  }, []);

  // ── Auto-connect on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!autoConnect) return;
    if (!window.ethereum) {
      setStatus(WALLET_STATUS.NO_WALLET);
      return;
    }

    // eth_accounts does NOT trigger a popup — just checks if already authorised
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (accounts && accounts.length > 0) {
          _buildSession(accounts[0]);
        }
      })
      .catch(() => {});
  }, [autoConnect, _buildSession]);

  // ── accountsChanged listener ────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        // User disconnected all accounts in MetaMask
        _clearSession();
      } else if (accounts[0] !== stateRef.current.address) {
        // User switched to a different account
        _buildSession(accounts[0]);
      }
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    return () => window.ethereum.removeListener("accountsChanged", onAccountsChanged);
  }, [_buildSession, _clearSession]);

  // ── chainChanged listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const onChainChanged = (hexChainId) => {
      const newChainId = parseInt(hexChainId, 16);
      setChainId(newChainId);

      // Rebuild provider/signer for new network — don't reload page
      if (stateRef.current.address) {
        _buildSession(stateRef.current.address);
      }
    };

    window.ethereum.on("chainChanged", onChainChanged);
    return () => window.ethereum.removeListener("chainChanged", onChainChanged);
  }, [_buildSession]);

  // ── Balance polling ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!watchBalance) return;
    if (!address || !provider) return;

    const interval = setInterval(() => {
      fetchBalance(provider, address).then(setBalance);
    }, BALANCE_POLL_MS);

    return () => clearInterval(interval);
  }, [watchBalance, address, provider]);

  // ── PUBLIC ACTION: connect ──────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setStatus(WALLET_STATUS.NO_WALLET);
      setError("No wallet detected. Install MetaMask to continue.");
      return;
    }

    setStatus(WALLET_STATUS.CONNECTING);
    setError(null);

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (!accounts || accounts.length === 0) {
        throw new Error("No accounts returned.");
      }

      await _buildSession(accounts[0]);
    } catch (err) {
      setError(parseError(err));
      setStatus(WALLET_STATUS.ERROR);
    }
  }, [_buildSession]);

  // ── PUBLIC ACTION: disconnect ───────────────────────────────────────────────
  const disconnect = useCallback(() => {
    _clearSession();
  }, [_clearSession]);

  // ── PUBLIC ACTION: switchNetwork ────────────────────────────────────────────
  const switchNetwork = useCallback(async (targetChainId = requiredChainId) => {
    if (!window.ethereum) return;

    const hexId = chainIdToHex(targetChainId);

    try {
      // Try switching first
      await window.ethereum.request({
        method:  "wallet_switchEthereumChain",
        params:  [{ chainId: hexId }],
      });
    } catch (switchErr) {
      // Error 4902 = chain not added to MetaMask yet
      if (switchErr.code === 4902) {
        const params = CHAIN_PARAMS[targetChainId];
        if (!params) {
          setError(`No chain params found for chainId ${targetChainId}. Add it manually to MetaMask.`);
          return;
        }
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [params],
          });
        } catch (addErr) {
          setError(parseError(addErr));
          setStatus(WALLET_STATUS.ERROR);
        }
      } else if (switchErr.code !== 4001) {
        // 4001 = user rejected switch — don't show error for that
        setError(parseError(switchErr));
        setStatus(WALLET_STATUS.ERROR);
      }
    }
  }, [requiredChainId]);

  // ── PUBLIC ACTION: refreshBalance ───────────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (!provider || !address) return;
    const bal = await fetchBalance(provider, address);
    setBalance(bal);
  }, [provider, address]);

  // ── PUBLIC ACTION: signMessage ──────────────────────────────────────────────
  /**
   * Sign an arbitrary UTF-8 message with the connected wallet.
   * Returns the hex signature string, or null on error.
   *
   * Useful for:
   * - Proving wallet ownership without a transaction
   * - Off-chain authentication (SIWE — Sign-In With Ethereum)
   * - Generating deterministic secrets from wallet signature
   *
   * @param {string} message
   * @returns {Promise<string|null>}
   */
  const signMessage = useCallback(async (message) => {
    if (!signer) {
      setError("Wallet not connected.");
      return null;
    }
    try {
      const signature = await signer.signMessage(message);
      return signature;
    } catch (err) {
      setError(parseError(err));
      return null;
    }
  }, [signer]);

  // ── Derived convenience booleans ────────────────────────────────────────────
  const isConnected = status === WALLET_STATUS.CONNECTED;
  const isWrongNet  = status === WALLET_STATUS.WRONG_NETWORK;
  const hasWallet   = typeof window !== "undefined" && !!window.ethereum;

  // ── Chain info helpers ──────────────────────────────────────────────────────
  const chainName         = chainId ? (CHAIN_NAMES[chainId] || `Chain ${chainId}`) : null;
  const requiredChainName = CHAIN_NAMES[requiredChainId] || `Chain ${requiredChainId}`;

  // ─────────────────────────────────────────────────────────────────────────────
  return {
    // ── State ──────────────────────────────────────────────────────────────
    status,
    address,
    chainId,
    chainName,
    requiredChainId,
    requiredChainName,
    provider,
    signer,
    ensName,
    balance,
    error,

    // ── Convenience booleans ───────────────────────────────────────────────
    isConnected,
    isWrongNet,
    hasWallet,
    isLoading: status === WALLET_STATUS.CONNECTING,

    // ── Actions ────────────────────────────────────────────────────────────
    connect,
    disconnect,
    switchNetwork,
    refreshBalance,
    signMessage,
  };
}

/**
 * ── SECONDARY EXPORT: useWalletRequired ──────────────────────────────────────
 *
 * Variant of useWallet that automatically triggers the connection flow
 * when the component mounts, instead of waiting for the user to click.
 * Useful for pages that require a wallet to function at all.
 *
 * Usage:
 *   const wallet = useWalletRequired({ requiredChainId: 11155111 });
 */
export function useWalletRequired(options = {}) {
  const wallet = useWallet(options);

  useEffect(() => {
    if (wallet.status === WALLET_STATUS.IDLE && wallet.hasWallet) {
      wallet.connect();
    }
  }, [wallet.status, wallet.hasWallet]);

  return wallet;
}

/**
 * ── SECONDARY EXPORT: useWalletStatus ────────────────────────────────────────
 *
 * Lightweight hook that returns only the status string and address.
 * Use in header/nav components that just need to show connected state
 * without subscribing to all the heavier state updates.
 *
 * Usage:
 *   const { status, address } = useWalletStatus();
 */
export function useWalletStatus() {
  const [status,  setStatus]  = useState(WALLET_STATUS.IDLE);
  const [address, setAddress] = useState(null);

  useEffect(() => {
    if (!window.ethereum) {
      setStatus(WALLET_STATUS.NO_WALLET);
      return;
    }

    window.ethereum.request({ method: "eth_accounts" }).then((accounts) => {
      if (accounts?.length > 0) {
        setAddress(accounts[0]);
        setStatus(WALLET_STATUS.CONNECTED);
      }
    }).catch(() => {});

    const onChange = (accounts) => {
      if (!accounts?.length) {
        setAddress(null);
        setStatus(WALLET_STATUS.IDLE);
      } else {
        setAddress(accounts[0]);
        setStatus(WALLET_STATUS.CONNECTED);
      }
    };

    window.ethereum.on("accountsChanged", onChange);
    return () => window.ethereum.removeListener("accountsChanged", onChange);
  }, []);

  return { status, address, isConnected: status === WALLET_STATUS.CONNECTED };
}
