import { useState, useEffect, useCallback, useRef } from "react";
import { useWallet, WALLET_STATUS } from "./hooks/useWallet";
import ConnectWallet  from "./components/ConnectWallet";
import RegisterDID    from "./components/RegisterDID";
import ProveIdentity  from "./components/ProveIdentity";
import Dashboard      from "./components/Dashboard";

/**
 * App.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/App.jsx
 *
 * Root application shell for the DID Protocol frontend.
 *
 * Handles:
 *   • Global layout — top nav, sidebar, main content area
 *   • View routing — dashboard / register / prove / settings
 *   • Animated page transitions between views
 *   • Wallet connection gate — walls off the app until connected
 *   • Toast notification system for success / error events
 *   • Keyboard shortcut: Escape to go back, D for dashboard
 *
 * Contract addresses are read from .env:
 *   VITE_DID_REGISTRY_ADDRESS
 *   VITE_ZKP_VERIFIER_ADDRESS
 *   VITE_CRED_NFT_ADDRESS
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Contract addresses from .env ──────────────────────────────────────────────
const CONTRACTS = {
  registry:    import.meta.env?.VITE_DID_REGISTRY_ADDRESS  ?? "",
  zkpVerifier: import.meta.env?.VITE_ZKP_VERIFIER_ADDRESS  ?? "",
  credNFT:     import.meta.env?.VITE_CRED_NFT_ADDRESS      ?? "",
};

// ── View definitions ──────────────────────────────────────────────────────────
const VIEWS = {
  CONNECT:   "connect",
  DASHBOARD: "dashboard",
  REGISTER:  "register",
  PROVE:     "prove",
  SETTINGS:  "settings",
};

const NAV_ITEMS = [
  { id: VIEWS.DASHBOARD, label: "Dashboard",  icon: "◈", shortcut: "D" },
  { id: VIEWS.REGISTER,  label: "Register",   icon: "◎", shortcut: "R" },
  { id: VIEWS.PROVE,     label: "Prove",      icon: "◉", shortcut: "P" },
  { id: VIEWS.SETTINGS,  label: "Settings",   icon: "◇", shortcut: "S" },
];

// ── Toast queue ───────────────────────────────────────────────────────────────
let _toastId = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
function shortenAddr(addr) {
  return addr ? `${addr.slice(0, 6)}···${addr.slice(-4)}` : "";
}

// ══════════════════════════════════════════════════════════════════════════════
//  APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const wallet = useWallet({ requiredChainId: 11155111, autoConnect: true });

  const [view,       setView]       = useState(VIEWS.CONNECT);
  const [prevView,   setPrevView]   = useState(null);
  const [animating,  setAnimating]  = useState(false);
  const [toasts,     setToasts]     = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cmdOpen,    setCmdOpen]    = useState(false);
  const mainRef = useRef(null);

  // ── Auto-navigate after wallet connects ──────────────────────────────────
  useEffect(() => {
    if (wallet.isConnected && view === VIEWS.CONNECT) {
      navigate(VIEWS.DASHBOARD);
    }
    if (!wallet.isConnected && view !== VIEWS.CONNECT) {
      navigate(VIEWS.CONNECT);
    }
  }, [wallet.isConnected]);

  // ── Animated view transition ─────────────────────────────────────────────
  const navigate = useCallback((nextView) => {
    if (nextView === view || animating) return;
    setAnimating(true);
    setPrevView(view);

    // Brief exit animation then switch
    setTimeout(() => {
      setView(nextView);
      setSidebarOpen(false);
      setAnimating(false);
      // Scroll to top
      if (mainRef.current) mainRef.current.scrollTop = 0;
    }, 220);
  }, [view, animating]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (!wallet.isConnected) return;
      // Ignore when typing in an input
      if (["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName)) return;

      if (e.key === "Escape")  navigate(VIEWS.DASHBOARD);
      if (e.key === "d" || e.key === "D") navigate(VIEWS.DASHBOARD);
      if (e.key === "r" || e.key === "R") navigate(VIEWS.REGISTER);
      if (e.key === "p" || e.key === "P") navigate(VIEWS.PROVE);
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wallet.isConnected, navigate]);

  // ── Toast system ──────────────────────────────────────────────────────────
  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Callbacks passed to child views ──────────────────────────────────────
  const onRegistered = useCallback((result) => {
    addToast(`DID registered! CID: ${result.ipfsCID?.slice(0, 10)}…`, "success");
    navigate(VIEWS.DASHBOARD);
  }, [addToast, navigate]);

  const onProven = useCallback((result) => {
    addToast(`${result.claimType} verified and NFT minted!`, "success");
    navigate(VIEWS.DASHBOARD);
  }, [addToast, navigate]);

  // ── Background grid animation ─────────────────────────────────────────────
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let t = 0;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      t += 0.003;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const cols = 24;
      const rows = 14;
      const cw   = canvas.width  / cols;
      const rh   = canvas.height / rows;

      for (let c = 0; c <= cols; c++) {
        for (let r = 0; r <= rows; r++) {
          const x = c * cw;
          const y = r * rh;
          const wave = Math.sin(t + c * 0.4) * Math.cos(t * 0.7 + r * 0.3);
          const alpha = (wave + 1) / 2 * 0.04 + 0.01;

          ctx.beginPath();
          ctx.arc(x, y, 1, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(180, 200, 255, ${alpha})`;
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-root">

      {/* Animated dot-grid background */}
      <canvas className="app-bg-canvas" ref={canvasRef} />

      {/* Gradient mesh overlays */}
      <div className="app-mesh app-mesh--1" />
      <div className="app-mesh app-mesh--2" />

      {/* ── CONNECT GATE ── */}
      {!wallet.isConnected && (
        <div className="app-gate">
          <div className="app-gate__left">
            <div className="app-gate__logo">
              <LogoMark />
              <span className="app-gate__logotext">DID PROTOCOL</span>
            </div>
            <h1 className="app-gate__headline">
              Own Your<br />
              <em>Identity.</em>
            </h1>
            <p className="app-gate__sub">
              A decentralised identity system built on Ethereum.
              Zero-knowledge proofs. No middlemen. No data leaks.
            </p>
            <div className="app-gate__features">
              {[
                { icon: "◈", text: "Self-sovereign identity via DID standard" },
                { icon: "◉", text: "ZK proofs — verify without revealing" },
                { icon: "◆", text: "Soulbound NFT credentials on-chain" },
                { icon: "◎", text: "IPFS-stored, tamper-proof documents" },
              ].map((f, i) => (
                <div key={i} className="app-gate__feature"
                  style={{ animationDelay: `${0.1 + i * 0.08}s` }}>
                  <span className="app-gate__feature-icon">{f.icon}</span>
                  <span className="app-gate__feature-text">{f.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="app-gate__right">
            <div className="app-gate__card">
              <p className="app-gate__card-label">Connect to get started</p>
              <ConnectWallet
                onConnect={() => {}}
                onDisconnect={() => {}}
              />
              <div className="app-gate__card-footer">
                <span>Sepolia Testnet · Ethereum</span>
                <a href="https://sepoliafaucet.com" target="_blank"
                  rel="noreferrer" className="app-gate__faucet">
                  Get test ETH →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN APP SHELL (only when connected) ── */}
      {wallet.isConnected && (
        <div className="app-shell">

          {/* ── SIDEBAR ── */}
          <aside className={`app-sidebar ${sidebarOpen ? "app-sidebar--open" : ""}`}>
            <div className="app-sidebar__top">
              <div className="app-sidebar__brand">
                <LogoMark size={20} />
                <span className="app-sidebar__brandname">DID</span>
              </div>
              <button className="app-sidebar__close"
                onClick={() => setSidebarOpen(false)}>✕</button>
            </div>

            {/* Nav items */}
            <nav className="app-sidebar__nav">
              {NAV_ITEMS.map(item => (
                <button
                  key={item.id}
                  className="app-nav-item"
                  data-active={view === item.id ? "true" : "false"}
                  onClick={() => navigate(item.id)}
                >
                  <span className="app-nav-item__icon">{item.icon}</span>
                  <span className="app-nav-item__label">{item.label}</span>
                  <kbd className="app-nav-item__kbd">{item.shortcut}</kbd>
                </button>
              ))}
            </nav>

            {/* Wallet info in sidebar bottom */}
            <div className="app-sidebar__wallet">
              <div className="app-sidebar__wallet-dot" />
              <div className="app-sidebar__wallet-info">
                <span className="app-sidebar__wallet-addr">
                  {shortenAddr(wallet.address)}
                </span>
                <span className="app-sidebar__wallet-net">
                  Sepolia · {wallet.balance ?? "…"} ETH
                </span>
              </div>
              <button className="app-sidebar__disconnect"
                onClick={wallet.disconnect} title="Disconnect">
                <PowerIcon />
              </button>
            </div>
          </aside>

          {/* ── TOPBAR ── */}
          <header className="app-topbar">
            <button className="app-topbar__hamburger"
              onClick={() => setSidebarOpen(o => !o)}>
              <HamburgerIcon />
            </button>

            {/* Breadcrumb */}
            <div className="app-topbar__breadcrumb">
              <span className="app-topbar__breadcrumb-root">DID Protocol</span>
              <span className="app-topbar__breadcrumb-sep">/</span>
              <span className="app-topbar__breadcrumb-view">
                {NAV_ITEMS.find(n => n.id === view)?.label ?? ""}
              </span>
            </div>

            {/* Right side — wallet pill + cmd shortcut hint */}
            <div className="app-topbar__right">
              <div className="app-topbar__cmd-hint"
                onClick={() => setCmdOpen(true)}>
                <span>⌘K</span>
              </div>
              <div className="app-topbar__wallet-pill">
                <span className="app-topbar__wallet-dot" />
                <span>{shortenAddr(wallet.address)}</span>
              </div>
            </div>
          </header>

          {/* ── MAIN CONTENT ── */}
          <main
            className={`app-main ${animating ? "app-main--exit" : "app-main--enter"}`}
            ref={mainRef}
          >
            {/* Wrong network banner */}
            {wallet.isWrongNet && (
              <div className="app-wrong-net">
                <span className="app-wrong-net__icon">⛓</span>
                <span>Wrong network — app requires Sepolia Testnet.</span>
                <button className="app-wrong-net__btn"
                  onClick={() => wallet.switchNetwork()}>
                  Switch Now
                </button>
              </div>
            )}

            {/* Missing contract addresses warning */}
            {(!CONTRACTS.registry || !CONTRACTS.zkpVerifier || !CONTRACTS.credNFT) && (
              <div className="app-warn-banner">
                <span>⚠</span>
                <span>
                  Contract addresses not set. Add{" "}
                  <code>VITE_DID_REGISTRY_ADDRESS</code>,{" "}
                  <code>VITE_ZKP_VERIFIER_ADDRESS</code>,{" "}
                  <code>VITE_CRED_NFT_ADDRESS</code> to your{" "}
                  <code>.env</code> file.
                </span>
              </div>
            )}

            {/* ── VIEW: DASHBOARD ── */}
            {view === VIEWS.DASHBOARD && (
              <Dashboard
                wallet={wallet}
                didRegistryAddress={CONTRACTS.registry}
                zkpVerifierAddress={CONTRACTS.zkpVerifier}
                credNFTAddress={CONTRACTS.credNFT}
                onGoRegister={() => navigate(VIEWS.REGISTER)}
                onGoProve={() => navigate(VIEWS.PROVE)}
              />
            )}

            {/* ── VIEW: REGISTER ── */}
            {view === VIEWS.REGISTER && (
              <div className="app-view-wrapper">
                <ViewHeader
                  icon="◎"
                  title="Register DID"
                  sub="Create your on-chain decentralised identifier"
                  onBack={() => navigate(VIEWS.DASHBOARD)}
                />
                <RegisterDID
                  wallet={wallet}
                  contractAddress={CONTRACTS.registry}
                  onRegistered={onRegistered}
                />
              </div>
            )}

            {/* ── VIEW: PROVE ── */}
            {view === VIEWS.PROVE && (
              <div className="app-view-wrapper">
                <ViewHeader
                  icon="◉"
                  title="Prove Identity"
                  sub="Generate a zero-knowledge proof and verify on-chain"
                  onBack={() => navigate(VIEWS.DASHBOARD)}
                />
                <ProveIdentity
                  wallet={wallet}
                  zkpVerifierAddress={CONTRACTS.zkpVerifier}
                  credNFTAddress={CONTRACTS.credNFT}
                  onProven={onProven}
                />
              </div>
            )}

            {/* ── VIEW: SETTINGS ── */}
            {view === VIEWS.SETTINGS && (
              <div className="app-view-wrapper">
                <ViewHeader
                  icon="◇"
                  title="Settings"
                  sub="Network, contracts, and developer tools"
                  onBack={() => navigate(VIEWS.DASHBOARD)}
                />
                <SettingsPanel
                  wallet={wallet}
                  contracts={CONTRACTS}
                  onAddToast={addToast}
                />
              </div>
            )}
          </main>

        </div>
      )}

      {/* ── COMMAND PALETTE ── */}
      {cmdOpen && wallet.isConnected && (
        <CommandPalette
          onNavigate={(v) => { navigate(v); setCmdOpen(false); }}
          onClose={() => setCmdOpen(false)}
          currentView={view}
        />
      )}

      {/* ── TOAST STACK ── */}
      <div className="app-toast-stack">
        {toasts.map(t => (
          <Toast key={t.id} {...t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>

      <style>{CSS}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function ViewHeader({ icon, title, sub, onBack }) {
  return (
    <div className="app-view-header">
      <button className="app-view-header__back" onClick={onBack}>
        ← Back
      </button>
      <div className="app-view-header__info">
        <span className="app-view-header__icon">{icon}</span>
        <div>
          <h1 className="app-view-header__title">{title}</h1>
          <p className="app-view-header__sub">{sub}</p>
        </div>
      </div>
    </div>
  );
}

function Toast({ id, message, type, onDismiss }) {
  return (
    <div className={`app-toast app-toast--${type}`} onClick={onDismiss}>
      <span className="app-toast__icon">
        {type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}
      </span>
      <span className="app-toast__msg">{message}</span>
      <div className="app-toast__bar" />
    </div>
  );
}

function CommandPalette({ onNavigate, onClose, currentView }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = [
    ...NAV_ITEMS.map(n => ({ ...n, group: "Navigation" })),
    { id: "disconnect", label: "Disconnect Wallet", icon: "⏻", group: "Wallet", shortcut: "" },
  ].filter(item =>
    !query || item.label.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="app-cmd-overlay" onClick={onClose}>
      <div className="app-cmd" onClick={e => e.stopPropagation()}>
        <div className="app-cmd__search">
          <SearchIcon />
          <input
            ref={inputRef}
            className="app-cmd__input"
            placeholder="Search views…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && items.length > 0) onNavigate(items[0].id);
            }}
          />
          <kbd className="app-cmd__esc">ESC</kbd>
        </div>
        <div className="app-cmd__results">
          {items.map(item => (
            <button key={item.id} className="app-cmd__item"
              data-active={item.id === currentView ? "true" : "false"}
              onClick={() => onNavigate(item.id)}>
              <span className="app-cmd__item-icon">{item.icon}</span>
              <span className="app-cmd__item-label">{item.label}</span>
              <span className="app-cmd__item-group">{item.group}</span>
              {item.shortcut && <kbd className="app-cmd__item-kbd">{item.shortcut}</kbd>}
            </button>
          ))}
          {items.length === 0 && (
            <p className="app-cmd__empty">No results for "{query}"</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({ wallet, contracts, onAddToast }) {
  const handleCopy = (label, value) => {
    navigator.clipboard.writeText(value).then(() =>
      onAddToast(`${label} copied!`, "success", 2000)
    );
  };

  const rows = [
    { label: "DIDRegistry",    value: contracts.registry    || "Not set" },
    { label: "ZKPVerifier",    value: contracts.zkpVerifier || "Not set" },
    { label: "CredentialNFT",  value: contracts.credNFT     || "Not set" },
    { label: "Network",        value: wallet.chainName || "Unknown" },
    { label: "Wallet Address", value: wallet.address   || "—" },
    { label: "ETH Balance",    value: wallet.balance ? `${wallet.balance} ETH` : "—" },
  ];

  return (
    <div className="app-settings">
      <div className="app-settings__section">
        <h2 className="app-settings__section-title">Contract Addresses</h2>
        <p className="app-settings__section-sub">
          Set these in your <code>.env</code> file as{" "}
          <code>VITE_DID_REGISTRY_ADDRESS</code> etc. after running{" "}
          <code>npx hardhat run scripts/deploy.js --network sepolia</code>
        </p>
        <div className="app-settings__table">
          {rows.map(row => (
            <div key={row.label} className="app-settings__row">
              <span className="app-settings__row-label">{row.label}</span>
              <span className="app-settings__row-value">{row.value}</span>
              {row.value !== "Not set" && row.value !== "—" && (
                <button className="app-settings__copy"
                  onClick={() => handleCopy(row.label, row.value)}>
                  Copy
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="app-settings__section">
        <h2 className="app-settings__section-title">Keyboard Shortcuts</h2>
        <div className="app-settings__shortcuts">
          {[
            { key: "D",   desc: "Go to Dashboard"  },
            { key: "R",   desc: "Go to Register"   },
            { key: "P",   desc: "Go to Prove"      },
            { key: "S",   desc: "Go to Settings"   },
            { key: "⌘K",  desc: "Open command palette" },
            { key: "ESC", desc: "Return to Dashboard" },
          ].map(s => (
            <div key={s.key} className="app-settings__shortcut">
              <kbd className="app-settings__kbd">{s.key}</kbd>
              <span>{s.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="app-settings__section">
        <h2 className="app-settings__section-title">Resources</h2>
        <div className="app-settings__links">
          {[
            { label: "Sepolia Faucet",        href: "https://sepoliafaucet.com" },
            { label: "Sepolia Etherscan",     href: "https://sepolia.etherscan.io" },
            { label: "IPFS Gateway",          href: "https://ipfs.io" },
            { label: "DID Spec (W3C)",        href: "https://www.w3.org/TR/did-core/" },
            { label: "circom docs",           href: "https://docs.circom.io" },
            { label: "snarkjs docs",          href: "https://github.com/iden3/snarkjs" },
          ].map(l => (
            <a key={l.label} href={l.href} target="_blank"
              rel="noreferrer" className="app-settings__link">
              {l.label} →
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function LogoMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <polygon points="16,2 30,9 30,23 16,30 2,23 2,9"
        stroke="currentColor" strokeWidth="1.5"/>
      <polygon points="16,8 24,12.5 24,19.5 16,24 8,19.5 8,12.5"
        fill="currentColor" opacity=".25"/>
      <circle cx="16" cy="16" r="3" fill="currentColor"/>
    </svg>
  );
}
function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6"  x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}
function PowerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/>
      <line x1="12" y1="2" x2="12" y2="12"/>
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  GLOBAL STYLES
// ══════════════════════════════════════════════════════════════════════════════
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,700;1,9..144,300;1,9..144,700&family=Geist+Mono:wght@300;400;500&display=swap');

  /* ── reset & tokens ──────────────────────────────────────────────── */
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .app-root {
    --ap-bg:       #060609;
    --ap-surface:  #0d0d12;
    --ap-surface2: #141420;
    --ap-border:   rgba(255,255,255,0.07);
    --ap-border-hi:rgba(255,255,255,0.14);
    --ap-accent:   #c6f135;
    --ap-accent2:  #6ee7f7;
    --ap-accent3:  #f7a26e;
    --ap-text:     #eeeef5;
    --ap-muted:    #3c3c50;
    --ap-muted2:   #7070a0;
    --ap-error:    #ff5070;
    --ap-success:  #50ff9a;
    --ap-display:  'Fraunces', serif;
    --ap-mono:     'Geist Mono', monospace;
    --ap-sidebar-w: 220px;
    --ap-topbar-h:  52px;

    font-family:  var(--ap-mono);
    color:        var(--ap-text);
    background:   var(--ap-bg);
    min-height:   100vh;
    overflow-x:   hidden;
    position:     relative;
  }

  /* ── canvas background ───────────────────────────────────────────── */
  .app-bg-canvas {
    position:       fixed;
    inset:          0;
    width:          100%;
    height:         100%;
    pointer-events: none;
    z-index:        0;
    opacity:        0.6;
  }

  /* ── gradient meshes ─────────────────────────────────────────────── */
  .app-mesh {
    position:       fixed;
    pointer-events: none;
    z-index:        0;
    border-radius:  50%;
    filter:         blur(120px);
  }
  .app-mesh--1 {
    width:      600px;
    height:     400px;
    top:        -150px;
    right:      -100px;
    background: radial-gradient(ellipse, rgba(198,241,53,0.06), transparent 70%);
  }
  .app-mesh--2 {
    width:      500px;
    height:     500px;
    bottom:     -150px;
    left:       -100px;
    background: radial-gradient(ellipse, rgba(110,231,247,0.05), transparent 70%);
  }

  /* ── gate (connect screen) ───────────────────────────────────────── */
  .app-gate {
    position:        relative;
    z-index:         1;
    min-height:      100vh;
    display:         grid;
    grid-template-columns: 1fr 1fr;
    max-width:       1100px;
    margin:          0 auto;
    padding:         60px 32px;
    gap:             60px;
    align-items:     center;
  }
  @media (max-width: 768px) {
    .app-gate { grid-template-columns: 1fr; padding: 40px 20px; }
  }

  .app-gate__logo {
    display:     flex;
    align-items: center;
    gap:         10px;
    color:       var(--ap-accent);
    margin-bottom: 32px;
  }
  .app-gate__logotext {
    font-size:      11px;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    font-weight:    500;
  }
  .app-gate__headline {
    font-family:    var(--ap-display);
    font-size:      clamp(52px, 8vw, 90px);
    font-weight:    300;
    line-height:    0.95;
    letter-spacing: -0.02em;
    margin-bottom:  24px;
    background:     linear-gradient(140deg, #fff 30%, #555);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .app-gate__headline em {
    font-style:  italic;
    font-weight: 700;
    color: var(--ap-accent);
    -webkit-text-fill-color: var(--ap-accent);
  }
  .app-gate__sub {
    font-size:   14px;
    color:       var(--ap-muted2);
    line-height: 1.7;
    max-width:   400px;
    margin-bottom: 36px;
  }
  .app-gate__features {
    display:        flex;
    flex-direction: column;
    gap:            12px;
  }
  .app-gate__feature {
    display:     flex;
    align-items: center;
    gap:         12px;
    font-size:   13px;
    color:       var(--ap-muted2);
    animation:   apFadeUp 0.5s ease both;
  }
  .app-gate__feature-icon {
    width:         28px;
    height:        28px;
    border-radius: 6px;
    background:    rgba(198,241,53,0.08);
    border:        1px solid rgba(198,241,53,0.15);
    display:       flex;
    align-items:   center;
    justify-content: center;
    font-size:     13px;
    color:         var(--ap-accent);
    flex-shrink:   0;
  }

  .app-gate__right {
    display:        flex;
    justify-content: center;
    align-items:    center;
  }
  .app-gate__card {
    background:    var(--ap-surface);
    border:        1px solid var(--ap-border);
    border-radius: 20px;
    padding:       36px 32px;
    width:         100%;
    max-width:     360px;
    display:       flex;
    flex-direction: column;
    gap:           20px;
    position:      relative;
    overflow:      hidden;
    animation:     apFadeUp 0.5s 0.2s ease both;
  }
  .app-gate__card::before {
    content:    '';
    position:   absolute;
    top: 0; left: 0; right: 0;
    height:     1px;
    background: linear-gradient(90deg, transparent, var(--ap-accent), transparent);
    opacity:    0.5;
  }
  .app-gate__card-label {
    font-size:      10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color:          var(--ap-muted2);
  }
  .app-gate__card-footer {
    display:     flex;
    justify-content: space-between;
    align-items: center;
    font-size:   11px;
    color:       var(--ap-muted2);
    padding-top: 4px;
    border-top:  1px solid var(--ap-border);
  }
  .app-gate__faucet {
    color:           var(--ap-accent2);
    text-decoration: none;
    font-size:       11px;
  }
  .app-gate__faucet:hover { text-decoration: underline; }

  /* ── app shell ───────────────────────────────────────────────────── */
  .app-shell {
    position:   relative;
    z-index:    1;
    min-height: 100vh;
    display:    grid;
    grid-template-areas:
      "sidebar topbar"
      "sidebar main";
    grid-template-columns: var(--ap-sidebar-w) 1fr;
    grid-template-rows:    var(--ap-topbar-h) 1fr;
  }
  @media (max-width: 900px) {
    .app-shell {
      grid-template-areas:
        "topbar"
        "main";
      grid-template-columns: 1fr;
    }
  }

  /* ── sidebar ─────────────────────────────────────────────────────── */
  .app-sidebar {
    grid-area:      sidebar;
    background:     var(--ap-surface);
    border-right:   1px solid var(--ap-border);
    display:        flex;
    flex-direction: column;
    padding:        20px 12px;
    gap:            0;
    position:       sticky;
    top:            0;
    height:         100vh;
    overflow-y:     auto;
  }
  @media (max-width: 900px) {
    .app-sidebar {
      display:    none;
      position:   fixed;
      inset:      0;
      z-index:    100;
      width:      var(--ap-sidebar-w);
      animation:  apSlideIn 0.25s ease both;
    }
    .app-sidebar--open { display: flex; }
  }

  .app-sidebar__top {
    display:         flex;
    align-items:     center;
    justify-content: space-between;
    padding:         0 8px 20px;
  }
  .app-sidebar__brand {
    display:     flex;
    align-items: center;
    gap:         8px;
    color:       var(--ap-accent);
    font-size:   11px;
    letter-spacing: 0.15em;
    font-weight: 500;
  }
  .app-sidebar__close {
    display:      none;
    background:   transparent;
    border:       none;
    color:        var(--ap-muted2);
    cursor:       pointer;
    font-size:    14px;
  }
  @media (max-width: 900px) {
    .app-sidebar__close { display: block; }
  }

  .app-sidebar__nav {
    display:        flex;
    flex-direction: column;
    gap:            2px;
    flex:           1;
  }
  .app-nav-item {
    display:       flex;
    align-items:   center;
    gap:           10px;
    padding:       9px 12px;
    border-radius: 8px;
    border:        none;
    background:    transparent;
    color:         var(--ap-muted2);
    font-family:   var(--ap-mono);
    font-size:     12px;
    cursor:        pointer;
    text-align:    left;
    transition:    all 0.15s;
    width:         100%;
  }
  .app-nav-item:hover {
    background: rgba(255,255,255,0.04);
    color:      var(--ap-text);
  }
  .app-nav-item[data-active="true"] {
    background: rgba(198,241,53,0.08);
    color:      var(--ap-accent);
    border:     1px solid rgba(198,241,53,0.15);
  }
  .app-nav-item__icon  { font-size: 14px; width: 18px; text-align: center; }
  .app-nav-item__label { flex: 1; }
  .app-nav-item__kbd {
    font-size:      9px;
    background:     var(--ap-surface2);
    border:         1px solid var(--ap-border);
    border-radius:  4px;
    padding:        1px 5px;
    color:          var(--ap-muted);
    font-family:    var(--ap-mono);
    opacity:        0;
    transition:     opacity 0.15s;
  }
  .app-nav-item:hover .app-nav-item__kbd { opacity: 1; }

  .app-sidebar__wallet {
    display:       flex;
    align-items:   center;
    gap:           8px;
    padding:       12px;
    border-top:    1px solid var(--ap-border);
    margin-top:    auto;
  }
  .app-sidebar__wallet-dot {
    width:         7px;
    height:        7px;
    border-radius: 50%;
    background:    var(--ap-success);
    box-shadow:    0 0 8px rgba(80,255,154,0.5);
    flex-shrink:   0;
  }
  .app-sidebar__wallet-info {
    flex:           1;
    display:        flex;
    flex-direction: column;
    gap:            2px;
    min-width:      0;
  }
  .app-sidebar__wallet-addr {
    font-size:   12px;
    font-weight: 500;
    overflow:    hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .app-sidebar__wallet-net {
    font-size: 10px;
    color:     var(--ap-muted2);
  }
  .app-sidebar__disconnect {
    background:   transparent;
    border:       none;
    color:        var(--ap-muted2);
    cursor:       pointer;
    padding:      6px;
    border-radius: 6px;
    display:      flex;
    transition:   color 0.15s;
    flex-shrink:  0;
  }
  .app-sidebar__disconnect:hover { color: var(--ap-error); }

  /* ── topbar ──────────────────────────────────────────────────────── */
  .app-topbar {
    grid-area:     topbar;
    background:    rgba(6,6,9,0.8);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid var(--ap-border);
    display:       flex;
    align-items:   center;
    gap:           16px;
    padding:       0 24px;
    position:      sticky;
    top:           0;
    z-index:       50;
  }
  .app-topbar__hamburger {
    display:      none;
    background:   transparent;
    border:       none;
    color:        var(--ap-muted2);
    cursor:       pointer;
    padding:      4px;
  }
  @media (max-width: 900px) {
    .app-topbar__hamburger { display: flex; }
  }
  .app-topbar__breadcrumb {
    display:     flex;
    align-items: center;
    gap:         8px;
    font-size:   12px;
    color:       var(--ap-muted2);
    flex:        1;
  }
  .app-topbar__breadcrumb-root   { color: var(--ap-muted); }
  .app-topbar__breadcrumb-sep    { color: var(--ap-muted); }
  .app-topbar__breadcrumb-view   { color: var(--ap-text); font-weight: 500; }
  .app-topbar__right {
    display:     flex;
    align-items: center;
    gap:         10px;
  }
  .app-topbar__cmd-hint {
    background:   var(--ap-surface2);
    border:       1px solid var(--ap-border);
    border-radius: 6px;
    padding:      4px 10px;
    font-size:    11px;
    color:        var(--ap-muted2);
    cursor:       pointer;
    transition:   border-color 0.15s;
  }
  .app-topbar__cmd-hint:hover { border-color: var(--ap-border-hi); color: var(--ap-text); }
  .app-topbar__wallet-pill {
    display:       flex;
    align-items:   center;
    gap:           7px;
    padding:       5px 12px;
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border);
    border-radius: 20px;
    font-size:     11px;
  }
  .app-topbar__wallet-dot {
    width:         6px;
    height:        6px;
    border-radius: 50%;
    background:    var(--ap-success);
    box-shadow:    0 0 6px rgba(80,255,154,0.6);
    animation:     apPulse 2s ease-in-out infinite;
  }

  /* ── main content ────────────────────────────────────────────────── */
  .app-main {
    grid-area:  main;
    overflow-y: auto;
    min-height: calc(100vh - var(--ap-topbar-h));
  }
  .app-main--enter {
    animation: apFadeIn 0.3s ease both;
  }
  .app-main--exit {
    animation: apFadeOut 0.22s ease both;
  }

  /* ── view wrapper (register/prove/settings) ──────────────────────── */
  .app-view-wrapper {
    max-width: 800px;
    margin:    0 auto;
    padding:   32px 24px 80px;
  }
  .app-view-header {
    margin-bottom: 28px;
  }
  .app-view-header__back {
    background:   transparent;
    border:       none;
    color:        var(--ap-muted2);
    font-family:  var(--ap-mono);
    font-size:    12px;
    cursor:       pointer;
    padding:      0 0 12px;
    display:      block;
    transition:   color 0.15s;
  }
  .app-view-header__back:hover { color: var(--ap-text); }
  .app-view-header__info {
    display:     flex;
    align-items: center;
    gap:         16px;
  }
  .app-view-header__icon {
    font-size: 32px;
    color:     var(--ap-accent);
    line-height: 1;
  }
  .app-view-header__title {
    font-family:    var(--ap-display);
    font-size:      32px;
    font-weight:    300;
    font-style:     italic;
    margin-bottom:  4px;
  }
  .app-view-header__sub {
    font-size: 12px;
    color:     var(--ap-muted2);
  }

  /* ── banners ─────────────────────────────────────────────────────── */
  .app-wrong-net {
    display:     flex;
    align-items: center;
    gap:         12px;
    padding:     12px 24px;
    background:  rgba(255,80,112,0.08);
    border-bottom: 1px solid rgba(255,80,112,0.2);
    font-size:   13px;
    color:       var(--ap-error);
  }
  .app-wrong-net__icon { font-size: 18px; }
  .app-wrong-net__btn {
    margin-left:  auto;
    background:   var(--ap-error);
    color:        #060609;
    border:       none;
    font-family:  var(--ap-mono);
    font-size:    11px;
    padding:      6px 14px;
    border-radius: 6px;
    cursor:       pointer;
    font-weight:  600;
    white-space:  nowrap;
  }
  .app-warn-banner {
    display:     flex;
    align-items: flex-start;
    gap:         10px;
    padding:     12px 24px;
    background:  rgba(247,162,110,0.06);
    border-bottom: 1px solid rgba(247,162,110,0.15);
    font-size:   12px;
    color:       var(--ap-accent3);
    line-height: 1.5;
  }
  .app-warn-banner code {
    background:    rgba(255,255,255,0.07);
    padding:       1px 5px;
    border-radius: 3px;
    font-size:     11px;
  }

  /* ── settings ────────────────────────────────────────────────────── */
  .app-settings {
    display:        flex;
    flex-direction: column;
    gap:            32px;
  }
  .app-settings__section-title {
    font-family:  var(--ap-display);
    font-size:    20px;
    font-weight:  300;
    font-style:   italic;
    margin-bottom: 6px;
  }
  .app-settings__section-sub {
    font-size:   12px;
    color:       var(--ap-muted2);
    line-height: 1.6;
    margin-bottom: 16px;
  }
  .app-settings__section-sub code {
    background:    rgba(255,255,255,0.07);
    padding:       1px 5px;
    border-radius: 3px;
    font-size:     11px;
  }
  .app-settings__table {
    border:         1px solid var(--ap-border);
    border-radius:  10px;
    overflow:       hidden;
  }
  .app-settings__row {
    display:     flex;
    align-items: center;
    gap:         12px;
    padding:     11px 16px;
    border-bottom: 1px solid var(--ap-border);
    font-size:   12px;
  }
  .app-settings__row:last-child { border-bottom: none; }
  .app-settings__row:nth-child(even) { background: rgba(255,255,255,0.015); }
  .app-settings__row-label { width: 140px; flex-shrink: 0; color: var(--ap-muted2); }
  .app-settings__row-value {
    flex:          1;
    font-family:   var(--ap-mono);
    font-size:     11px;
    color:         var(--ap-text);
    overflow:      hidden;
    text-overflow: ellipsis;
    white-space:   nowrap;
  }
  .app-settings__copy {
    background:   transparent;
    border:       1px solid var(--ap-border);
    color:        var(--ap-muted2);
    font-family:  var(--ap-mono);
    font-size:    10px;
    padding:      3px 10px;
    border-radius: 4px;
    cursor:       pointer;
    flex-shrink:  0;
    transition:   all 0.15s;
  }
  .app-settings__copy:hover { color: var(--ap-text); border-color: var(--ap-border-hi); }
  .app-settings__shortcuts {
    display:               grid;
    grid-template-columns: 1fr 1fr;
    gap:                   8px;
  }
  .app-settings__shortcut {
    display:     flex;
    align-items: center;
    gap:         10px;
    font-size:   12px;
    color:       var(--ap-muted2);
  }
  .app-settings__kbd {
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border-hi);
    border-radius: 5px;
    padding:       3px 8px;
    font-family:   var(--ap-mono);
    font-size:     10px;
    color:         var(--ap-text);
    min-width:     32px;
    text-align:    center;
    flex-shrink:   0;
  }
  .app-settings__links {
    display:   flex;
    flex-wrap: wrap;
    gap:       8px;
  }
  .app-settings__link {
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border);
    border-radius: 8px;
    padding:       8px 14px;
    font-size:     12px;
    color:         var(--ap-muted2);
    text-decoration: none;
    transition:    all 0.15s;
  }
  .app-settings__link:hover {
    color:        var(--ap-accent2);
    border-color: rgba(110,231,247,0.2);
  }

  /* ── command palette ─────────────────────────────────────────────── */
  .app-cmd-overlay {
    position:   fixed;
    inset:      0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(6px);
    z-index:    200;
    display:    flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
    animation:  apFadeIn 0.15s ease both;
  }
  .app-cmd {
    width:         100%;
    max-width:     520px;
    background:    var(--ap-surface);
    border:        1px solid var(--ap-border-hi);
    border-radius: 14px;
    overflow:      hidden;
    box-shadow:    0 24px 80px rgba(0,0,0,0.5);
    animation:     apScaleIn 0.15s ease both;
  }
  .app-cmd__search {
    display:     flex;
    align-items: center;
    gap:         12px;
    padding:     14px 18px;
    border-bottom: 1px solid var(--ap-border);
    color:       var(--ap-muted2);
  }
  .app-cmd__input {
    flex:        1;
    background:  transparent;
    border:      none;
    outline:     none;
    font-family: var(--ap-mono);
    font-size:   14px;
    color:       var(--ap-text);
  }
  .app-cmd__input::placeholder { color: var(--ap-muted); }
  .app-cmd__esc {
    font-size:     10px;
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border);
    border-radius: 4px;
    padding:       2px 6px;
    color:         var(--ap-muted);
    font-family:   var(--ap-mono);
  }
  .app-cmd__results {
    padding:   6px;
    max-height: 360px;
    overflow-y: auto;
  }
  .app-cmd__item {
    display:       flex;
    align-items:   center;
    gap:           10px;
    padding:       10px 12px;
    border-radius: 8px;
    border:        none;
    background:    transparent;
    color:         var(--ap-muted2);
    font-family:   var(--ap-mono);
    font-size:     13px;
    cursor:        pointer;
    width:         100%;
    text-align:    left;
    transition:    all 0.12s;
  }
  .app-cmd__item:hover, .app-cmd__item[data-active="true"] {
    background: rgba(198,241,53,0.07);
    color:      var(--ap-text);
  }
  .app-cmd__item-icon  { font-size: 14px; width: 20px; text-align: center; }
  .app-cmd__item-label { flex: 1; }
  .app-cmd__item-group {
    font-size:   10px;
    color:       var(--ap-muted);
    letter-spacing: 0.1em;
  }
  .app-cmd__item-kbd {
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border);
    border-radius: 4px;
    padding:       1px 6px;
    font-size:     10px;
    color:         var(--ap-muted);
    font-family:   var(--ap-mono);
  }
  .app-cmd__empty {
    padding:   20px;
    text-align: center;
    font-size: 13px;
    color:     var(--ap-muted2);
  }

  /* ── toast stack ─────────────────────────────────────────────────── */
  .app-toast-stack {
    position:       fixed;
    bottom:         24px;
    right:          24px;
    z-index:        300;
    display:        flex;
    flex-direction: column;
    gap:            8px;
    pointer-events: none;
  }
  .app-toast {
    display:       flex;
    align-items:   center;
    gap:           10px;
    padding:       12px 16px;
    background:    var(--ap-surface2);
    border:        1px solid var(--ap-border-hi);
    border-radius: 10px;
    font-family:   var(--ap-mono);
    font-size:     12px;
    color:         var(--ap-text);
    min-width:     260px;
    max-width:     360px;
    cursor:        pointer;
    pointer-events: auto;
    position:      relative;
    overflow:      hidden;
    box-shadow:    0 8px 32px rgba(0,0,0,0.4);
    animation:     apToastIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .app-toast--success { border-color: rgba(80,255,154,0.25); }
  .app-toast--error   { border-color: rgba(255,80,112,0.25); }
  .app-toast__icon {
    flex-shrink: 0;
    font-size:   14px;
  }
  .app-toast--success .app-toast__icon { color: var(--ap-success); }
  .app-toast--error   .app-toast__icon { color: var(--ap-error);   }
  .app-toast--info    .app-toast__icon { color: var(--ap-accent2); }
  .app-toast__msg {
    flex:        1;
    line-height: 1.4;
  }
  .app-toast__bar {
    position:   absolute;
    bottom:     0;
    left:       0;
    height:     2px;
    background: var(--ap-accent);
    animation:  apToastBar 4s linear both;
  }
  .app-toast--success .app-toast__bar { background: var(--ap-success); }
  .app-toast--error   .app-toast__bar { background: var(--ap-error);   }

  /* ── animations ──────────────────────────────────────────────────── */
  @keyframes apFadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes apFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes apFadeOut {
    from { opacity: 1; transform: translateY(0); }
    to   { opacity: 0; transform: translateY(-8px); }
  }
  @keyframes apScaleIn {
    from { transform: scale(0.95); opacity: 0; }
    to   { transform: scale(1);    opacity: 1; }
  }
  @keyframes apSlideIn {
    from { transform: translateX(-100%); }
    to   { transform: translateX(0);     }
  }
  @keyframes apToastIn {
    from { transform: translateX(40px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @keyframes apToastBar {
    from { width: 100%; }
    to   { width: 0%;   }
  }
  @keyframes apPulse {
    0%, 100% { box-shadow: 0 0 6px rgba(80,255,154,0.4); }
    50%      { box-shadow: 0 0 12px rgba(80,255,154,0.7); }
  }
`;
