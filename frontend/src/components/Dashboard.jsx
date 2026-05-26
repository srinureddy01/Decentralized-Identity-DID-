import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";

/*
 * Dashboard.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/components/Dashboard.jsx
 *
 * Master identity dashboard. Shows:
 *   • Wallet identity card with DID + IPFS document link
 *   • On-chain claim badges (Age ≥18, Identity Verified, etc.)
 *   • Soulbound NFT credential collection
 *   • Activity feed of on-chain events
 *   • Quick-action buttons to RegisterDID / ProveIdentity
 *
 * Props:
 *   wallet              { provider, signer, address, chainId }
 *   didRegistryAddress  deployed DIDRegistry contract address
 *   zkpVerifierAddress  deployed ZKPVerifier contract address
 *   credNFTAddress      deployed CredentialNFT contract address
 *   onGoRegister()      callback to switch to RegisterDID view
 *   onGoProve()         callback to switch to ProveIdentity view
 *
 * Dependencies:
 *   npm install ethers
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── ABIs ──────────────────────────────────────────────────────────────────────
const DID_REGISTRY_ABI = [
  "function hasActiveDID(address) external view returns (bool)",
  "function resolveDID(address) external view returns (tuple(string did, string ipfsCID, uint256 createdAt, uint256 updatedAt, bool isActive))",
];

const ZKP_VERIFIER_ABI = [
  "function hasClaim(address, bytes32) external view returns (bool)",
  "function getClaim(address, bytes32) external view returns (tuple(address prover, bytes32 claimType, uint256 verifiedAt, bool isValid))",
];

const CRED_NFT_ABI = [
  "function hasValidCredential(address, bytes32) external view returns (bool)",
  "function getTokenByClaim(address, bytes32) external view returns (uint256)",
  "function balanceOf(address) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
];

// ── Claim registry ────────────────────────────────────────────────────────────
const CLAIM_DEFS = [
  {
    key:         "AGE_OVER_18",
    label:       "Age Over 18",
    description: "Zero-knowledge verified age ≥ 18",
    claimType:   ethers.id("AGE_OVER_18"),
    icon:        "◈",
    color:       "#7DF9C0",
    bgColor:     "rgba(125,249,192,0.06)",
    borderColor: "rgba(125,249,192,0.18)",
  },
  {
    key:         "IDENTITY_VERIFIED",
    label:       "Identity Verified",
    description: "Government ID verified without revealing details",
    claimType:   ethers.id("IDENTITY_VERIFIED"),
    icon:        "◉",
    color:       "#FF8C42",
    bgColor:     "rgba(255,140,66,0.06)",
    borderColor: "rgba(255,140,66,0.18)",
  },
];

const IPFS_GW = "https://ipfs.io/ipfs/";

function shortenAddr(addr) {
  return addr ? `${addr.slice(0, 6)}···${addr.slice(-4)}` : "—";
}
function shortenCID(cid) {
  return cid ? `${cid.slice(0, 8)}···${cid.slice(-6)}` : "—";
}
function tsToDate(ts) {
  if (!ts) return "—";
  return new Date(Number(ts) * 1000).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────────
export default function Dashboard({
  wallet,
  didRegistryAddress,
  zkpVerifierAddress,
  credNFTAddress,
  onGoRegister,
  onGoProve,
}) {
  const [loading,    setLoading]    = useState(true);
  const [didDoc,     setDidDoc]     = useState(null);
  const [hasDID,     setHasDID]     = useState(false);
  const [claims,     setClaims]     = useState({});      // claimKey → {has, verifiedAt}
  const [nftCounts,  setNftCounts]  = useState({ held: 0, total: 0 });
  const [tokens,     setTokens]     = useState({});      // claimKey → tokenId
  const [activity,   setActivity]   = useState([]);
  const [activeTab,  setActiveTab]  = useState("identity");
  const [copied,     setCopied]     = useState(false);
  const canvasRef = useRef(null);

  const address = wallet?.address;

  // ── Fetch all on-chain data ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (!address || !didRegistryAddress) return;
    setLoading(true);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);

      // ── DID ──────────────────────────────────────────────────────────────
      const registry = new ethers.Contract(didRegistryAddress, DID_REGISTRY_ABI, provider);
      const has = await registry.hasActiveDID(address);
      setHasDID(has);
      if (has) {
        const doc = await registry.resolveDID(address);
        setDidDoc({
          did:       doc.did,
          ipfsCID:   doc.ipfsCID,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          isActive:  doc.isActive,
        });
        // Add to activity feed
        setActivity(prev => [
          { type: "did", label: "DID Registered", ts: Number(doc.createdAt), icon: "◈" },
          ...prev.filter(a => a.type !== "did"),
        ]);
      }

      // ── Claims ────────────────────────────────────────────────────────────
      if (zkpVerifierAddress) {
        const verifier = new ethers.Contract(zkpVerifierAddress, ZKP_VERIFIER_ABI, provider);
        const claimsResult = {};
        for (const def of CLAIM_DEFS) {
          const hasClaim = await verifier.hasClaim(address, def.claimType);
          if (hasClaim) {
            const claim = await verifier.getClaim(address, def.claimType);
            claimsResult[def.key] = {
              has: true,
              verifiedAt: Number(claim.verifiedAt),
              isValid: claim.isValid,
            };
            setActivity(prev => [
              ...prev,
              { type: "claim", label: `${def.label} Claim Verified`, ts: Number(claim.verifiedAt), icon: def.icon, color: def.color },
            ]);
          } else {
            claimsResult[def.key] = { has: false };
          }
        }
        setClaims(claimsResult);
      }

      // ── NFTs ──────────────────────────────────────────────────────────────
      if (credNFTAddress) {
        const nft = new ethers.Contract(credNFTAddress, CRED_NFT_ABI, provider);
        const [held, total] = await Promise.all([
          nft.balanceOf(address),
          nft.totalSupply(),
        ]);
        setNftCounts({ held: Number(held), total: Number(total) });

        const tokensResult = {};
        for (const def of CLAIM_DEFS) {
          const tokenId = await nft.getTokenByClaim(address, def.claimType);
          if (Number(tokenId) > 0) {
            tokensResult[def.key] = Number(tokenId);
          }
        }
        setTokens(tokensResult);
      }

    } catch (err) {
      console.error("Dashboard fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [address, didRegistryAddress, zkpVerifierAddress, credNFTAddress]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Particle canvas background ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    const particles = Array.from({ length: 40 }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      r: Math.random() * 1.2 + 0.3,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      o: Math.random() * 0.4 + 0.1,
    }));

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(120,200,255,${p.o})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // ── Copy DID ────────────────────────────────────────────────────────────────
  const handleCopyDID = () => {
    if (!didDoc?.did) return;
    navigator.clipboard.writeText(didDoc.did).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Sort activity by ts descending
  const sortedActivity = [...activity].sort((a, b) => b.ts - a.ts);
  const verifiedCount  = CLAIM_DEFS.filter(d => claims[d.key]?.has).length;

  // ── LOADING ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="db-root">
        <canvas className="db-canvas" ref={canvasRef} />
        <div className="db-loading">
          <div className="db-loading__orbit">
            <span className="db-loading__dot" />
          </div>
          <p className="db-loading__text">Loading identity data…</p>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  return (
    <div className="db-root">
      {/* Particle canvas */}
      <canvas className="db-canvas" ref={canvasRef} />

      {/* ── TOP BAR ── */}
      <header className="db-topbar">
        <div className="db-topbar__brand">
          <HexIcon />
          <span className="db-topbar__name">DID PROTOCOL</span>
        </div>
        <div className="db-topbar__wallet">
          <span className={`db-topbar__dot ${hasDID ? "db-topbar__dot--active" : ""}`} />
          <span className="db-topbar__addr">{shortenAddr(address)}</span>
          <button className="db-topbar__refresh" onClick={fetchData} title="Refresh">
            <RefreshIcon />
          </button>
        </div>
      </header>

      {/* ── HERO IDENTITY CARD ── */}
      <section className="db-hero">
        <div className="db-hero__bg" />

        <div className="db-hero__left">
          {/* Avatar */}
          <div className="db-avatar">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <defs>
                <radialGradient id="avGrad" cx="40%" cy="35%">
                  <stop offset="0%" stopColor={`hsl(${parseInt(address?.slice(2,4)||"80",16)*1.4},70%,65%)`} />
                  <stop offset="100%" stopColor={`hsl(${parseInt(address?.slice(2,4)||"80",16)*1.4},50%,35%)`} />
                </radialGradient>
              </defs>
              <polygon points="36,4 68,20 68,52 36,68 4,52 4,20" fill="url(#avGrad)" />
              <text x="36" y="44" textAnchor="middle" fontSize="22" fill="white" fontWeight="800" fontFamily="monospace">
                {address?.slice(2,4).toUpperCase()}
              </text>
            </svg>
            {hasDID && <span className="db-avatar__badge" title="DID Active">✦</span>}
          </div>

          <div className="db-hero__info">
            {hasDID ? (
              <>
                <div className="db-hero__did-row">
                  <span className="db-hero__did-label">DID</span>
                  <span className="db-hero__did-val">{didDoc?.did?.slice(0, 28)}…</span>
                  <button className="db-copy-btn" onClick={handleCopyDID}>
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
                <div className="db-hero__meta">
                  <span>Registered {tsToDate(didDoc?.createdAt)}</span>
                  <span className="db-hero__sep">·</span>
                  <a href={`${IPFS_GW}${didDoc?.ipfsCID}`} target="_blank"
                    rel="noreferrer" className="db-link">
                    IPFS {shortenCID(didDoc?.ipfsCID)}
                  </a>
                </div>
              </>
            ) : (
              <div className="db-hero__nodid">
                <p className="db-hero__nodid-title">No DID Found</p>
                <p className="db-hero__nodid-sub">Register your decentralised identity to get started.</p>
              </div>
            )}
          </div>
        </div>

        {/* Stat pills */}
        <div className="db-hero__stats">
          <StatPill value={hasDID ? "1" : "0"} label="DID" active={hasDID} />
          <StatPill value={verifiedCount} label="CLAIMS" active={verifiedCount > 0} />
          <StatPill value={nftCounts.held} label="BADGES" active={nftCounts.held > 0} />
        </div>
      </section>

      {/* ── TABS ── */}
      <div className="db-tabs">
        {[
          { id: "identity",    label: "Identity"    },
          { id: "claims",      label: "Claims"      },
          { id: "credentials", label: "Credentials" },
          { id: "activity",    label: "Activity"    },
        ].map(t => (
          <button key={t.id} className="db-tab"
            data-active={activeTab === t.id ? "true" : "false"}
            onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── TAB PANELS ── */}
      <div className="db-panel">

        {/* ── IDENTITY TAB ── */}
        {activeTab === "identity" && (
          <div className="db-tab-content">
            {hasDID ? (
              <>
                <SectionHead title="DID Document" sub="Anchored on Sepolia · Stored on IPFS" />
                <div className="db-doc-grid">
                  <DocRow label="DID"        value={didDoc?.did} mono break />
                  <DocRow label="IPFS CID"   value={didDoc?.ipfsCID}
                    link={`${IPFS_GW}${didDoc?.ipfsCID}`} mono />
                  <DocRow label="Registered" value={tsToDate(didDoc?.createdAt)} />
                  <DocRow label="Updated"    value={tsToDate(didDoc?.updatedAt)} />
                  <DocRow label="Status"     value={didDoc?.isActive ? "Active ●" : "Inactive ○"}
                    accent={didDoc?.isActive ? "#7DF9C0" : "#FF4D6D"} />
                  <DocRow label="Network"    value="Sepolia Testnet" />
                  <DocRow label="Controller" value={address} mono />
                </div>

                <SectionHead title="DID Method" sub="did:ethr — Ethereum-based identifier" />
                <div className="db-info-card">
                  <p className="db-info-card__text">
                    Your DID follows the <strong>did:ethr</strong> method — your Ethereum wallet address
                    is your identity. No central authority. No registration fee. No personal data on-chain.
                    The DID document stored on IPFS contains your public keys and optional service endpoints.
                  </p>
                  <a href="https://github.com/decentralized-identity/ethr-did" target="_blank"
                    rel="noreferrer" className="db-link db-info-card__link">
                    Read the spec →
                  </a>
                </div>
              </>
            ) : (
              <EmptyState
                icon="◎"
                title="No Identity Registered"
                sub="Create your decentralised identifier to own your digital identity."
                action="Register DID"
                onAction={onGoRegister}
              />
            )}
          </div>
        )}

        {/* ── CLAIMS TAB ── */}
        {activeTab === "claims" && (
          <div className="db-tab-content">
            <SectionHead
              title="Verified Claims"
              sub="Zero-knowledge proofs verified on-chain — private data never revealed"
            />
            <div className="db-claims-grid">
              {CLAIM_DEFS.map(def => {
                const claimData = claims[def.key];
                const has = claimData?.has;
                return (
                  <div key={def.key} className="db-claim-card"
                    style={{
                      "--cc-color":  def.color,
                      "--cc-bg":     def.bgColor,
                      "--cc-border": def.borderColor,
                    }}
                    data-active={has ? "true" : "false"}>
                    <div className="db-claim-card__top">
                      <span className="db-claim-card__icon">{def.icon}</span>
                      <span className={`db-claim-card__status ${has ? "db-claim-card__status--on" : ""}`}>
                        {has ? "VERIFIED" : "UNVERIFIED"}
                      </span>
                    </div>
                    <h3 className="db-claim-card__title">{def.label}</h3>
                    <p className="db-claim-card__desc">{def.description}</p>
                    {has ? (
                      <p className="db-claim-card__date">
                        Verified {tsToDate(claimData.verifiedAt)}
                      </p>
                    ) : (
                      <button className="db-claim-card__action" onClick={onGoProve}>
                        Prove Now →
                      </button>
                    )}
                    <div className="db-claim-card__glow" />
                  </div>
                );
              })}
            </div>

            <div className="db-zkp-explainer">
              <ZKPIcon />
              <div>
                <p className="db-zkp-explainer__title">How ZKP Claims Work</p>
                <p className="db-zkp-explainer__body">
                  Your browser generates a mathematical proof that a statement is true
                  (e.g. age ≥ 18) without sending any personal data to the blockchain.
                  The Groth16 zk-SNARK proof is verified in a single on-chain transaction.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── CREDENTIALS TAB ── */}
        {activeTab === "credentials" && (
          <div className="db-tab-content">
            <SectionHead
              title="Soulbound Credentials"
              sub={`${nftCounts.held} badge${nftCounts.held !== 1 ? "s" : ""} held · ${nftCounts.total} minted total`}
            />

            {nftCounts.held === 0 ? (
              <EmptyState
                icon="◆"
                title="No Credential Badges"
                sub="Verify a claim and mint your soulbound NFT credential badge."
                action="Prove Identity"
                onAction={onGoProve}
              />
            ) : (
              <div className="db-badges-grid">
                {CLAIM_DEFS.filter(d => tokens[d.key]).map(def => (
                  <div key={def.key} className="db-badge-card"
                    style={{ "--badge-color": def.color }}>
                    <div className="db-badge-card__shine" />
                    <div className="db-badge-card__top">
                      <span className="db-badge-card__token">#{tokens[def.key]}</span>
                      <span className="db-badge-card__soulbound">SOULBOUND</span>
                    </div>
                    <span className="db-badge-card__icon">{def.icon}</span>
                    <h3 className="db-badge-card__name">{def.label}</h3>
                    <p className="db-badge-card__sub">DID Credential · Sepolia</p>
                    <div className="db-badge-card__footer">
                      <span className="db-badge-card__owner">{shortenAddr(address)}</span>
                      <span className="db-badge-card__lock">
                        <LockIcon />
                        Non-transferable
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="db-soulbound-note">
              <LockIcon />
              <span>
                Soulbound tokens (EIP-5192) are permanently bound to your wallet.
                They cannot be sold, transferred, or moved — making them a trustworthy
                on-chain proof of verified identity.
              </span>
            </div>
          </div>
        )}

        {/* ── ACTIVITY TAB ── */}
        {activeTab === "activity" && (
          <div className="db-tab-content">
            <SectionHead title="On-Chain Activity" sub="Events recorded for this wallet" />

            {sortedActivity.length === 0 ? (
              <EmptyState
                icon="◌"
                title="No Activity Yet"
                sub="Register a DID or verify a claim to see activity here."
              />
            ) : (
              <div className="db-activity">
                {sortedActivity.map((ev, i) => (
                  <div key={i} className="db-activity__item">
                    <div className="db-activity__line" />
                    <div className="db-activity__node"
                      style={{ color: ev.color || "#7DF9C0" }}>
                      {ev.icon}
                    </div>
                    <div className="db-activity__body">
                      <span className="db-activity__label">{ev.label}</span>
                      <span className="db-activity__date">{tsToDate(ev.ts)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>{/* /db-panel */}

      {/* ── QUICK ACTIONS FOOTER ── */}
      <div className="db-actions">
        {!hasDID && (
          <button className="db-action-btn db-action-btn--primary" onClick={onGoRegister}>
            <PlusIcon /> Register DID
          </button>
        )}
        {hasDID && verifiedCount < CLAIM_DEFS.length && (
          <button className="db-action-btn db-action-btn--accent" onClick={onGoProve}>
            <ShieldIcon /> Prove Identity
          </button>
        )}
        <button className="db-action-btn db-action-btn--ghost" onClick={fetchData}>
          <RefreshIcon /> Refresh
        </button>
      </div>

      <style>{CSS}</style>
    </div>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function StatPill({ value, label, active }) {
  return (
    <div className={`db-stat-pill ${active ? "db-stat-pill--active" : ""}`}>
      <span className="db-stat-pill__val">{value}</span>
      <span className="db-stat-pill__label">{label}</span>
    </div>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div className="db-section-head">
      <h2 className="db-section-head__title">{title}</h2>
      {sub && <p className="db-section-head__sub">{sub}</p>}
    </div>
  );
}

function DocRow({ label, value, mono, link, accent, break: brk }) {
  return (
    <div className="db-doc-row">
      <span className="db-doc-row__label">{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer"
          className={`db-doc-row__value db-link ${mono ? "db-doc-row__value--mono" : ""}`}>
          {value}
        </a>
      ) : (
        <span
          className={`db-doc-row__value ${mono ? "db-doc-row__value--mono" : ""} ${brk ? "db-doc-row__value--break" : ""}`}
          style={accent ? { color: accent } : {}}>
          {value}
        </span>
      )}
    </div>
  );
}

function EmptyState({ icon, title, sub, action, onAction }) {
  return (
    <div className="db-empty">
      <span className="db-empty__icon">{icon}</span>
      <p className="db-empty__title">{title}</p>
      <p className="db-empty__sub">{sub}</p>
      {action && onAction && (
        <button className="db-empty__btn" onClick={onAction}>{action} →</button>
      )}
    </div>
  );
}

// ── ICONS ─────────────────────────────────────────────────────────────────────
function HexIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5">
      <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" />
      <polygon points="12,6 18,9.5 18,14.5 12,18 6,14.5 6,9.5" fill="currentColor" opacity=".3"/>
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}
function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  );
}
function ZKPIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
      stroke="#7878a0" strokeWidth="1.2" strokeLinecap="round" style={{ flexShrink: 0 }}>
      <circle cx="18" cy="18" r="15"/>
      <path d="M12 13h12l-12 10h12" strokeWidth="1.8"/>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&display=swap');

  /* ── root tokens ─────────────────────────────────────────────────── */
  .db-root {
    --db-bg:       #07070c;
    --db-surface:  #0f0f16;
    --db-surface2: #16161f;
    --db-surface3: #1c1c28;
    --db-border:   rgba(255,255,255,0.06);
    --db-border-hi:rgba(255,255,255,0.12);
    --db-text:     #e4e4f0;
    --db-muted:    #40405a;
    --db-muted2:   #7070a0;
    --db-green:    #7DF9C0;
    --db-orange:   #FF8C42;
    --db-blue:     #78b4ff;
    --db-error:    #FF4D6D;
    --db-mono:     'DM Mono', monospace;
    --db-display:  'DM Serif Display', serif;
    --db-radius:   16px;

    font-family:    var(--db-mono);
    color:          var(--db-text);
    background:     var(--db-bg);
    min-height:     100vh;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    padding:        0 16px 100px;
    gap:            0;
    position:       relative;
    overflow-x:     hidden;
  }

  /* ── particle canvas ─────────────────────────────────────────────── */
  .db-canvas {
    position: fixed;
    inset:    0;
    width:    100%;
    height:   100%;
    pointer-events: none;
    opacity:  0.5;
    z-index:  0;
  }
  .db-root > *:not(.db-canvas) { position: relative; z-index: 1; }

  /* ── loading ─────────────────────────────────────────────────────── */
  .db-loading {
    position:       fixed;
    inset:          0;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    justify-content: center;
    gap:            20px;
    z-index:        10;
  }
  .db-loading__orbit {
    width:         48px;
    height:        48px;
    border-radius: 50%;
    border:        2px solid var(--db-border-hi);
    border-top-color: var(--db-green);
    animation:     dbSpin 1s linear infinite;
  }
  .db-loading__text {
    margin:      0;
    font-size:   13px;
    color:       var(--db-muted2);
    letter-spacing: 0.1em;
  }

  /* ── top bar ─────────────────────────────────────────────────────── */
  .db-topbar {
    width:         100%;
    max-width:     900px;
    display:       flex;
    align-items:   center;
    justify-content: space-between;
    padding:       20px 0 16px;
    border-bottom: 1px solid var(--db-border);
    margin-bottom: 32px;
  }
  .db-topbar__brand {
    display:     flex;
    align-items: center;
    gap:         8px;
    color:       var(--db-muted2);
    font-size:   11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .db-topbar__wallet {
    display:     flex;
    align-items: center;
    gap:         8px;
    font-size:   12px;
    color:       var(--db-muted2);
  }
  .db-topbar__dot {
    width:         7px;
    height:        7px;
    border-radius: 50%;
    background:    var(--db-muted);
  }
  .db-topbar__dot--active {
    background: var(--db-green);
    box-shadow: 0 0 8px rgba(125,249,192,0.5);
    animation:  dbPulse 2s ease-in-out infinite;
  }
  .db-topbar__addr { font-weight: 500; }
  .db-topbar__refresh {
    background:   transparent;
    border:       none;
    color:        var(--db-muted);
    cursor:       pointer;
    padding:      4px;
    border-radius: 4px;
    display:      flex;
    transition:   color 0.15s;
  }
  .db-topbar__refresh:hover { color: var(--db-text); }

  /* ── hero card ───────────────────────────────────────────────────── */
  .db-hero {
    width:         100%;
    max-width:     900px;
    background:    var(--db-surface);
    border:        1px solid var(--db-border);
    border-radius: var(--db-radius);
    padding:       28px 32px;
    display:       flex;
    align-items:   center;
    justify-content: space-between;
    gap:           24px;
    position:      relative;
    overflow:      hidden;
    margin-bottom: 20px;
    animation:     dbFadeUp 0.5s ease both;
  }
  .db-hero__bg {
    position:   absolute;
    inset:      0;
    background: radial-gradient(ellipse 70% 100% at 0% 50%, rgba(120,180,255,0.04), transparent);
    pointer-events: none;
  }
  .db-hero__left {
    display:     flex;
    align-items: center;
    gap:         20px;
    flex:        1;
    min-width:   0;
  }

  /* avatar */
  .db-avatar {
    position:   relative;
    flex-shrink: 0;
    line-height: 0;
  }
  .db-avatar__badge {
    position:      absolute;
    bottom:        -2px;
    right:         -2px;
    width:         18px;
    height:        18px;
    background:    var(--db-green);
    border-radius: 50%;
    border:        2px solid var(--db-bg);
    display:       flex;
    align-items:   center;
    justify-content: center;
    font-size:     8px;
    color:         #07070c;
    line-height:   1;
  }

  .db-hero__info { min-width: 0; }
  .db-hero__did-row {
    display:     flex;
    align-items: center;
    gap:         8px;
    margin-bottom: 6px;
  }
  .db-hero__did-label {
    font-size:      9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color:          var(--db-green);
    background:     rgba(125,249,192,0.08);
    border:         1px solid rgba(125,249,192,0.15);
    padding:        2px 7px;
    border-radius:  4px;
    flex-shrink:    0;
  }
  .db-hero__did-val {
    font-size:     13px;
    font-weight:   500;
    color:         var(--db-text);
    white-space:   nowrap;
    overflow:      hidden;
    text-overflow: ellipsis;
  }
  .db-copy-btn {
    background:   transparent;
    border:       none;
    color:        var(--db-muted2);
    cursor:       pointer;
    padding:      4px;
    border-radius: 4px;
    display:      flex;
    flex-shrink:  0;
    transition:   color 0.15s;
  }
  .db-copy-btn:hover { color: var(--db-text); }
  .db-hero__meta {
    font-size:   11px;
    color:       var(--db-muted2);
    display:     flex;
    align-items: center;
    gap:         6px;
  }
  .db-hero__sep { color: var(--db-muted); }
  .db-hero__nodid-title { margin: 0 0 4px; font-size: 16px; color: var(--db-text); }
  .db-hero__nodid-sub   { margin: 0; font-size: 12px; color: var(--db-muted2); }

  /* stat pills */
  .db-hero__stats {
    display:     flex;
    gap:         10px;
    flex-shrink: 0;
  }
  .db-stat-pill {
    display:        flex;
    flex-direction: column;
    align-items:    center;
    padding:        10px 16px;
    background:     var(--db-surface2);
    border:         1px solid var(--db-border);
    border-radius:  10px;
    min-width:      56px;
    transition:     border-color 0.2s;
  }
  .db-stat-pill--active { border-color: rgba(125,249,192,0.2); }
  .db-stat-pill__val {
    font-family: var(--db-display);
    font-size:   24px;
    line-height: 1;
    color:       var(--db-text);
  }
  .db-stat-pill--active .db-stat-pill__val { color: var(--db-green); }
  .db-stat-pill__label {
    font-size:      9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color:          var(--db-muted2);
    margin-top:     4px;
  }

  /* ── tabs ────────────────────────────────────────────────────────── */
  .db-tabs {
    display:   flex;
    gap:       0;
    width:     100%;
    max-width: 900px;
    border-bottom: 1px solid var(--db-border);
    margin-bottom: 0;
    animation: dbFadeUp 0.5s 0.1s ease both;
  }
  .db-tab {
    background:     transparent;
    border:         none;
    color:          var(--db-muted2);
    font-family:    var(--db-mono);
    font-size:      11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding:        12px 20px;
    cursor:         pointer;
    border-bottom:  2px solid transparent;
    transition:     all 0.2s;
    margin-bottom:  -1px;
  }
  .db-tab:hover { color: var(--db-text); }
  .db-tab[data-active="true"] {
    color:        var(--db-text);
    border-color: var(--db-green);
  }

  /* ── main panel ──────────────────────────────────────────────────── */
  .db-panel {
    width:         100%;
    max-width:     900px;
    background:    var(--db-surface);
    border:        1px solid var(--db-border);
    border-top:    none;
    border-radius: 0 0 var(--db-radius) var(--db-radius);
    min-height:    320px;
    margin-bottom: 24px;
    animation:     dbFadeUp 0.5s 0.15s ease both;
  }
  .db-tab-content {
    padding:        28px 32px;
    display:        flex;
    flex-direction: column;
    gap:            24px;
  }

  /* ── section heads ───────────────────────────────────────────────── */
  .db-section-head__title {
    font-family: var(--db-display);
    font-size:   22px;
    margin:      0 0 4px;
    font-weight: 400;
    font-style:  italic;
  }
  .db-section-head__sub {
    margin:    0;
    font-size: 11px;
    color:     var(--db-muted2);
    letter-spacing: 0.04em;
  }

  /* ── doc grid ────────────────────────────────────────────────────── */
  .db-doc-grid {
    display:        flex;
    flex-direction: column;
    border:         1px solid var(--db-border);
    border-radius:  10px;
    overflow:       hidden;
  }
  .db-doc-row {
    display:     flex;
    align-items: flex-start;
    gap:         16px;
    padding:     11px 16px;
    border-bottom: 1px solid var(--db-border);
    font-size:   12px;
  }
  .db-doc-row:last-child { border-bottom: none; }
  .db-doc-row:nth-child(even) { background: rgba(255,255,255,0.015); }
  .db-doc-row__label {
    width:       100px;
    flex-shrink: 0;
    color:       var(--db-muted2);
    font-size:   11px;
    letter-spacing: 0.06em;
  }
  .db-doc-row__value { color: var(--db-text); font-weight: 500; }
  .db-doc-row__value--mono { font-size: 11px; letter-spacing: 0.02em; }
  .db-doc-row__value--break { word-break: break-all; }

  /* ── info card ───────────────────────────────────────────────────── */
  .db-info-card {
    background:    var(--db-surface2);
    border:        1px solid var(--db-border);
    border-radius: 10px;
    padding:       18px 20px;
    display:       flex;
    flex-direction: column;
    gap:           10px;
  }
  .db-info-card__text {
    margin:      0;
    font-size:   12px;
    color:       var(--db-muted2);
    line-height: 1.7;
  }
  .db-info-card__text strong { color: var(--db-text); }
  .db-info-card__link { font-size: 12px; }

  /* ── claims grid ─────────────────────────────────────────────────── */
  .db-claims-grid {
    display:               grid;
    grid-template-columns: 1fr 1fr;
    gap:                   16px;
  }
  .db-claim-card {
    background:    var(--cc-bg);
    border:        1px solid var(--cc-border);
    border-radius: 12px;
    padding:       20px;
    display:       flex;
    flex-direction: column;
    gap:           8px;
    position:      relative;
    overflow:      hidden;
    transition:    transform 0.2s;
  }
  .db-claim-card:hover { transform: translateY(-2px); }
  .db-claim-card__glow {
    position:   absolute;
    inset:      0;
    background: radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in srgb, var(--cc-color) 8%, transparent), transparent);
    pointer-events: none;
  }
  .db-claim-card__top {
    display:     flex;
    align-items: center;
    justify-content: space-between;
  }
  .db-claim-card__icon { font-size: 24px; color: var(--cc-color); }
  .db-claim-card__status {
    font-size:      9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color:          var(--db-muted);
    border:         1px solid var(--db-border);
    padding:        2px 8px;
    border-radius:  20px;
  }
  .db-claim-card__status--on {
    color:        var(--cc-color);
    border-color: color-mix(in srgb, var(--cc-color) 30%, transparent);
    background:   color-mix(in srgb, var(--cc-color) 6%, transparent);
  }
  .db-claim-card__title {
    margin:      0;
    font-size:   16px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .db-claim-card__desc {
    margin:      0;
    font-size:   11px;
    color:       var(--db-muted2);
    line-height: 1.5;
    flex:        1;
  }
  .db-claim-card__date {
    margin:      0;
    font-size:   11px;
    color:       var(--cc-color);
  }
  .db-claim-card__action {
    background:   transparent;
    border:       1px solid var(--cc-border);
    color:        var(--cc-color);
    font-family:  var(--db-mono);
    font-size:    11px;
    padding:      7px 12px;
    border-radius: 6px;
    cursor:       pointer;
    text-align:   left;
    transition:   background 0.15s;
    margin-top:   4px;
  }
  .db-claim-card__action:hover {
    background: color-mix(in srgb, var(--cc-color) 10%, transparent);
  }

  /* ── ZKP explainer ───────────────────────────────────────────────── */
  .db-zkp-explainer {
    display:       flex;
    gap:           16px;
    align-items:   flex-start;
    padding:       16px 20px;
    background:    var(--db-surface2);
    border:        1px solid var(--db-border);
    border-radius: 10px;
  }
  .db-zkp-explainer__title {
    margin:         0 0 5px;
    font-size:      13px;
    font-weight:    600;
    letter-spacing: 0.05em;
  }
  .db-zkp-explainer__body {
    margin:      0;
    font-size:   11px;
    color:       var(--db-muted2);
    line-height: 1.6;
  }

  /* ── badges grid ─────────────────────────────────────────────────── */
  .db-badges-grid {
    display:               grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap:                   16px;
  }
  .db-badge-card {
    background:    var(--db-surface2);
    border:        1px solid color-mix(in srgb, var(--badge-color) 20%, transparent);
    border-radius: 14px;
    padding:       20px;
    display:       flex;
    flex-direction: column;
    gap:           6px;
    position:      relative;
    overflow:      hidden;
    transition:    transform 0.2s;
  }
  .db-badge-card:hover { transform: translateY(-3px); }
  .db-badge-card__shine {
    position:   absolute;
    top:        -40px; left: -40px;
    width:      120px; height: 120px;
    background: radial-gradient(circle, color-mix(in srgb, var(--badge-color) 20%, transparent), transparent 70%);
    pointer-events: none;
  }
  .db-badge-card__top {
    display:     flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .db-badge-card__token {
    font-size:      10px;
    letter-spacing: 0.1em;
    color:          var(--badge-color);
    font-weight:    600;
  }
  .db-badge-card__soulbound {
    font-size:      8px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color:          var(--db-muted);
    border:         1px solid var(--db-border);
    padding:        1px 6px;
    border-radius:  4px;
  }
  .db-badge-card__icon { font-size: 36px; color: var(--badge-color); line-height: 1; }
  .db-badge-card__name {
    margin:         0;
    font-size:      15px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .db-badge-card__sub {
    margin:    0;
    font-size: 10px;
    color:     var(--db-muted2);
    letter-spacing: 0.06em;
  }
  .db-badge-card__footer {
    display:     flex;
    align-items: center;
    justify-content: space-between;
    margin-top:  8px;
    padding-top: 8px;
    border-top:  1px solid var(--db-border);
    font-size:   10px;
    color:       var(--db-muted2);
  }
  .db-badge-card__owner { font-weight: 500; }
  .db-badge-card__lock  { display: flex; align-items: center; gap: 4px; }

  /* ── soulbound note ──────────────────────────────────────────────── */
  .db-soulbound-note {
    display:       flex;
    gap:           10px;
    align-items:   flex-start;
    padding:       12px 16px;
    background:    var(--db-surface2);
    border:        1px solid var(--db-border);
    border-radius: 8px;
    font-size:     11px;
    color:         var(--db-muted2);
    line-height:   1.6;
  }

  /* ── activity feed ───────────────────────────────────────────────── */
  .db-activity {
    display:        flex;
    flex-direction: column;
    gap:            0;
  }
  .db-activity__item {
    display:     flex;
    align-items: flex-start;
    gap:         14px;
    padding:     14px 0;
    position:    relative;
  }
  .db-activity__item:not(:last-child) .db-activity__line {
    position:   absolute;
    left:       13px;
    top:        36px;
    bottom:     0;
    width:      1px;
    background: var(--db-border);
  }
  .db-activity__node {
    width:         28px;
    height:        28px;
    border-radius: 50%;
    background:    var(--db-surface2);
    border:        1px solid var(--db-border);
    display:       flex;
    align-items:   center;
    justify-content: center;
    font-size:     12px;
    flex-shrink:   0;
  }
  .db-activity__body {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    padding-top:    4px;
  }
  .db-activity__label { font-size: 13px; font-weight: 500; }
  .db-activity__date  { font-size: 11px; color: var(--db-muted2); }

  /* ── empty state ─────────────────────────────────────────────────── */
  .db-empty {
    display:        flex;
    flex-direction: column;
    align-items:    center;
    padding:        48px 24px;
    gap:            12px;
    text-align:     center;
  }
  .db-empty__icon  { font-size: 40px; color: var(--db-muted); }
  .db-empty__title { margin: 0; font-family: var(--db-display); font-size: 22px; font-style: italic; }
  .db-empty__sub   { margin: 0; font-size: 12px; color: var(--db-muted2); max-width: 320px; line-height: 1.6; }
  .db-empty__btn {
    margin-top:    8px;
    background:    transparent;
    border:        1px solid var(--db-border-hi);
    color:         var(--db-text);
    font-family:   var(--db-mono);
    font-size:     12px;
    padding:       10px 20px;
    border-radius: 8px;
    cursor:        pointer;
    transition:    all 0.2s;
    letter-spacing: 0.06em;
  }
  .db-empty__btn:hover {
    border-color: var(--db-green);
    color:        var(--db-green);
  }

  /* ── quick actions ───────────────────────────────────────────────── */
  .db-actions {
    display:     flex;
    gap:         10px;
    width:       100%;
    max-width:   900px;
    animation:   dbFadeUp 0.5s 0.3s ease both;
  }
  .db-action-btn {
    display:         flex;
    align-items:     center;
    justify-content: center;
    gap:             8px;
    padding:         12px 22px;
    border-radius:   10px;
    border:          none;
    cursor:          pointer;
    font-family:     var(--db-mono);
    font-size:       12px;
    font-weight:     500;
    letter-spacing:  0.1em;
    text-transform:  uppercase;
    transition:      all 0.2s;
  }
  .db-action-btn--primary {
    background: var(--db-green);
    color:      #07070c;
  }
  .db-action-btn--primary:hover {
    background: #a0ffd4;
    transform:  translateY(-1px);
    box-shadow: 0 4px 20px rgba(125,249,192,0.25);
  }
  .db-action-btn--accent {
    background: var(--db-orange);
    color:      #07070c;
  }
  .db-action-btn--accent:hover {
    background: #ffaa6a;
    transform:  translateY(-1px);
    box-shadow: 0 4px 20px rgba(255,140,66,0.25);
  }
  .db-action-btn--ghost {
    background:   transparent;
    color:        var(--db-muted2);
    border:       1px solid var(--db-border-hi);
  }
  .db-action-btn--ghost:hover {
    color:        var(--db-text);
    border-color: rgba(255,255,255,0.25);
  }

  /* ── shared ──────────────────────────────────────────────────────── */
  .db-link { color: var(--db-blue); text-decoration: none; }
  .db-link:hover { text-decoration: underline; }

  /* ── animations ──────────────────────────────────────────────────── */
  @keyframes dbFadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes dbSpin {
    to { transform: rotate(360deg); }
  }
  @keyframes dbPulse {
    0%, 100% { box-shadow: 0 0 8px rgba(125,249,192,0.4); }
    50%      { box-shadow: 0 0 14px rgba(125,249,192,0.7); }
  }
`;
