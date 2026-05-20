 import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";

/*
 * ConnectWallet.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/components/ConnectWallet.jsx
 *
 * Handles:
 *  - MetaMask / injected wallet detection
 *  - Wallet connection + account switching
 *  - Network detection + switching to Sepolia testnet
 *  - Disconnection
 *  - Passes { provider, signer, address, chainId } up via onConnect callback
 *
 * Props:
 *  onConnect(walletData)  called when wallet connects successfully
 *                         walletData = { provider, signer, address, chainId }
 *  onDisconnect()         called when wallet disconnects
 *  className              optional extra CSS class on root element
 *
 * Usage:
 *  <ConnectWallet
 *    onConnect={(data) => setWallet(data)}
 *    onDisconnect={() => setWallet(null)}
 *  />
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const SEPOLIA_CHAIN_ID  = "0xaa36a7";   // 11155111 in hex
const SEPOLIA_CHAIN_INT = 11155111;

const SEPOLIA_PARAMS = {
  chainId:         SEPOLIA_CHAIN_ID,
  chainName:       "Sepolia Testnet",
  nativeCurrency:  { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
  rpcUrls:         ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

// Wallet connection states
const STATE = {
  IDLE:        "idle",
  CONNECTING:  "connecting",
  CONNECTED:   "connected",
  WRONG_NET:   "wrong_network",
  ERROR:       "error",
  NO_WALLET:   "no_wallet",
};

// ── HELPERS ──────────────────────────────────────────────────────────────────
function shortenAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getChainName(chainId) {
  const chains = {
    1:        "Ethereum Mainnet",
    11155111: "Sepolia Testnet",
    137:      "Polygon",
    80001:    "Mumbai Testnet",
    31337:    "Hardhat Local",
  };
  return chains[chainId] || `Chain ${chainId}`;
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function ConnectWallet({ onConnect, onDisconnect, className = "" }) {
  const [status,  setStatus]  = useState(STATE.IDLE);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [error,   setError]   = useState(null);
  const [copied,  setCopied]  = useState(false);

  // ── Auto-reconnect on mount if already connected ──────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    // Check if already authorised (no popup)
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (accounts.length > 0) _finalise(accounts[0]);
      })
      .catch(() => {});
  }, []);

  // ── Listen for account / chain changes ───────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const onAccountsChanged = (accounts) => {
      if (accounts.length === 0) {
        _disconnect();
      } else {
        _finalise(accounts[0]);
      }
    };

    const onChainChanged = () => {
      // Reload is the safest approach recommended by MetaMask
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged",    onChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged",    onChainChanged);
    };
  }, []);

  // ── Core: finalise connection ─────────────────────────────────────────────
  const _finalise = useCallback(async (account) => {
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();
      const network  = await provider.getNetwork();
      const cid      = Number(network.chainId);

      setAddress(account);
      setChainId(cid);

      if (cid !== SEPOLIA_CHAIN_INT) {
        setStatus(STATE.WRONG_NET);
        return;
      }

      setStatus(STATE.CONNECTED);
      setError(null);

      onConnect?.({ provider, signer, address: account, chainId: cid });
    } catch (err) {
      setError(err.message);
      setStatus(STATE.ERROR);
    }
  }, [onConnect]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    if (!window.ethereum) {
      setStatus(STATE.NO_WALLET);
      return;
    }

    setStatus(STATE.CONNECTING);
    setError(null);

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      await _finalise(accounts[0]);
    } catch (err) {
      if (err.code === 4001) {
        // User rejected the request
        setError("Connection cancelled.");
      } else {
        setError(err.message);
      }
      setStatus(STATE.ERROR);
    }
  }, [_finalise]);

  // ── Switch to Sepolia ─────────────────────────────────────────────────────
  const handleSwitchNetwork = useCallback(async () => {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_ID }],
      });
    } catch (err) {
      // Chain not added yet — add it
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [SEPOLIA_PARAMS],
          });
        } catch (addErr) {
          setError(addErr.message);
          setStatus(STATE.ERROR);
        }
      } else {
        setError(err.message);
        setStatus(STATE.ERROR);
      }
    }
  }, []);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const _disconnect = useCallback(() => {
    setStatus(STATE.IDLE);
    setAddress(null);
    setChainId(null);
    setError(null);
    onDisconnect?.();
  }, [onDisconnect]);

  // ── Copy address ──────────────────────────────────────────────────────────
  const handleCopy = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [address]);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className={`cw-root ${className}`} data-status={status}>

      {/* ── IDLE / ERROR / NO_WALLET ── */}
      {(status === STATE.IDLE ||
        status === STATE.ERROR ||
        status === STATE.NO_WALLET) && (
        <div className="cw-panel cw-panel--idle">
          <div className="cw-logo">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M9 20L13 12L16 18L19 14L23 20" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="cw-brand">DID Protocol</span>
          </div>

          <p className="cw-tagline">
            Own your identity.<br/>No middlemen.
          </p>

          {status === STATE.NO_WALLET && (
            <div className="cw-notice cw-notice--warn">
              <span className="cw-notice__icon">⚠</span>
              No wallet detected. Install{" "}
              <a href="https://metamask.io" target="_blank" rel="noreferrer">
                MetaMask
              </a>{" "}
              to continue.
            </div>
          )}

          {status === STATE.ERROR && error && (
            <div className="cw-notice cw-notice--error">
              <span className="cw-notice__icon">✕</span>
              {error}
            </div>
          )}

          <button
            className="cw-btn cw-btn--primary"
            onClick={handleConnect}
            disabled={status === STATE.NO_WALLET}
          >
            <WalletIcon />
            Connect Wallet
          </button>

          <p className="cw-hint">
            Supports MetaMask and any injected EVM wallet
          </p>
        </div>
      )}

      {/* ── CONNECTING ── */}
      {status === STATE.CONNECTING && (
        <div className="cw-panel cw-panel--connecting">
          <div className="cw-spinner" aria-label="Connecting…">
            <span /><span /><span />
          </div>
          <p className="cw-connecting-text">
            Check your wallet&hellip;
          </p>
          <p className="cw-hint">Approve the connection request in MetaMask</p>
        </div>
      )}

      {/* ── WRONG NETWORK ── */}
      {status === STATE.WRONG_NET && (
        <div className="cw-panel cw-panel--wrongnet">
          <div className="cw-wrongnet-icon">⛓</div>
          <p className="cw-wrongnet-title">Wrong Network</p>
          <p className="cw-hint">
            Connected to <strong>{getChainName(chainId)}</strong>.
            <br />This app requires Sepolia Testnet.
          </p>
          <button className="cw-btn cw-btn--primary" onClick={handleSwitchNetwork}>
            Switch to Sepolia
          </button>
          <button className="cw-btn cw-btn--ghost" onClick={_disconnect}>
            Disconnect
          </button>
        </div>
      )}

      {/* ── CONNECTED ── */}
      {status === STATE.CONNECTED && (
        <div className="cw-panel cw-panel--connected">
          <div className="cw-badge">
            <div className="cw-badge__dot" aria-label="Connected" />
            <span className="cw-badge__label">Connected</span>
            <span className="cw-badge__network">{getChainName(chainId)}</span>
          </div>

          <div className="cw-address-row">
            <div className="cw-avatar">
              {/* Deterministic colour avatar from address */}
              <svg width="36" height="36" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="18"
                  fill={`hsl(${parseInt(address?.slice(2, 4) || "0", 16) * 1.4}, 65%, 55%)`}
                />
                <text x="18" y="23" textAnchor="middle"
                  fontSize="14" fill="white" fontWeight="700">
                  {address?.slice(2, 4).toUpperCase()}
                </text>
              </svg>
            </div>

            <div className="cw-address-info">
              <span className="cw-address-short">{shortenAddress(address)}</span>
              <span className="cw-address-full">{address}</span>
            </div>

            <button
              className="cw-icon-btn"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy address"}
              aria-label="Copy address"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>

          <button className="cw-btn cw-btn--ghost cw-btn--sm" onClick={_disconnect}>
            Disconnect
          </button>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ── ICON COMPONENTS ───────────────────────────────────────────────────────────
function WalletIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/>
      <path d="M1 10h22"/>
      <circle cx="17" cy="15" r="1" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const CSS = `
  /* ── tokens ─────────────────────────────────────────────────────────────── */
  .cw-root {
    --cw-bg:          #0d0d0f;
    --cw-surface:     #131316;
    --cw-border:      rgba(255,255,255,0.08);
    --cw-border-hi:   rgba(255,255,255,0.18);
    --cw-accent:      #4ade80;
    --cw-accent-dim:  rgba(74,222,128,0.12);
    --cw-warn:        #facc15;
    --cw-error:       #f87171;
    --cw-text:        #f4f4f5;
    --cw-muted:       #71717a;
    --cw-radius:      14px;
    --cw-font:        'IBM Plex Mono', 'Fira Code', monospace;

    display:          inline-block;
    font-family:      var(--cw-font);
    color:            var(--cw-text);
  }

  /* ── panel wrapper ───────────────────────────────────────────────────────── */
  .cw-panel {
    background:    var(--cw-surface);
    border:        1px solid var(--cw-border);
    border-radius: var(--cw-radius);
    padding:       28px 24px;
    width:         320px;
    display:       flex;
    flex-direction: column;
    gap:           16px;
    position:      relative;
    overflow:      hidden;
    transition:    border-color 0.25s;
  }
  .cw-panel::before {
    content:    '';
    position:   absolute;
    inset:      0;
    background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(74,222,128,0.05), transparent);
    pointer-events: none;
  }
  .cw-panel:hover {
    border-color: var(--cw-border-hi);
  }

  /* ── brand row ───────────────────────────────────────────────────────────── */
  .cw-logo {
    display:     flex;
    align-items: center;
    gap:         10px;
    color:       var(--cw-accent);
  }
  .cw-brand {
    font-size:   13px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* ── tagline ─────────────────────────────────────────────────────────────── */
  .cw-tagline {
    margin:      0;
    font-size:   20px;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color:       var(--cw-text);
  }

  /* ── hint text ───────────────────────────────────────────────────────────── */
  .cw-hint {
    margin:    0;
    font-size: 11px;
    color:     var(--cw-muted);
    line-height: 1.5;
  }

  /* ── notices ─────────────────────────────────────────────────────────────── */
  .cw-notice {
    display:       flex;
    align-items:   flex-start;
    gap:           8px;
    padding:       10px 12px;
    border-radius: 8px;
    font-size:     12px;
    line-height:   1.5;
  }
  .cw-notice__icon { flex-shrink: 0; margin-top: 1px; }
  .cw-notice--warn  {
    background: rgba(250,204,21,0.08);
    border:     1px solid rgba(250,204,21,0.25);
    color:      var(--cw-warn);
  }
  .cw-notice--error {
    background: rgba(248,113,113,0.08);
    border:     1px solid rgba(248,113,113,0.25);
    color:      var(--cw-error);
  }
  .cw-notice a {
    color:           inherit;
    text-decoration: underline;
  }

  /* ── buttons ─────────────────────────────────────────────────────────────── */
  .cw-btn {
    display:         flex;
    align-items:     center;
    justify-content: center;
    gap:             8px;
    padding:         12px 20px;
    border-radius:   8px;
    border:          none;
    cursor:          pointer;
    font-family:     var(--cw-font);
    font-size:       13px;
    font-weight:     700;
    letter-spacing:  0.04em;
    text-transform:  uppercase;
    transition:      all 0.18s;
  }
  .cw-btn--primary {
    background: var(--cw-accent);
    color:      #0d0d0f;
  }
  .cw-btn--primary:hover:not(:disabled) {
    background: #86efac;
    transform:  translateY(-1px);
    box-shadow: 0 4px 20px rgba(74,222,128,0.3);
  }
  .cw-btn--primary:active:not(:disabled) {
    transform: translateY(0);
  }
  .cw-btn--primary:disabled {
    opacity: 0.4;
    cursor:  not-allowed;
  }
  .cw-btn--ghost {
    background:   transparent;
    color:        var(--cw-muted);
    border:       1px solid var(--cw-border);
  }
  .cw-btn--ghost:hover {
    color:        var(--cw-text);
    border-color: var(--cw-border-hi);
  }
  .cw-btn--sm {
    padding:   8px 14px;
    font-size: 11px;
  }

  /* ── icon button ─────────────────────────────────────────────────────────── */
  .cw-icon-btn {
    background:    transparent;
    border:        none;
    cursor:        pointer;
    color:         var(--cw-muted);
    padding:       6px;
    border-radius: 6px;
    display:       flex;
    align-items:   center;
    transition:    color 0.15s, background 0.15s;
    flex-shrink:   0;
  }
  .cw-icon-btn:hover {
    color:       var(--cw-text);
    background:  rgba(255,255,255,0.06);
  }

  /* ── connecting spinner ──────────────────────────────────────────────────── */
  .cw-panel--connecting {
    align-items: center;
    min-height:  180px;
    justify-content: center;
  }
  .cw-spinner {
    display: flex;
    gap:     6px;
  }
  .cw-spinner span {
    width:         8px;
    height:        8px;
    border-radius: 50%;
    background:    var(--cw-accent);
    animation:     cwPulse 1.2s ease-in-out infinite;
  }
  .cw-spinner span:nth-child(2) { animation-delay: 0.2s; }
  .cw-spinner span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes cwPulse {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1);   opacity: 1;   }
  }
  .cw-connecting-text {
    margin:      0;
    font-size:   15px;
    font-weight: 700;
    color:       var(--cw-text);
    animation:   cwFade 1.8s ease-in-out infinite;
  }
  @keyframes cwFade {
    0%, 100% { opacity: 0.5; }
    50%      { opacity: 1;   }
  }

  /* ── wrong network ───────────────────────────────────────────────────────── */
  .cw-panel--wrongnet {
    align-items: center;
    text-align:  center;
  }
  .cw-wrongnet-icon {
    font-size:   36px;
    line-height: 1;
  }
  .cw-wrongnet-title {
    margin:      0;
    font-size:   17px;
    font-weight: 700;
    color:       var(--cw-warn);
  }

  /* ── connected state ─────────────────────────────────────────────────────── */
  .cw-badge {
    display:     flex;
    align-items: center;
    gap:         8px;
  }
  .cw-badge__dot {
    width:         8px;
    height:        8px;
    border-radius: 50%;
    background:    var(--cw-accent);
    box-shadow:    0 0 0 3px var(--cw-accent-dim);
    animation:     cwGlow 2s ease-in-out infinite;
  }
  @keyframes cwGlow {
    0%, 100% { box-shadow: 0 0 0 3px var(--cw-accent-dim); }
    50%      { box-shadow: 0 0 0 5px rgba(74,222,128,0.2); }
  }
  .cw-badge__label {
    font-size:      11px;
    font-weight:    700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color:          var(--cw-accent);
  }
  .cw-badge__network {
    margin-left:    auto;
    font-size:      10px;
    color:          var(--cw-muted);
    border:         1px solid var(--cw-border);
    padding:        2px 8px;
    border-radius:  20px;
  }

  .cw-address-row {
    display:       flex;
    align-items:   center;
    gap:           12px;
    padding:       12px 14px;
    background:    rgba(255,255,255,0.03);
    border:        1px solid var(--cw-border);
    border-radius: 10px;
  }
  .cw-avatar {
    flex-shrink:   0;
    border-radius: 50%;
    overflow:      hidden;
    line-height:   0;
  }
  .cw-address-info {
    display:        flex;
    flex-direction: column;
    gap:            2px;
    overflow:       hidden;
    flex:           1;
  }
  .cw-address-short {
    font-size:      14px;
    font-weight:    700;
    letter-spacing: 0.04em;
  }
  .cw-address-full {
    font-size:     9px;
    color:         var(--cw-muted);
    white-space:   nowrap;
    overflow:      hidden;
    text-overflow: ellipsis;
  }
`;
