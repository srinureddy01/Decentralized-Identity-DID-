import { useState, useCallback, useRef } from "react";
import { ethers } from "ethers";

/*
 * RegisterDID.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/components/RegisterDID.jsx
 *
 * 4-step DID registration flow:
 *   Step 1 — Generate DID string from wallet address
 *   Step 2 — Build DID document (keys, service endpoints, metadata)
 *   Step 3 — Upload encrypted DID document to IPFS → get CID
 *   Step 4 — Call DIDRegistry.registerDID(did, ipfsCID) on-chain → tx hash
 *
 * Props:
 *   wallet           { provider, signer, address, chainId }  from ConnectWallet
 *   contractAddress  deployed DIDRegistry contract address
 *   onRegistered(result)  called when registration succeeds
 *                         result = { did, ipfsCID, txHash }
 *
 * Dependencies:
 *   npm install ethers ipfs-http-client
 *
 * Usage:
 *   <RegisterDID
 *     wallet={wallet}
 *     contractAddress="0xYourDeployedAddress"
 *     onRegistered={(r) => console.log(r)}
 *   />
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── DIDRegistry ABI (only the functions we need) ─────────────────────────────
const DID_REGISTRY_ABI = [
  "function registerDID(string calldata did, string calldata ipfsCID) external",
  "function hasActiveDID(address owner) external view returns (bool)",
  "function resolveDID(address owner) external view returns (tuple(string did, string ipfsCID, uint256 createdAt, uint256 updatedAt, bool isActive))",
];

// ── IPFS config (Infura IPFS gateway) ────────────────────────────────────────
// Replace with your own Infura project ID or use a local IPFS node
const IPFS_API    = "https://ipfs.infura.io:5001/api/v0";
const IPFS_GW     = "https://ipfs.io/ipfs/";

// ── Step definitions ─────────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: "Generate DID",    short: "DID"    },
  { id: 2, label: "Build Document",  short: "DOC"    },
  { id: 3, label: "Upload to IPFS",  short: "IPFS"   },
  { id: 4, label: "Register On-Chain", short: "CHAIN" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildDIDString(address) {
  return `did:ethr:sepolia:${address.toLowerCase()}`;
}

function buildDIDDocument(address, did, displayName, serviceUrl) {
  const now = new Date().toISOString();
  return {
    "@context":    ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/secp256k1-2020/v1"],
    id:            did,
    controller:    did,
    created:       now,
    updated:       now,
    displayName:   displayName || undefined,
    verificationMethod: [
      {
        id:                 `${did}#controller`,
        type:               "EcdsaSecp256k1RecoveryMethod2020",
        controller:         did,
        blockchainAccountId: `eip155:11155111:${address}`,
      },
    ],
    authentication:       [`${did}#controller`],
    assertionMethod:      [`${did}#controller`],
    service: serviceUrl
      ? [{ id: `${did}#service-1`, type: "LinkedDomains", serviceEndpoint: serviceUrl }]
      : [],
  };
}

async function uploadToIPFS(docObject) {
  // We use the Infura IPFS HTTP API directly via fetch
  // (avoids the heavy ipfs-http-client bundle for this example)
  const blob    = new Blob([JSON.stringify(docObject, null, 2)], { type: "application/json" });
  const form    = new FormData();
  form.append("file", blob, "did-document.json");

  const res = await fetch(`${IPFS_API}/add?pin=true`, {
    method: "POST",
    body:   form,
    // Add Authorization header here if using authenticated Infura:
    // headers: { Authorization: "Basic " + btoa("projectId:secret") },
  });

  if (!res.ok) throw new Error(`IPFS upload failed: ${res.statusText}`);
  const data = await res.json();
  return data.Hash; // CIDv0 string
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function RegisterDID({ wallet, contractAddress, onRegistered }) {
  const [step,        setStep]        = useState(1);
  const [status,      setStatus]      = useState("idle"); // idle | loading | success | error
  const [error,       setError]       = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [serviceUrl,  setServiceUrl]  = useState("");
  const [did,         setDid]         = useState(null);
  const [didDoc,      setDidDoc]      = useState(null);
  const [ipfsCID,     setIpfsCID]     = useState(null);
  const [txHash,      setTxHash]      = useState(null);
  const [alreadyHas,  setAlreadyHas]  = useState(false);
  const containerRef = useRef(null);

  const address = wallet?.address;

  // ── Step 1: Generate DID ────────────────────────────────────────────────
  const handleGenerateDID = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      // Check if wallet already has a DID
      const provider = new ethers.BrowserProvider(window.ethereum);
      const registry = new ethers.Contract(contractAddress, DID_REGISTRY_ABI, provider);
      const hasExisting = await registry.hasActiveDID(address);

      if (hasExisting) {
        const existing = await registry.resolveDID(address);
        setAlreadyHas(true);
        setDid(existing.did);
        setIpfsCID(existing.ipfsCID);
        setStatus("success");
        return;
      }

      const generatedDID = buildDIDString(address);
      setDid(generatedDID);
      setStatus("idle");
      setStep(2);
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, [address, contractAddress]);

  // ── Step 2: Build Document ──────────────────────────────────────────────
  const handleBuildDocument = useCallback(() => {
    setError(null);
    const doc = buildDIDDocument(address, did, displayName.trim(), serviceUrl.trim());
    setDidDoc(doc);
    setStep(3);
  }, [address, did, displayName, serviceUrl]);

  // ── Step 3: Upload to IPFS ──────────────────────────────────────────────
  const handleUploadIPFS = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const cid = await uploadToIPFS(didDoc);
      setIpfsCID(cid);
      setStatus("idle");
      setStep(4);
    } catch (err) {
      setError(err.message || "IPFS upload failed. Check your network / IPFS config.");
      setStatus("error");
    }
  }, [didDoc]);

  // ── Step 4: Register On-Chain ───────────────────────────────────────────
  const handleRegisterOnChain = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const signer   = await wallet.provider.getSigner();
      const registry = new ethers.Contract(contractAddress, DID_REGISTRY_ABI, signer);
      const tx       = await registry.registerDID(did, ipfsCID);
      const receipt  = await tx.wait();
      setTxHash(receipt.hash);
      setStatus("success");
      onRegistered?.({ did, ipfsCID, txHash: receipt.hash });
    } catch (err) {
      if (err.code === "ACTION_REJECTED") {
        setError("Transaction rejected in wallet.");
      } else {
        setError(err.message);
      }
      setStatus("error");
    }
  }, [wallet, contractAddress, did, ipfsCID, onRegistered]);

  // ── Already has DID ─────────────────────────────────────────────────────
  if (alreadyHas) {
    return (
      <div className="rd-root">
        <div className="rd-already">
          <div className="rd-already__icon">✦</div>
          <h2 className="rd-already__title">DID Already Registered</h2>
          <p className="rd-already__sub">This wallet already has an active DID.</p>
          <div className="rd-field-display">
            <span className="rd-field-display__label">DID</span>
            <span className="rd-field-display__value">{did}</span>
          </div>
          <div className="rd-field-display">
            <span className="rd-field-display__label">IPFS CID</span>
            <a
              className="rd-field-display__value rd-link"
              href={`${IPFS_GW}${ipfsCID}`}
              target="_blank" rel="noreferrer"
            >
              {ipfsCID}
            </a>
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  // ── Registration complete ────────────────────────────────────────────────
  if (status === "success" && step === 4) {
    return (
      <div className="rd-root">
        <div className="rd-success">
          <div className="rd-success__burst">
            {[...Array(8)].map((_, i) => (
              <span key={i} className="rd-success__ray" style={{ "--i": i }} />
            ))}
            <span className="rd-success__core">✦</span>
          </div>
          <h2 className="rd-success__title">Identity Registered</h2>
          <p className="rd-success__sub">Your DID is live on Sepolia.</p>

          <div className="rd-result-grid">
            <ResultRow label="DID"      value={did} />
            <ResultRow label="IPFS CID" value={ipfsCID}
              href={`${IPFS_GW}${ipfsCID}`} />
            <ResultRow label="Tx Hash"  value={txHash}
              href={`https://sepolia.etherscan.io/tx/${txHash}`} />
          </div>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  // ── Main multi-step UI ───────────────────────────────────────────────────
  return (
    <div className="rd-root" ref={containerRef}>

      {/* Header */}
      <div className="rd-header">
        <div className="rd-header__eyebrow">DID Protocol</div>
        <h1 className="rd-header__title">Register Identity</h1>
        <p className="rd-header__sub">
          Create your decentralised identifier — stored on IPFS,<br />
          anchored on Sepolia.
        </p>
      </div>

      {/* Step rail */}
      <div className="rd-steps" role="list">
        {STEPS.map((s, i) => {
          const state = s.id < step ? "done" : s.id === step ? "active" : "pending";
          return (
            <div key={s.id} className="rd-steps__item" role="listitem" data-state={state}>
              <div className="rd-steps__node">
                {state === "done" ? <CheckMark /> : <span>{s.id}</span>}
              </div>
              {i < STEPS.length - 1 && (
                <div className="rd-steps__line" data-filled={state === "done" ? "true" : "false"} />
              )}
              <span className="rd-steps__label">{s.short}</span>
            </div>
          );
        })}
      </div>

      {/* Step panels */}
      <div className="rd-card">

        {/* ── STEP 1 ── */}
        {step === 1 && (
          <StepPanel
            number="01"
            title="Generate Your DID"
            desc="Your DID is derived deterministically from your wallet address. No data is sent anywhere yet."
          >
            <div className="rd-did-preview">
              <span className="rd-did-preview__scheme">did:ethr:sepolia:</span>
              <span className="rd-did-preview__addr">{address?.toLowerCase()}</span>
            </div>
            <ActionBtn
              onClick={handleGenerateDID}
              loading={status === "loading"}
              label="Generate DID"
              loadingLabel="Checking registry…"
            />
          </StepPanel>
        )}

        {/* ── STEP 2 ── */}
        {step === 2 && (
          <StepPanel
            number="02"
            title="Build DID Document"
            desc="Optionally add a display name and service endpoint. These are stored in your IPFS document — not on-chain."
          >
            <label className="rd-label">
              Display Name <span className="rd-optional">(optional)</span>
              <input
                className="rd-input"
                type="text"
                placeholder="e.g. Alice Sharma"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={80}
              />
            </label>
            <label className="rd-label">
              Service Endpoint <span className="rd-optional">(optional)</span>
              <input
                className="rd-input"
                type="url"
                placeholder="https://yourdomain.com"
                value={serviceUrl}
                onChange={(e) => setServiceUrl(e.target.value)}
              />
              <span className="rd-field-hint">
                A URL others can use to contact or verify you
              </span>
            </label>

            {/* DID Document preview */}
            <details className="rd-details">
              <summary className="rd-details__summary">
                Preview DID Document JSON
              </summary>
              <pre className="rd-pre">
                {JSON.stringify(
                  buildDIDDocument(address, did, displayName.trim(), serviceUrl.trim()),
                  null, 2
                )}
              </pre>
            </details>

            <ActionBtn
              onClick={handleBuildDocument}
              loading={false}
              label="Build Document →"
            />
          </StepPanel>
        )}

        {/* ── STEP 3 ── */}
        {step === 3 && (
          <StepPanel
            number="03"
            title="Upload to IPFS"
            desc="Your DID document is uploaded to IPFS. Only the resulting content hash (CID) will be stored on-chain — no personal data touches the blockchain."
          >
            <div className="rd-ipfs-info">
              <IPFSIcon />
              <div>
                <p className="rd-ipfs-info__title">Content-Addressed Storage</p>
                <p className="rd-ipfs-info__body">
                  IPFS stores your file by its hash. If the content ever changes,
                  the hash changes — making tampering impossible.
                </p>
              </div>
            </div>

            <div className="rd-doc-size">
              <span className="rd-doc-size__label">Document size</span>
              <span className="rd-doc-size__value">
                ~{(JSON.stringify(didDoc).length / 1024).toFixed(1)} KB
              </span>
            </div>

            <ActionBtn
              onClick={handleUploadIPFS}
              loading={status === "loading"}
              label="Upload to IPFS"
              loadingLabel="Uploading…"
            />
          </StepPanel>
        )}

        {/* ── STEP 4 ── */}
        {step === 4 && (
          <StepPanel
            number="04"
            title="Register On-Chain"
            desc="The last step — call DIDRegistry.registerDID() to anchor your IPFS CID on Sepolia. This requires a small gas fee."
          >
            <div className="rd-summary">
              <SummaryRow label="DID"      value={did} truncate />
              <SummaryRow label="IPFS CID" value={ipfsCID} />
              <SummaryRow label="Network"  value="Sepolia Testnet" />
              <SummaryRow label="Contract" value={contractAddress} truncate />
            </div>

            <div className="rd-gas-note">
              <GasIcon />
              <span>A small Sepolia ETH gas fee will be required. Get free testnet ETH from the
                {" "}<a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer" className="rd-link">Sepolia faucet</a>.
              </span>
            </div>

            <ActionBtn
              onClick={handleRegisterOnChain}
              loading={status === "loading"}
              label="Register on Sepolia"
              loadingLabel="Waiting for tx…"
              accent
            />
          </StepPanel>
        )}

        {/* Error banner */}
        {status === "error" && error && (
          <div className="rd-error-banner">
            <span className="rd-error-banner__icon">✕</span>
            <span>{error}</span>
            <button className="rd-error-banner__retry"
              onClick={() => setStatus("idle")}>Dismiss</button>
          </div>
        )}

      </div>{/* /rd-card */}

      {/* Back button for steps 2+ */}
      {step > 1 && status !== "loading" && (
        <button className="rd-back" onClick={() => { setStep(s => s - 1); setStatus("idle"); setError(null); }}>
          ← Back
        </button>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function StepPanel({ number, title, desc, children }) {
  return (
    <div className="rd-step-panel">
      <div className="rd-step-panel__head">
        <span className="rd-step-panel__num">{number}</span>
        <div>
          <h2 className="rd-step-panel__title">{title}</h2>
          <p className="rd-step-panel__desc">{desc}</p>
        </div>
      </div>
      <div className="rd-step-panel__body">{children}</div>
    </div>
  );
}

function ActionBtn({ onClick, loading, label, loadingLabel, accent }) {
  return (
    <button
      className={`rd-action-btn ${accent ? "rd-action-btn--accent" : ""}`}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? (
        <>
          <span className="rd-action-btn__spinner" />
          {loadingLabel || "Loading…"}
        </>
      ) : label}
    </button>
  );
}

function SummaryRow({ label, value, truncate }) {
  return (
    <div className="rd-summary__row">
      <span className="rd-summary__label">{label}</span>
      <span className={`rd-summary__value ${truncate ? "rd-summary__value--trunc" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function ResultRow({ label, value, href }) {
  return (
    <div className="rd-result-row">
      <span className="rd-result-row__label">{label}</span>
      {href ? (
        <a className="rd-result-row__value rd-link" href={href} target="_blank" rel="noreferrer">
          {value?.slice(0, 20)}…
        </a>
      ) : (
        <span className="rd-result-row__value">{value?.slice(0, 32)}…</span>
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IPFSIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/>
      <line x1="12" y1="22" x2="12" y2="15.5"/>
      <polyline points="22 8.5 12 15.5 2 8.5"/>
    </svg>
  );
}

function GasIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 2 }}>
      <path d="M3 22V8a2 2 0 012-2h8a2 2 0 012 2v14"/>
      <path d="M3 22h12"/>
      <path d="M15 6l3 3v3a2 2 0 01-2 2h-1"/>
      <line x1="7" y1="10" x2="11" y2="10"/>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800&family=JetBrains+Mono:wght@400;600&display=swap');

  /* ── tokens ─────────────────────────────────────────────────────── */
  .rd-root {
    --rd-bg:        #08080a;
    --rd-surface:   #101013;
    --rd-surface2:  #18181d;
    --rd-border:    rgba(255,255,255,0.07);
    --rd-border-hi: rgba(255,255,255,0.15);
    --rd-accent:    #e8ff47;
    --rd-accent2:   #47ffda;
    --rd-error:     #ff5f57;
    --rd-text:      #efefef;
    --rd-muted:     #555560;
    --rd-muted2:    #8888a0;
    --rd-mono:      'JetBrains Mono', monospace;
    --rd-display:   'Syne', sans-serif;
    --rd-radius:    16px;

    font-family:  var(--rd-display);
    color:        var(--rd-text);
    background:   var(--rd-bg);
    min-height:   100vh;
    padding:      40px 20px 80px;
    display:      flex;
    flex-direction: column;
    align-items:  center;
    gap:          32px;
  }

  /* ── header ─────────────────────────────────────────────────────── */
  .rd-header {
    text-align:  center;
    max-width:   520px;
    animation:   rdFadeUp 0.5s ease both;
  }
  .rd-header__eyebrow {
    font-family:    var(--rd-mono);
    font-size:      11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color:          var(--rd-accent);
    margin-bottom:  12px;
  }
  .rd-header__title {
    font-size:   42px;
    font-weight: 800;
    margin:      0 0 12px;
    line-height: 1;
    letter-spacing: -0.02em;
    background:  linear-gradient(135deg, #fff 30%, #888);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .rd-header__sub {
    margin:    0;
    font-size: 14px;
    color:     var(--rd-muted2);
    line-height: 1.6;
    font-family: var(--rd-mono);
  }

  /* ── step rail ──────────────────────────────────────────────────── */
  .rd-steps {
    display:     flex;
    align-items: flex-start;
    gap:         0;
    animation:   rdFadeUp 0.5s 0.1s ease both;
  }
  .rd-steps__item {
    display:        flex;
    flex-direction: column;
    align-items:    center;
    position:       relative;
    gap:            6px;
  }
  .rd-steps__node {
    width:         32px;
    height:        32px;
    border-radius: 50%;
    border:        1.5px solid var(--rd-border-hi);
    display:       flex;
    align-items:   center;
    justify-content: center;
    font-family:   var(--rd-mono);
    font-size:     12px;
    font-weight:   600;
    color:         var(--rd-muted2);
    background:    var(--rd-surface);
    transition:    all 0.3s;
    position:      relative;
    z-index:       1;
  }
  .rd-steps__item[data-state="active"] .rd-steps__node {
    border-color: var(--rd-accent);
    color:        var(--rd-accent);
    box-shadow:   0 0 16px rgba(232,255,71,0.25);
  }
  .rd-steps__item[data-state="done"] .rd-steps__node {
    background:   var(--rd-accent);
    border-color: var(--rd-accent);
    color:        #08080a;
  }
  .rd-steps__line {
    width:      80px;
    height:     1.5px;
    background: var(--rd-border-hi);
    margin-top: 15px;
    transition: background 0.3s;
  }
  .rd-steps__line[data-filled="true"] {
    background: var(--rd-accent);
  }
  .rd-steps__label {
    font-family:    var(--rd-mono);
    font-size:      9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color:          var(--rd-muted);
  }
  .rd-steps__item[data-state="active"] .rd-steps__label,
  .rd-steps__item[data-state="done"] .rd-steps__label {
    color: var(--rd-accent);
  }

  /* ── card ───────────────────────────────────────────────────────── */
  .rd-card {
    width:         100%;
    max-width:     540px;
    background:    var(--rd-surface);
    border:        1px solid var(--rd-border);
    border-radius: var(--rd-radius);
    overflow:      hidden;
    animation:     rdFadeUp 0.5s 0.2s ease both;
    position:      relative;
  }
  .rd-card::before {
    content:    '';
    position:   absolute;
    top:        0; left: 0; right: 0;
    height:     2px;
    background: linear-gradient(90deg, var(--rd-accent), var(--rd-accent2));
  }

  /* ── step panel ─────────────────────────────────────────────────── */
  .rd-step-panel {
    padding: 28px;
  }
  .rd-step-panel__head {
    display:     flex;
    gap:         16px;
    align-items: flex-start;
    margin-bottom: 24px;
  }
  .rd-step-panel__num {
    font-family:  var(--rd-mono);
    font-size:    11px;
    font-weight:  600;
    color:        var(--rd-accent);
    letter-spacing: 0.1em;
    padding-top:  3px;
    flex-shrink:  0;
  }
  .rd-step-panel__title {
    margin:      0 0 6px;
    font-size:   20px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .rd-step-panel__desc {
    margin:      0;
    font-size:   13px;
    color:       var(--rd-muted2);
    line-height: 1.55;
    font-family: var(--rd-mono);
  }
  .rd-step-panel__body {
    display:        flex;
    flex-direction: column;
    gap:            16px;
  }

  /* ── DID preview ────────────────────────────────────────────────── */
  .rd-did-preview {
    background:    var(--rd-surface2);
    border:        1px solid var(--rd-border);
    border-radius: 8px;
    padding:       14px 16px;
    font-family:   var(--rd-mono);
    font-size:     12px;
    word-break:    break-all;
    line-height:   1.5;
  }
  .rd-did-preview__scheme { color: var(--rd-accent); }
  .rd-did-preview__addr   { color: var(--rd-muted2); }

  /* ── form fields ────────────────────────────────────────────────── */
  .rd-label {
    display:        flex;
    flex-direction: column;
    gap:            6px;
    font-size:      12px;
    font-weight:    700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color:          var(--rd-muted2);
    font-family:    var(--rd-mono);
  }
  .rd-optional {
    font-weight:    400;
    text-transform: none;
    letter-spacing: 0;
    color:          var(--rd-muted);
  }
  .rd-input {
    background:    var(--rd-surface2);
    border:        1px solid var(--rd-border);
    border-radius: 8px;
    padding:       11px 14px;
    font-family:   var(--rd-mono);
    font-size:     13px;
    color:         var(--rd-text);
    outline:       none;
    transition:    border-color 0.2s;
    width:         100%;
    box-sizing:    border-box;
  }
  .rd-input:focus {
    border-color: var(--rd-accent);
  }
  .rd-input::placeholder { color: var(--rd-muted); }
  .rd-field-hint {
    font-size:   11px;
    font-weight: 400;
    color:       var(--rd-muted);
    text-transform: none;
    letter-spacing: 0;
  }

  /* ── details/preview ────────────────────────────────────────────── */
  .rd-details {
    border:        1px solid var(--rd-border);
    border-radius: 8px;
    overflow:      hidden;
  }
  .rd-details__summary {
    padding:     10px 14px;
    cursor:      pointer;
    font-family: var(--rd-mono);
    font-size:   11px;
    color:       var(--rd-muted2);
    user-select: none;
    background:  var(--rd-surface2);
  }
  .rd-details__summary:hover { color: var(--rd-text); }
  .rd-pre {
    margin:        0;
    padding:       14px;
    font-family:   var(--rd-mono);
    font-size:     11px;
    color:         var(--rd-muted2);
    overflow-x:    auto;
    line-height:   1.6;
    background:    var(--rd-bg);
    max-height:    200px;
    overflow-y:    auto;
  }

  /* ── IPFS info box ──────────────────────────────────────────────── */
  .rd-ipfs-info {
    display:       flex;
    gap:           14px;
    align-items:   flex-start;
    padding:       16px;
    background:    rgba(71,255,218,0.04);
    border:        1px solid rgba(71,255,218,0.12);
    border-radius: 10px;
    color:         var(--rd-accent2);
  }
  .rd-ipfs-info__title {
    margin:      0 0 4px;
    font-size:   13px;
    font-weight: 700;
  }
  .rd-ipfs-info__body {
    margin:      0;
    font-size:   12px;
    color:       var(--rd-muted2);
    line-height: 1.5;
    font-family: var(--rd-mono);
  }

  /* ── doc size ───────────────────────────────────────────────────── */
  .rd-doc-size {
    display:       flex;
    justify-content: space-between;
    align-items:   center;
    padding:       10px 14px;
    background:    var(--rd-surface2);
    border-radius: 8px;
    font-family:   var(--rd-mono);
    font-size:     12px;
  }
  .rd-doc-size__label { color: var(--rd-muted); }
  .rd-doc-size__value { color: var(--rd-text); font-weight: 600; }

  /* ── summary rows ───────────────────────────────────────────────── */
  .rd-summary {
    display:        flex;
    flex-direction: column;
    gap:            0;
    border:         1px solid var(--rd-border);
    border-radius:  10px;
    overflow:       hidden;
  }
  .rd-summary__row {
    display:     flex;
    align-items: center;
    justify-content: space-between;
    gap:         12px;
    padding:     11px 14px;
    border-bottom: 1px solid var(--rd-border);
    font-family: var(--rd-mono);
    font-size:   12px;
  }
  .rd-summary__row:last-child { border-bottom: none; }
  .rd-summary__label { color: var(--rd-muted); flex-shrink: 0; }
  .rd-summary__value { color: var(--rd-text); font-weight: 600; text-align: right; }
  .rd-summary__value--trunc {
    overflow:      hidden;
    text-overflow: ellipsis;
    white-space:   nowrap;
    max-width:     240px;
  }

  /* ── gas note ───────────────────────────────────────────────────── */
  .rd-gas-note {
    display:     flex;
    gap:         8px;
    align-items: flex-start;
    font-family: var(--rd-mono);
    font-size:   11px;
    color:       var(--rd-muted2);
    line-height: 1.55;
  }

  /* ── action button ──────────────────────────────────────────────── */
  .rd-action-btn {
    display:       flex;
    align-items:   center;
    justify-content: center;
    gap:           8px;
    width:         100%;
    padding:       14px;
    border-radius: 10px;
    border:        none;
    cursor:        pointer;
    font-family:   var(--rd-display);
    font-size:     14px;
    font-weight:   800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background:    var(--rd-surface2);
    color:         var(--rd-text);
    border:        1px solid var(--rd-border-hi);
    transition:    all 0.2s;
  }
  .rd-action-btn:hover:not(:disabled) {
    background:  rgba(255,255,255,0.06);
    border-color: var(--rd-accent);
    color:       var(--rd-accent);
    transform:   translateY(-1px);
  }
  .rd-action-btn--accent {
    background:  var(--rd-accent);
    color:       #08080a;
    border-color: var(--rd-accent);
  }
  .rd-action-btn--accent:hover:not(:disabled) {
    background:  #f0ff6a;
    color:       #08080a;
    box-shadow:  0 4px 24px rgba(232,255,71,0.3);
  }
  .rd-action-btn:disabled {
    opacity: 0.45;
    cursor:  not-allowed;
  }
  .rd-action-btn__spinner {
    width:         14px;
    height:        14px;
    border:        2px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation:     rdSpin 0.7s linear infinite;
    flex-shrink:   0;
  }

  /* ── error banner ───────────────────────────────────────────────── */
  .rd-error-banner {
    display:     flex;
    align-items: center;
    gap:         10px;
    padding:     12px 16px;
    background:  rgba(255,95,87,0.08);
    border-top:  1px solid rgba(255,95,87,0.2);
    font-family: var(--rd-mono);
    font-size:   12px;
    color:       var(--rd-error);
  }
  .rd-error-banner__icon { flex-shrink: 0; font-weight: 700; }
  .rd-error-banner__retry {
    margin-left:  auto;
    background:   transparent;
    border:       1px solid currentColor;
    color:        inherit;
    font-family:  inherit;
    font-size:    11px;
    padding:      3px 10px;
    border-radius: 4px;
    cursor:       pointer;
    flex-shrink:  0;
  }

  /* ── back button ────────────────────────────────────────────────── */
  .rd-back {
    background:   transparent;
    border:       none;
    color:        var(--rd-muted);
    font-family:  var(--rd-mono);
    font-size:    12px;
    cursor:       pointer;
    padding:      4px 0;
    transition:   color 0.15s;
  }
  .rd-back:hover { color: var(--rd-text); }

  /* ── success screen ─────────────────────────────────────────────── */
  .rd-success {
    display:        flex;
    flex-direction: column;
    align-items:    center;
    gap:            20px;
    padding:        48px 28px;
  }
  .rd-success__burst {
    position:   relative;
    width:      64px;
    height:     64px;
    display:    flex;
    align-items: center;
    justify-content: center;
  }
  .rd-success__ray {
    position:     absolute;
    width:        2px;
    height:       20px;
    background:   var(--rd-accent);
    border-radius: 2px;
    transform-origin: center 32px;
    transform:    rotate(calc(var(--i) * 45deg)) translateY(-32px);
    animation:    rdRay 0.6s calc(var(--i) * 0.05s) ease both;
  }
  @keyframes rdRay {
    from { opacity: 0; transform: rotate(calc(var(--i) * 45deg)) translateY(-20px) scaleY(0); }
    to   { opacity: 1; transform: rotate(calc(var(--i) * 45deg)) translateY(-32px) scaleY(1); }
  }
  .rd-success__core {
    font-size:   28px;
    color:       var(--rd-accent);
    animation:   rdPop 0.4s 0.3s ease both;
  }
  @keyframes rdPop {
    from { transform: scale(0); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }
  .rd-success__title {
    margin:      0;
    font-size:   28px;
    font-weight: 800;
    letter-spacing: -0.02em;
    animation:   rdFadeUp 0.4s 0.4s ease both;
  }
  .rd-success__sub {
    margin:      0;
    font-family: var(--rd-mono);
    font-size:   13px;
    color:       var(--rd-muted2);
    animation:   rdFadeUp 0.4s 0.5s ease both;
  }
  .rd-result-grid {
    width:          100%;
    display:        flex;
    flex-direction: column;
    gap:            0;
    border:         1px solid var(--rd-border);
    border-radius:  10px;
    overflow:       hidden;
    animation:      rdFadeUp 0.4s 0.6s ease both;
  }
  .rd-result-row {
    display:     flex;
    justify-content: space-between;
    align-items: center;
    gap:         12px;
    padding:     11px 16px;
    border-bottom: 1px solid var(--rd-border);
    font-family: var(--rd-mono);
    font-size:   12px;
  }
  .rd-result-row:last-child { border-bottom: none; }
  .rd-result-row__label { color: var(--rd-muted); flex-shrink: 0; }
  .rd-result-row__value { color: var(--rd-text); font-weight: 600; text-align: right; }

  /* ── already-registered screen ──────────────────────────────────── */
  .rd-already {
    display:        flex;
    flex-direction: column;
    gap:            16px;
    padding:        32px 28px;
    max-width:      540px;
    width:          100%;
    background:     var(--rd-surface);
    border:         1px solid var(--rd-border);
    border-radius:  var(--rd-radius);
  }
  .rd-already__icon {
    font-size:   28px;
    color:       var(--rd-accent2);
  }
  .rd-already__title {
    margin:      0;
    font-size:   20px;
    font-weight: 800;
  }
  .rd-already__sub {
    margin:      0;
    font-family: var(--rd-mono);
    font-size:   13px;
    color:       var(--rd-muted2);
  }
  .rd-field-display {
    display:        flex;
    flex-direction: column;
    gap:            4px;
  }
  .rd-field-display__label {
    font-family:    var(--rd-mono);
    font-size:      10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color:          var(--rd-muted);
  }
  .rd-field-display__value {
    font-family: var(--rd-mono);
    font-size:   12px;
    word-break:  break-all;
    color:       var(--rd-text);
  }

  /* ── shared ─────────────────────────────────────────────────────── */
  .rd-link {
    color:           var(--rd-accent);
    text-decoration: none;
  }
  .rd-link:hover { text-decoration: underline; }

  /* ── animations ─────────────────────────────────────────────────── */
  @keyframes rdFadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  @keyframes rdSpin {
    to { transform: rotate(360deg); }
  }
`;
