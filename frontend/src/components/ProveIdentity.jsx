javascript

import { useState, useCallback, useEffect, useRef } from "react";
import { ethers } from "ethers";

/*
 * ProveIdentity.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/components/ProveIdentity.jsx
 *
 * 5-phase ZKP identity verification flow:
 *   Phase 1 — Select claim type (Age ≥18 or Full Identity)
 *   Phase 2 — Enter private inputs (stays on device, never sent anywhere)
 *   Phase 3 — Generate ZKP proof locally via snarkjs WASM
 *   Phase 4 — Submit proof to ZKPVerifier.sol on-chain
 *   Phase 5 — Mint CredentialNFT soulbound badge
 *
 * Props:
 *   wallet              { provider, signer, address, chainId }
 *   zkpVerifierAddress  deployed ZKPVerifier contract address
 *   credNFTAddress      deployed CredentialNFT contract address
 *   onProven(result)    called on full success
 *                       result = { claimType, nullifierHash, txHash, tokenId }
 *
 * Dependencies:
 *   npm install ethers snarkjs
 *   Place compiled WASM + zkey files in /public/circuits/
 *     /public/circuits/AgeProof.wasm
 *     /public/circuits/AgeProof_final.zkey
 *     /public/circuits/IdentityProof.wasm
 *     /public/circuits/IdentityProof_final.zkey
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Contract ABIs ─────────────────────────────────────────────────────────────
const ZKP_VERIFIER_ABI = [
  "function verifyProof(bytes32 claimType, uint256[2] calldata pi_a, uint256[2][2] calldata pi_b, uint256[2] calldata pi_c, uint256[] calldata publicSignals, bytes32 nullifierHash) external",
  "function hasClaim(address prover, bytes32 claimType) external view returns (bool)",
  "function isNullifierUsed(bytes32 nullifierHash) external view returns (bool)",
];

const CRED_NFT_ABI = [
  "function mintCredential(bytes32 claimType) external",
  "function hasValidCredential(address holder, bytes32 claimType) external view returns (bool)",
  "function getTokenByClaim(address holder, bytes32 claimType) external view returns (uint256)",
];

// ── Claim type definitions ────────────────────────────────────────────────────
const CLAIMS = {
  AGE_OVER_18: {
    id:          "AGE_OVER_18",
    label:       "Age Over 18",
    description: "Prove you are 18 or older without revealing your birth date.",
    claimType:   ethers.id("AGE_OVER_18"),   // keccak256("AGE_OVER_18")
    numericId:   1,
    wasmPath:    "/circuits/AgeProof.wasm",
    zkeyPath:    "/circuits/AgeProof_final.zkey",
    icon:        "◈",
    color:       "#7DF9C0",
    fields: [
      { key: "birthYear",  label: "Birth Year",  type: "number", placeholder: "e.g. 1995", min: 1900, max: 2010 },
      { key: "birthMonth", label: "Birth Month", type: "number", placeholder: "1–12",      min: 1,    max: 12   },
      { key: "birthDay",   label: "Birth Day",   type: "number", placeholder: "1–31",      min: 1,    max: 31   },
      { key: "secret",     label: "Your Secret Salt", type: "password",
        placeholder: "Random string only you know", hint: "Save this — you'll need it to prove again later." },
    ],
  },
  IDENTITY_VERIFIED: {
    id:          "IDENTITY_VERIFIED",
    label:       "Identity Verified",
    description: "Prove you hold a valid government ID without revealing your name or document number.",
    claimType:   ethers.id("IDENTITY_VERIFIED"),
    numericId:   2,
    wasmPath:    "/circuits/IdentityProof.wasm",
    zkeyPath:    "/circuits/IdentityProof_final.zkey",
    icon:        "◉",
    color:       "#FF8C42",
    fields: [
      { key: "idNumber",         label: "ID Number",        type: "password", placeholder: "Your government ID number" },
      { key: "firstName",        label: "First Name",       type: "text",     placeholder: "As on document" },
      { key: "lastName",         label: "Last Name",        type: "text",     placeholder: "As on document" },
      { key: "nationalityCode",  label: "Country Code",     type: "number",   placeholder: "e.g. 91=India, 1=USA", min: 1, max: 999 },
      { key: "documentType",     label: "Document Type",    type: "select",
        options: [{ value: "1", label: "Passport" }, { value: "2", label: "National ID" }, { value: "3", label: "Driver Licence" }] },
      { key: "expiryYear",       label: "Expiry Year",      type: "number",   placeholder: "e.g. 2030", min: 2024, max: 2050 },
      { key: "expiryMonth",      label: "Expiry Month",     type: "number",   placeholder: "1–12",      min: 1,    max: 12   },
      { key: "issuingAuthority", label: "Issuing Authority",type: "text",     placeholder: "Name of issuing body" },
      { key: "secret",           label: "Your Secret Salt", type: "password",
        placeholder: "Random string only you know", hint: "Save this — you'll need it to prove again later." },
    ],
  },
};

// ── Phase labels ──────────────────────────────────────────────────────────────
const PHASES = [
  { id: 1, label: "CLAIM"  },
  { id: 2, label: "INPUTS" },
  { id: 3, label: "PROVE"  },
  { id: 4, label: "VERIFY" },
  { id: 5, label: "MINT"   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCurrentDateSignals() {
  const now = new Date();
  return {
    currentYear:  now.getFullYear().toString(),
    currentMonth: (now.getMonth() + 1).toString(),
    currentDay:   now.getDate().toString(),
  };
}

// Hash text fields to numbers for circom (Poseidon expects field elements)
function textToFieldElement(str) {
  if (!str) return "0";
  let hash = 0n;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31n + BigInt(str.charCodeAt(i))) % (2n ** 253n);
  }
  return hash.toString();
}

// Build snarkjs input object from form values + claim definition
function buildCircuitInputs(claimId, formValues) {
  const date = getCurrentDateSignals();
  const claim = CLAIMS[claimId];

  if (claimId === "AGE_OVER_18") {
    return {
      birthYear:    formValues.birthYear,
      birthMonth:   formValues.birthMonth,
      birthDay:     formValues.birthDay,
      secret:       textToFieldElement(formValues.secret),
      currentYear:  date.currentYear,
      currentMonth: date.currentMonth,
      currentDay:   date.currentDay,
      minAge:       "18",
      claimType:    claim.numericId.toString(),
    };
  }

  if (claimId === "IDENTITY_VERIFIED") {
    return {
      idNumber:         textToFieldElement(formValues.idNumber),
      firstName:        textToFieldElement(formValues.firstName),
      lastName:         textToFieldElement(formValues.lastName),
      nationalityCode:  formValues.nationalityCode,
      documentType:     formValues.documentType,
      expiryYear:       formValues.expiryYear,
      expiryMonth:      formValues.expiryMonth,
      issuingAuthority: textToFieldElement(formValues.issuingAuthority),
      secret:           textToFieldElement(formValues.secret),
      currentYear:      date.currentYear,
      currentMonth:     date.currentMonth,
      allowedDocTypes:  "7",  // accept all three doc types
      claimType:        claim.numericId.toString(),
      issuerCommitment: "0",  // set to real commitment hash in production
    };
  }
}

// Generate proof using snarkjs (runs WASM in browser)
async function generateProof(wasmPath, zkeyPath, inputs) {
  // Dynamic import of snarkjs to keep bundle lean
  const snarkjs = await import("snarkjs");
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    inputs,
    wasmPath,
    zkeyPath
  );
  return { proof, publicSignals };
}

// Format proof for Solidity (snarkjs uses [x,y] arrays, Solidity expects uint256)
function formatProofForSolidity(proof) {
  return {
    pi_a: [proof.pi_a[0], proof.pi_a[1]],
    pi_b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],  // Note: B is transposed for Solidity
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pi_c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function ProveIdentity({
  wallet,
  zkpVerifierAddress,
  credNFTAddress,
  onProven,
}) {
  const [phase,       setPhase]       = useState(1);
  const [selectedId,  setSelectedId]  = useState(null);
  const [formValues,  setFormValues]  = useState({});
  const [status,      setStatus]      = useState("idle"); // idle|loading|success|error
  const [error,       setError]       = useState(null);
  const [proof,       setProof]       = useState(null);
  const [publicSigs,  setPublicSigs]  = useState(null);
  const [nullifier,   setNullifier]   = useState(null);
  const [verifyTx,    setVerifyTx]    = useState(null);
  const [mintTx,      setMintTx]      = useState(null);
  const [tokenId,     setTokenId]     = useState(null);
  const [logLines,    setLogLines]    = useState([]);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const logRef = useRef(null);

  const address = wallet?.address;
  const claim   = selectedId ? CLAIMS[selectedId] : null;

  function addLog(msg, type = "info") {
    setLogLines(prev => [...prev, { msg, type, ts: Date.now() }]);
    setTimeout(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, 50);
  }

  // ── Check if already verified on mount when claim selected ─────────────────
  useEffect(() => {
    if (!address || !selectedId || !zkpVerifierAddress) return;
    (async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const verifier = new ethers.Contract(zkpVerifierAddress, ZKP_VERIFIER_ABI, provider);
        const has = await verifier.hasClaim(address, claim.claimType);
        if (has) setAlreadyDone(true);
      } catch (_) {}
    })();
  }, [address, selectedId, zkpVerifierAddress]);

  // ── Phase 1: Select claim ───────────────────────────────────────────────────
  const handleSelectClaim = useCallback((id) => {
    setSelectedId(id);
    setFormValues({});
    setAlreadyDone(false);
    setError(null);
    setPhase(2);
  }, []);

  // ── Phase 2 → 3: Validate inputs and move to proof generation ──────────────
  const handleInputsSubmit = useCallback(() => {
    const fields = claim.fields;
    for (const f of fields) {
      if (!formValues[f.key] && f.type !== "select") {
        setError(`"${f.label}" is required.`);
        return;
      }
    }
    setError(null);
    setPhase(3);
  }, [claim, formValues]);

  // ── Phase 3: Generate ZKP proof ─────────────────────────────────────────────
  const handleGenerateProof = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setLogLines([]);
    addLog("Building circuit inputs…", "info");

    try {
      const inputs = buildCircuitInputs(selectedId, formValues);
      addLog("Inputs prepared. Loading WASM circuit…", "info");

      addLog(`Loading ${claim.wasmPath}…`, "info");
      addLog(`Loading ${claim.zkeyPath}…`, "info");

      const { proof: p, publicSignals: ps } = await generateProof(
        claim.wasmPath,
        claim.zkeyPath,
        inputs
      );

      addLog("✓ Proof generated successfully.", "success");
      addLog(`Public signals: [${ps.slice(0, 3).join(", ")}…]`, "data");

      // nullifierHash is the last public signal for both circuits
      const nullifierHex = "0x" + BigInt(ps[ps.length - 1]).toString(16).padStart(64, "0");
      setNullifier(nullifierHex);
      setProof(p);
      setPublicSigs(ps);
      setStatus("idle");
      setPhase(4);
    } catch (err) {
      addLog(`✕ ${err.message}`, "error");
      setError(err.message);
      setStatus("error");
    }
  }, [selectedId, formValues, claim]);

  // ── Phase 4: Submit proof to ZKPVerifier on-chain ───────────────────────────
  const handleVerifyOnChain = useCallback(async () => {
    setStatus("loading");
    setError(null);
    addLog("Connecting to ZKPVerifier contract…", "info");

    try {
      const signer   = await wallet.provider.getSigner();
      const verifier = new ethers.Contract(zkpVerifierAddress, ZKP_VERIFIER_ABI, signer);
      const formatted = formatProofForSolidity(proof);

      addLog("Submitting proof transaction…", "info");

      const tx = await verifier.verifyProof(
        claim.claimType,
        formatted.pi_a,
        formatted.pi_b,
        formatted.pi_c,
        publicSigs,
        nullifier
      );

      addLog(`Tx sent: ${tx.hash.slice(0, 18)}…`, "data");
      const receipt = await tx.wait();
      addLog("✓ Proof verified on-chain!", "success");

      setVerifyTx(receipt.hash);
      setStatus("idle");
      setPhase(5);
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED"
        ? "Transaction rejected in wallet."
        : err.message;
      addLog(`✕ ${msg}`, "error");
      setError(msg);
      setStatus("error");
    }
  }, [wallet, zkpVerifierAddress, proof, publicSigs, nullifier, claim]);

  // ── Phase 5: Mint CredentialNFT ──────────────────────────────────────────────
  const handleMintNFT = useCallback(async () => {
    setStatus("loading");
    setError(null);
    addLog("Minting soulbound credential NFT…", "info");

    try {
      const signer  = await wallet.provider.getSigner();
      const nft     = new ethers.Contract(credNFTAddress, CRED_NFT_ABI, signer);

      const tx      = await nft.mintCredential(claim.claimType);
      addLog(`Tx sent: ${tx.hash.slice(0, 18)}…`, "data");
      const receipt = await tx.wait();

      // Get token ID from Transfer event log
      const iface    = new ethers.Interface(["event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"]);
      let tid = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "Transfer") {
            tid = parsed.args.tokenId.toString();
            break;
          }
        } catch (_) {}
      }

      addLog("✓ Soulbound NFT minted!", "success");
      setMintTx(receipt.hash);
      setTokenId(tid);
      setStatus("success");

      onProven?.({
        claimType:    selectedId,
        nullifierHash: nullifier,
        verifyTxHash:  verifyTx,
        mintTxHash:    receipt.hash,
        tokenId:       tid,
      });
    } catch (err) {
      const msg = err.code === "ACTION_REJECTED"
        ? "Transaction rejected in wallet."
        : err.message;
      addLog(`✕ ${msg}`, "error");
      setError(msg);
      setStatus("error");
    }
  }, [wallet, credNFTAddress, claim, nullifier, verifyTx, selectedId, onProven]);

  // ── FINAL SUCCESS ──────────────────────────────────────────────────────────
  if (status === "success" && phase === 5) {
    return (
      <div className="pi-root">
        <SuccessScreen
          claim={claim}
          tokenId={tokenId}
          verifyTx={verifyTx}
          mintTx={mintTx}
        />
        <style>{CSS}</style>
      </div>
    );
  }

  // ── ALREADY VERIFIED ────────────────────────────────────────────────────────
  if (alreadyDone && phase >= 2) {
    return (
      <div className="pi-root">
        <div className="pi-already">
          <span className="pi-already__icon" style={{ color: claim.color }}>{claim.icon}</span>
          <h2 className="pi-already__title">Already Verified</h2>
          <p className="pi-already__sub">
            This wallet already has a verified <strong>{claim.label}</strong> claim on-chain.
          </p>
          <button className="pi-btn pi-btn--outline" onClick={() => { setPhase(1); setSelectedId(null); setAlreadyDone(false); }}>
            Check Another Claim
          </button>
        </div>
        <style>{CSS}</style>
      </div>
    );
  }

  // ── MAIN UI ────────────────────────────────────────────────────────────────
  return (
    <div className="pi-root">

      {/* Ambient glow based on selected claim */}
      {claim && (
        <div className="pi-glow" style={{ "--glow-color": claim.color }} />
      )}

      {/* Header */}
      <div className="pi-header">
        <div className="pi-header__label">ZK PROOF</div>
        <h1 className="pi-header__title">Prove Identity</h1>
        <p className="pi-header__sub">
          Your private data never leaves this device.<br />
          Only a cryptographic proof is sent on-chain.
        </p>
      </div>

      {/* Phase rail */}
      <div className="pi-rail">
        {PHASES.map((p, i) => {
          const state = p.id < phase ? "done" : p.id === phase ? "active" : "idle";
          return (
            <div key={p.id} className="pi-rail__item" data-state={state}>
              <div className="pi-rail__node">
                {state === "done" ? "✓" : p.id}
              </div>
              {i < PHASES.length - 1 && (
                <div className="pi-rail__track" data-filled={state === "done" ? "1" : "0"} />
              )}
              <span className="pi-rail__label">{p.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── PHASE 1: Select Claim ── */}
      {phase === 1 && (
        <div className="pi-phase pi-phase--grid">
          <div className="pi-phase__head">
            <span className="pi-phase__num">01</span>
            <div>
              <h2 className="pi-phase__title">Select Claim Type</h2>
              <p className="pi-phase__desc">What do you want to prove without revealing?</p>
            </div>
          </div>
          <div className="pi-claim-grid">
            {Object.values(CLAIMS).map(c => (
              <button
                key={c.id}
                className="pi-claim-card"
                style={{ "--claim-color": c.color }}
                onClick={() => handleSelectClaim(c.id)}
              >
                <span className="pi-claim-card__icon">{c.icon}</span>
                <span className="pi-claim-card__label">{c.label}</span>
                <span className="pi-claim-card__desc">{c.description}</span>
                <span className="pi-claim-card__arrow">→</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── PHASE 2: Private Inputs ── */}
      {phase === 2 && claim && (
        <div className="pi-phase">
          <div className="pi-phase__head">
            <span className="pi-phase__num">02</span>
            <div>
              <h2 className="pi-phase__title">Private Inputs</h2>
              <p className="pi-phase__desc">
                These values are used locally to generate the proof.
                They are <strong>never sent</strong> to any server or blockchain.
              </p>
            </div>
          </div>

          <div className="pi-privacy-badge">
            <LockIcon />
            <span>End-to-end private — processed only in your browser via WebAssembly</span>
          </div>

          <div className="pi-fields">
            {claim.fields.map(f => (
              <div key={f.key} className="pi-field">
                <label className="pi-field__label">
                  {f.label}
                  {f.hint && <span className="pi-field__hint">{f.hint}</span>}
                </label>
                {f.type === "select" ? (
                  <select
                    className="pi-input pi-select"
                    value={formValues[f.key] || "1"}
                    onChange={e => setFormValues(v => ({ ...v, [f.key]: e.target.value }))}
                  >
                    {f.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="pi-input"
                    type={f.type}
                    placeholder={f.placeholder}
                    min={f.min}
                    max={f.max}
                    value={formValues[f.key] || ""}
                    onChange={e => setFormValues(v => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>

          {error && <ErrorBanner msg={error} onDismiss={() => setError(null)} />}

          <div className="pi-actions">
            <button className="pi-btn pi-btn--outline" onClick={() => setPhase(1)}>← Back</button>
            <button className="pi-btn pi-btn--primary" style={{ "--btn-accent": claim.color }}
              onClick={handleInputsSubmit}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── PHASE 3: Generate Proof ── */}
      {phase === 3 && claim && (
        <div className="pi-phase">
          <div className="pi-phase__head">
            <span className="pi-phase__num">03</span>
            <div>
              <h2 className="pi-phase__title">Generate ZK Proof</h2>
              <p className="pi-phase__desc">
                Your browser runs the {claim.label} circuit in WebAssembly.
                This may take 5–30 seconds depending on your device.
              </p>
            </div>
          </div>

          <div className="pi-circuit-info">
            <CircuitIcon color={claim.color} />
            <div>
              <p className="pi-circuit-info__title">{claim.label} Circuit</p>
              <p className="pi-circuit-info__body">
                Groth16 zk-SNARK • BN128 curve • circom 2.1.6
              </p>
            </div>
          </div>

          {/* Log terminal */}
          {logLines.length > 0 && (
            <div className="pi-terminal" ref={logRef}>
              {logLines.map((l, i) => (
                <div key={i} className={`pi-terminal__line pi-terminal__line--${l.type}`}>
                  <span className="pi-terminal__ts">
                    {new Date(l.ts).toISOString().slice(11, 19)}
                  </span>
                  {l.msg}
                </div>
              ))}
              {status === "loading" && (
                <div className="pi-terminal__line pi-terminal__line--info">
                  <span className="pi-terminal__cursor">▋</span>
                </div>
              )}
            </div>
          )}

          {error && <ErrorBanner msg={error} onDismiss={() => setStatus("idle")} />}

          <div className="pi-actions">
            <button className="pi-btn pi-btn--outline" onClick={() => setPhase(2)}
              disabled={status === "loading"}>← Back</button>
            <button className="pi-btn pi-btn--primary" style={{ "--btn-accent": claim.color }}
              onClick={handleGenerateProof} disabled={status === "loading"}>
              {status === "loading"
                ? <><SpinnerDots />Generating…</>
                : "Generate Proof"}
            </button>
          </div>
        </div>
      )}

      {/* ── PHASE 4: Verify On-Chain ── */}
      {phase === 4 && claim && proof && (
        <div className="pi-phase">
          <div className="pi-phase__head">
            <span className="pi-phase__num">04</span>
            <div>
              <h2 className="pi-phase__title">Verify On-Chain</h2>
              <p className="pi-phase__desc">
                Submit the proof to ZKPVerifier.sol. The contract checks the
                math on-chain — your private data is not involved.
              </p>
            </div>
          </div>

          <div className="pi-proof-summary">
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">Claim</span>
              <span className="pi-proof-summary__val">{claim.label}</span>
            </div>
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">π_a</span>
              <span className="pi-proof-summary__val pi-proof-summary__val--mono">
                {proof.pi_a[0].slice(0, 14)}…
              </span>
            </div>
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">π_b</span>
              <span className="pi-proof-summary__val pi-proof-summary__val--mono">
                {proof.pi_b[0][0].slice(0, 14)}…
              </span>
            </div>
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">π_c</span>
              <span className="pi-proof-summary__val pi-proof-summary__val--mono">
                {proof.pi_c[0].slice(0, 14)}…
              </span>
            </div>
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">Nullifier</span>
              <span className="pi-proof-summary__val pi-proof-summary__val--mono">
                {nullifier?.slice(0, 18)}…
              </span>
            </div>
            <div className="pi-proof-summary__row">
              <span className="pi-proof-summary__key">Public Signals</span>
              <span className="pi-proof-summary__val">{publicSigs?.length} values</span>
            </div>
          </div>

          {/* Log terminal */}
          {logLines.length > 0 && (
            <div className="pi-terminal" ref={logRef}>
              {logLines.map((l, i) => (
                <div key={i} className={`pi-terminal__line pi-terminal__line--${l.type}`}>
                  <span className="pi-terminal__ts">
                    {new Date(l.ts).toISOString().slice(11, 19)}
                  </span>
                  {l.msg}
                </div>
              ))}
              {status === "loading" && (
                <div className="pi-terminal__line pi-terminal__line--info">
                  <span className="pi-terminal__cursor">▋</span>
                </div>
              )}
            </div>
          )}

          {error && <ErrorBanner msg={error} onDismiss={() => setStatus("idle")} />}

          <div className="pi-actions">
            <button className="pi-btn pi-btn--primary" style={{ "--btn-accent": claim.color }}
              onClick={handleVerifyOnChain} disabled={status === "loading"}>
              {status === "loading"
                ? <><SpinnerDots />Waiting for tx…</>
                : "Submit Proof →"}
            </button>
          </div>
        </div>
      )}

      {/* ── PHASE 5: Mint NFT ── */}
      {phase === 5 && claim && (
        <div className="pi-phase">
          <div className="pi-phase__head">
            <span className="pi-phase__num">05</span>
            <div>
              <h2 className="pi-phase__title">Mint Credential Badge</h2>
              <p className="pi-phase__desc">
                Proof verified ✓ — now mint your soulbound NFT badge.
                This token is permanently locked to your wallet.
              </p>
            </div>
          </div>

          <div className="pi-nft-preview" style={{ "--nft-color": claim.color }}>
            <div className="pi-nft-preview__glow" />
            <span className="pi-nft-preview__icon">{claim.icon}</span>
            <div className="pi-nft-preview__info">
              <span className="pi-nft-preview__name">DID Credential</span>
              <span className="pi-nft-preview__claim">{claim.label}</span>
              <span className="pi-nft-preview__tag">SOULBOUND · NON-TRANSFERABLE</span>
            </div>
          </div>

          <div className="pi-verify-confirm">
            <span className="pi-verify-confirm__dot" />
            <span>Proof verified on Sepolia —{" "}
              <a href={`https://sepolia.etherscan.io/tx/${verifyTx}`}
                target="_blank" rel="noreferrer" className="pi-link">
                view tx
              </a>
            </span>
          </div>

          {/* Log terminal */}
          {logLines.length > 0 && (
            <div className="pi-terminal" ref={logRef}>
              {logLines.map((l, i) => (
                <div key={i} className={`pi-terminal__line pi-terminal__line--${l.type}`}>
                  <span className="pi-terminal__ts">
                    {new Date(l.ts).toISOString().slice(11, 19)}
                  </span>
                  {l.msg}
                </div>
              ))}
              {status === "loading" && (
                <div className="pi-terminal__line pi-terminal__line--info">
                  <span className="pi-terminal__cursor">▋</span>
                </div>
              )}
            </div>
          )}

          {error && <ErrorBanner msg={error} onDismiss={() => setStatus("idle")} />}

          <div className="pi-actions">
            <button className="pi-btn pi-btn--primary" style={{ "--btn-accent": claim.color }}
              onClick={handleMintNFT} disabled={status === "loading"}>
              {status === "loading"
                ? <><SpinnerDots />Minting…</>
                : `Mint ${claim.label} Badge`}
            </button>
          </div>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

// ── SUB-COMPONENTS ────────────────────────────────────────────────────────────

function SuccessScreen({ claim, tokenId, verifyTx, mintTx }) {
  return (
    <div className="pi-success">
      <div className="pi-success__rings">
        <span /><span /><span />
      </div>
      <span className="pi-success__icon" style={{ color: claim.color }}>{claim.icon}</span>
      <h2 className="pi-success__title">Identity Proven</h2>
      <p className="pi-success__sub">
        Your <strong>{claim.label}</strong> credential is live on Sepolia.
      </p>
      <div className="pi-success__grid">
        {[
          { label: "Claim",      value: claim.label },
          { label: "Token ID",   value: tokenId ? `#${tokenId}` : "—" },
          { label: "Verify Tx",  value: verifyTx?.slice(0, 18) + "…", href: `https://sepolia.etherscan.io/tx/${verifyTx}` },
          { label: "Mint Tx",    value: mintTx?.slice(0, 18) + "…",   href: `https://sepolia.etherscan.io/tx/${mintTx}` },
        ].map(r => (
          <div key={r.label} className="pi-success__row">
            <span className="pi-success__key">{r.label}</span>
            {r.href
              ? <a href={r.href} target="_blank" rel="noreferrer" className="pi-link pi-success__val">{r.value}</a>
              : <span className="pi-success__val">{r.value}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }) {
  return (
    <div className="pi-error">
      <span className="pi-error__icon">✕</span>
      <span className="pi-error__msg">{msg}</span>
      <button className="pi-error__close" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function SpinnerDots() {
  return (
    <span className="pi-spin-dots">
      <span /><span /><span />
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <rect x="3" y="11" width="18" height="11" rx="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  );
}

function CircuitIcon({ color }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" fill="none"
      stroke={color} strokeWidth="1.5" strokeLinecap="round"
      style={{ flexShrink: 0 }}>
      <rect x="12" y="12" width="12" height="12" rx="2"/>
      <line x1="18" y1="2"  x2="18" y2="12"/>
      <line x1="18" y1="24" x2="18" y2="34"/>
      <line x1="2"  y1="18" x2="12" y2="18"/>
      <line x1="24" y1="18" x2="34" y2="18"/>
      <circle cx="18" cy="2"  r="2" fill={color}/>
      <circle cx="18" cy="34" r="2" fill={color}/>
      <circle cx="2"  cy="18" r="2" fill={color}/>
      <circle cx="34" cy="18" r="2" fill={color}/>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=Share+Tech+Mono&display=swap');

  /* ── tokens ──────────────────────────────────────────────────────── */
  .pi-root {
    --pi-bg:       #060608;
    --pi-surface:  #0e0e12;
    --pi-surface2: #14141a;
    --pi-border:   rgba(255,255,255,0.06);
    --pi-border-hi:rgba(255,255,255,0.14);
    --pi-text:     #e8e8f0;
    --pi-muted:    #48485a;
    --pi-muted2:   #7878a0;
    --pi-green:    #7DF9C0;
    --pi-orange:   #FF8C42;
    --pi-error:    #FF4D6D;
    --pi-mono:     'Share Tech Mono', monospace;
    --pi-display:  'Rajdhani', sans-serif;
    --pi-radius:   14px;

    font-family:    var(--pi-display);
    color:          var(--pi-text);
    background:     var(--pi-bg);
    min-height:     100vh;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    padding:        40px 16px 80px;
    gap:            28px;
    position:       relative;
    overflow-x:     hidden;
  }

  /* ── ambient glow ────────────────────────────────────────────────── */
  .pi-glow {
    position:      fixed;
    top:           -200px;
    left:          50%;
    transform:     translateX(-50%);
    width:         600px;
    height:        400px;
    background:    radial-gradient(ellipse, color-mix(in srgb, var(--glow-color) 12%, transparent), transparent 70%);
    pointer-events: none;
    transition:    background 0.8s;
  }

  /* ── header ──────────────────────────────────────────────────────── */
  .pi-header {
    text-align:  center;
    max-width:   500px;
    animation:   piFadeUp 0.5s ease both;
  }
  .pi-header__label {
    font-family:    var(--pi-mono);
    font-size:      10px;
    letter-spacing: 0.3em;
    color:          var(--pi-muted2);
    margin-bottom:  12px;
  }
  .pi-header__title {
    font-size:   48px;
    font-weight: 700;
    margin:      0 0 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background:  linear-gradient(135deg, #fff 40%, #444);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .pi-header__sub {
    margin:      0;
    font-family: var(--pi-mono);
    font-size:   12px;
    color:       var(--pi-muted2);
    line-height: 1.7;
  }

  /* ── phase rail ──────────────────────────────────────────────────── */
  .pi-rail {
    display:     flex;
    align-items: flex-start;
    animation:   piFadeUp 0.5s 0.1s ease both;
  }
  .pi-rail__item {
    display:        flex;
    flex-direction: column;
    align-items:    center;
    gap:            5px;
  }
  .pi-rail__node {
    width:         28px;
    height:        28px;
    border-radius: 50%;
    border:        1.5px solid var(--pi-border-hi);
    display:       flex;
    align-items:   center;
    justify-content: center;
    font-family:   var(--pi-mono);
    font-size:     11px;
    color:         var(--pi-muted);
    background:    var(--pi-surface);
    transition:    all 0.3s;
    position:      relative;
    z-index:       1;
  }
  .pi-rail__item[data-state="active"] .pi-rail__node {
    border-color: var(--glow-color, var(--pi-green));
    color:        var(--glow-color, var(--pi-green));
    box-shadow:   0 0 12px color-mix(in srgb, var(--glow-color, var(--pi-green)) 30%, transparent);
  }
  .pi-rail__item[data-state="done"] .pi-rail__node {
    background:   var(--glow-color, var(--pi-green));
    border-color: var(--glow-color, var(--pi-green));
    color:        #060608;
    font-weight:  700;
  }
  .pi-rail__track {
    width:      60px;
    height:     1px;
    background: var(--pi-border-hi);
    margin-top: 13px;
    transition: background 0.3s;
  }
  .pi-rail__track[data-filled="1"] {
    background: var(--glow-color, var(--pi-green));
  }
  .pi-rail__label {
    font-family:    var(--pi-mono);
    font-size:      8px;
    letter-spacing: 0.12em;
    color:          var(--pi-muted);
    text-transform: uppercase;
  }
  .pi-rail__item[data-state="active"] .pi-rail__label,
  .pi-rail__item[data-state="done"]   .pi-rail__label {
    color: var(--glow-color, var(--pi-green));
  }

  /* ── phase panel ─────────────────────────────────────────────────── */
  .pi-phase {
    width:          100%;
    max-width:      540px;
    background:     var(--pi-surface);
    border:         1px solid var(--pi-border);
    border-radius:  var(--pi-radius);
    padding:        28px;
    display:        flex;
    flex-direction: column;
    gap:            20px;
    animation:      piFadeUp 0.4s ease both;
    position:       relative;
    overflow:       hidden;
  }
  .pi-phase::before {
    content:    '';
    position:   absolute;
    top: 0; left: 0; right: 0;
    height:     1px;
    background: linear-gradient(90deg, transparent, var(--glow-color, var(--pi-green)), transparent);
    opacity:    0.4;
  }
  .pi-phase--grid { max-width: 600px; }
  .pi-phase__head {
    display:     flex;
    gap:         14px;
    align-items: flex-start;
  }
  .pi-phase__num {
    font-family:    var(--pi-mono);
    font-size:      10px;
    color:          var(--glow-color, var(--pi-green));
    padding-top:    3px;
    flex-shrink:    0;
    letter-spacing: 0.1em;
  }
  .pi-phase__title {
    margin:      0 0 6px;
    font-size:   22px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pi-phase__desc {
    margin:      0;
    font-family: var(--pi-mono);
    font-size:   12px;
    color:       var(--pi-muted2);
    line-height: 1.6;
  }
  .pi-phase__desc strong { color: var(--pi-text); }

  /* ── claim cards ─────────────────────────────────────────────────── */
  .pi-claim-grid {
    display:               grid;
    grid-template-columns: 1fr 1fr;
    gap:                   14px;
  }
  .pi-claim-card {
    background:     var(--pi-surface2);
    border:         1px solid var(--pi-border);
    border-radius:  12px;
    padding:        20px;
    cursor:         pointer;
    display:        flex;
    flex-direction: column;
    gap:            8px;
    text-align:     left;
    transition:     all 0.2s;
    position:       relative;
    overflow:       hidden;
  }
  .pi-claim-card::after {
    content:    '';
    position:   absolute;
    inset:      0;
    background: radial-gradient(ellipse 120% 80% at 50% 0%, color-mix(in srgb, var(--claim-color) 10%, transparent), transparent);
    opacity:    0;
    transition: opacity 0.3s;
  }
  .pi-claim-card:hover {
    border-color: var(--claim-color);
    transform:    translateY(-2px);
  }
  .pi-claim-card:hover::after { opacity: 1; }
  .pi-claim-card__icon {
    font-size:   28px;
    color:       var(--claim-color);
    line-height: 1;
  }
  .pi-claim-card__label {
    font-size:      16px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color:          var(--pi-text);
  }
  .pi-claim-card__desc {
    font-family: var(--pi-mono);
    font-size:   11px;
    color:       var(--pi-muted2);
    line-height: 1.5;
    flex:        1;
  }
  .pi-claim-card__arrow {
    font-size: 16px;
    color:     var(--claim-color);
    opacity:   0;
    transition: opacity 0.2s, transform 0.2s;
  }
  .pi-claim-card:hover .pi-claim-card__arrow {
    opacity:   1;
    transform: translateX(4px);
  }

  /* ── privacy badge ───────────────────────────────────────────────── */
  .pi-privacy-badge {
    display:       flex;
    align-items:   center;
    gap:           8px;
    padding:       10px 14px;
    background:    rgba(125,249,192,0.05);
    border:        1px solid rgba(125,249,192,0.15);
    border-radius: 8px;
    font-family:   var(--pi-mono);
    font-size:     11px;
    color:         #7DF9C0;
  }

  /* ── fields ──────────────────────────────────────────────────────── */
  .pi-fields {
    display:        flex;
    flex-direction: column;
    gap:            14px;
  }
  .pi-field {
    display:        flex;
    flex-direction: column;
    gap:            5px;
  }
  .pi-field__label {
    font-family:    var(--pi-mono);
    font-size:      10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color:          var(--pi-muted2);
    display:        flex;
    flex-direction: column;
    gap:            2px;
  }
  .pi-field__hint {
    font-size:      10px;
    color:          var(--pi-muted);
    text-transform: none;
    letter-spacing: 0;
  }
  .pi-input {
    background:    var(--pi-surface2);
    border:        1px solid var(--pi-border);
    border-radius: 8px;
    padding:       10px 14px;
    font-family:   var(--pi-mono);
    font-size:     13px;
    color:         var(--pi-text);
    outline:       none;
    width:         100%;
    box-sizing:    border-box;
    transition:    border-color 0.2s;
  }
  .pi-input:focus {
    border-color: var(--glow-color, var(--pi-green));
  }
  .pi-input::placeholder { color: var(--pi-muted); }
  .pi-select { cursor: pointer; }
  .pi-select option { background: var(--pi-surface2); }

  /* ── circuit info ────────────────────────────────────────────────── */
  .pi-circuit-info {
    display:       flex;
    gap:           16px;
    align-items:   center;
    padding:       16px;
    background:    var(--pi-surface2);
    border:        1px solid var(--pi-border);
    border-radius: 10px;
  }
  .pi-circuit-info__title {
    margin:         0 0 4px;
    font-size:      15px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .pi-circuit-info__body {
    margin:      0;
    font-family: var(--pi-mono);
    font-size:   11px;
    color:       var(--pi-muted2);
  }

  /* ── terminal log ────────────────────────────────────────────────── */
  .pi-terminal {
    background:    #02020a;
    border:        1px solid rgba(125,249,192,0.1);
    border-radius: 8px;
    padding:       14px;
    font-family:   var(--pi-mono);
    font-size:     11px;
    max-height:    160px;
    overflow-y:    auto;
    display:       flex;
    flex-direction: column;
    gap:           4px;
  }
  .pi-terminal::-webkit-scrollbar { width: 4px; }
  .pi-terminal::-webkit-scrollbar-track { background: transparent; }
  .pi-terminal::-webkit-scrollbar-thumb { background: var(--pi-muted); border-radius: 2px; }
  .pi-terminal__line {
    display:     flex;
    gap:         10px;
    line-height: 1.4;
  }
  .pi-terminal__ts {
    color:       var(--pi-muted);
    flex-shrink: 0;
  }
  .pi-terminal__line--info    { color: var(--pi-muted2); }
  .pi-terminal__line--success { color: var(--pi-green);  }
  .pi-terminal__line--error   { color: var(--pi-error);  }
  .pi-terminal__line--data    { color: #aaaacc;           }
  .pi-terminal__cursor {
    animation: piCursorBlink 0.8s step-end infinite;
    color:     var(--pi-green);
  }
  @keyframes piCursorBlink {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0; }
  }

  /* ── proof summary ───────────────────────────────────────────────── */
  .pi-proof-summary {
    border:         1px solid var(--pi-border);
    border-radius:  10px;
    overflow:       hidden;
  }
  .pi-proof-summary__row {
    display:     flex;
    justify-content: space-between;
    align-items: center;
    padding:     10px 14px;
    border-bottom: 1px solid var(--pi-border);
    font-family: var(--pi-mono);
    font-size:   11px;
  }
  .pi-proof-summary__row:last-child { border-bottom: none; }
  .pi-proof-summary__key { color: var(--pi-muted2); flex-shrink: 0; }
  .pi-proof-summary__val { color: var(--pi-text); font-weight: 600; }
  .pi-proof-summary__val--mono { color: var(--pi-muted2); }

  /* ── NFT preview ─────────────────────────────────────────────────── */
  .pi-nft-preview {
    display:       flex;
    align-items:   center;
    gap:           18px;
    padding:       20px;
    background:    var(--pi-surface2);
    border:        1px solid var(--pi-border);
    border-radius: 12px;
    position:      relative;
    overflow:      hidden;
  }
  .pi-nft-preview__glow {
    position:   absolute;
    inset:      0;
    background: radial-gradient(ellipse 100% 100% at 0% 50%, color-mix(in srgb, var(--nft-color) 12%, transparent), transparent);
    pointer-events: none;
  }
  .pi-nft-preview__icon {
    font-size:   40px;
    color:       var(--nft-color);
    position:    relative;
    z-index:     1;
  }
  .pi-nft-preview__info {
    display:        flex;
    flex-direction: column;
    gap:            3px;
    position:       relative;
    z-index:        1;
  }
  .pi-nft-preview__name {
    font-size:      11px;
    font-family:    var(--pi-mono);
    color:          var(--pi-muted2);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .pi-nft-preview__claim {
    font-size:      18px;
    font-weight:    700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color:          var(--nft-color);
  }
  .pi-nft-preview__tag {
    font-family:    var(--pi-mono);
    font-size:      9px;
    color:          var(--pi-muted);
    letter-spacing: 0.12em;
  }

  /* ── verify confirm pill ─────────────────────────────────────────── */
  .pi-verify-confirm {
    display:       flex;
    align-items:   center;
    gap:           8px;
    font-family:   var(--pi-mono);
    font-size:     12px;
    color:         var(--pi-muted2);
  }
  .pi-verify-confirm__dot {
    width:         8px;
    height:        8px;
    border-radius: 50%;
    background:    var(--pi-green);
    flex-shrink:   0;
    box-shadow:    0 0 8px rgba(125,249,192,0.5);
  }

  /* ── actions row ─────────────────────────────────────────────────── */
  .pi-actions {
    display:     flex;
    gap:         10px;
    margin-top:  4px;
  }

  /* ── buttons ─────────────────────────────────────────────────────── */
  .pi-btn {
    display:         flex;
    align-items:     center;
    justify-content: center;
    gap:             8px;
    padding:         12px 24px;
    border-radius:   8px;
    border:          none;
    cursor:          pointer;
    font-family:     var(--pi-display);
    font-size:       14px;
    font-weight:     700;
    letter-spacing:  0.1em;
    text-transform:  uppercase;
    transition:      all 0.2s;
    flex:            1;
  }
  .pi-btn--primary {
    background: var(--btn-accent, var(--pi-green));
    color:      #060608;
  }
  .pi-btn--primary:hover:not(:disabled) {
    filter:    brightness(1.15);
    transform: translateY(-1px);
    box-shadow: 0 4px 20px color-mix(in srgb, var(--btn-accent, var(--pi-green)) 35%, transparent);
  }
  .pi-btn--primary:disabled {
    opacity: 0.45;
    cursor:  not-allowed;
  }
  .pi-btn--outline {
    background:  transparent;
    color:       var(--pi-muted2);
    border:      1px solid var(--pi-border-hi);
    flex:        0 0 auto;
  }
  .pi-btn--outline:hover { color: var(--pi-text); border-color: rgba(255,255,255,0.3); }

  /* ── spinner dots ────────────────────────────────────────────────── */
  .pi-spin-dots {
    display:     inline-flex;
    gap:         4px;
    align-items: center;
  }
  .pi-spin-dots span {
    width:         5px;
    height:        5px;
    border-radius: 50%;
    background:    currentColor;
    animation:     piDots 1s ease-in-out infinite;
  }
  .pi-spin-dots span:nth-child(2) { animation-delay: 0.15s; }
  .pi-spin-dots span:nth-child(3) { animation-delay: 0.30s; }
  @keyframes piDots {
    0%, 80%, 100% { transform: scale(0.5); opacity: 0.3; }
    40%           { transform: scale(1);   opacity: 1;   }
  }

  /* ── error banner ────────────────────────────────────────────────── */
  .pi-error {
    display:       flex;
    align-items:   center;
    gap:           10px;
    padding:       12px 14px;
    background:    rgba(255,77,109,0.08);
    border:        1px solid rgba(255,77,109,0.2);
    border-radius: 8px;
    font-family:   var(--pi-mono);
    font-size:     12px;
    color:         var(--pi-error);
  }
  .pi-error__icon  { flex-shrink: 0; font-weight: 700; }
  .pi-error__msg   { flex: 1; line-height: 1.4; }
  .pi-error__close {
    background:   transparent;
    border:       1px solid currentColor;
    color:        inherit;
    font-family:  inherit;
    font-size:    10px;
    padding:      3px 8px;
    border-radius: 4px;
    cursor:       pointer;
    flex-shrink:  0;
  }

  /* ── already verified ────────────────────────────────────────────── */
  .pi-already {
    max-width:      540px;
    width:          100%;
    background:     var(--pi-surface);
    border:         1px solid var(--pi-border);
    border-radius:  var(--pi-radius);
    padding:        36px 28px;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    gap:            14px;
    text-align:     center;
    animation:      piFadeUp 0.4s ease both;
  }
  .pi-already__icon  { font-size: 40px; }
  .pi-already__title { margin: 0; font-size: 24px; font-weight: 700; text-transform: uppercase; }
  .pi-already__sub   { margin: 0; font-family: var(--pi-mono); font-size: 13px; color: var(--pi-muted2); line-height: 1.5; }

  /* ── success screen ──────────────────────────────────────────────── */
  .pi-success {
    max-width:      540px;
    width:          100%;
    background:     var(--pi-surface);
    border:         1px solid var(--pi-border);
    border-radius:  var(--pi-radius);
    padding:        44px 28px;
    display:        flex;
    flex-direction: column;
    align-items:    center;
    gap:            16px;
    animation:      piFadeUp 0.5s ease both;
    position:       relative;
    overflow:       hidden;
  }
  .pi-success__rings {
    position:   absolute;
    top:        -60px;
    left:       50%;
    transform:  translateX(-50%);
    width:      200px;
    height:     200px;
  }
  .pi-success__rings span {
    position:      absolute;
    inset:         0;
    border-radius: 50%;
    border:        1px solid var(--pi-green);
    animation:     piRing 2s ease-out infinite;
  }
  .pi-success__rings span:nth-child(2) { animation-delay: 0.5s; }
  .pi-success__rings span:nth-child(3) { animation-delay: 1s;   }
  @keyframes piRing {
    from { transform: scale(0.3); opacity: 0.6; }
    to   { transform: scale(1.6); opacity: 0;   }
  }
  .pi-success__icon  { font-size: 52px; position: relative; animation: piFadeUp 0.4s 0.2s ease both; }
  .pi-success__title { margin: 0; font-size: 32px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; animation: piFadeUp 0.4s 0.3s ease both; }
  .pi-success__sub   { margin: 0; font-family: var(--pi-mono); font-size: 13px; color: var(--pi-muted2); animation: piFadeUp 0.4s 0.4s ease both; }
  .pi-success__grid {
    width:          100%;
    border:         1px solid var(--pi-border);
    border-radius:  10px;
    overflow:       hidden;
    animation:      piFadeUp 0.4s 0.5s ease both;
  }
  .pi-success__row {
    display:     flex;
    justify-content: space-between;
    align-items: center;
    padding:     10px 16px;
    border-bottom: 1px solid var(--pi-border);
    font-family: var(--pi-mono);
    font-size:   12px;
  }
  .pi-success__row:last-child { border-bottom: none; }
  .pi-success__key { color: var(--pi-muted2); }
  .pi-success__val { color: var(--pi-text); font-weight: 600; }

  /* ── shared ──────────────────────────────────────────────────────── */
  .pi-link { color: var(--pi-green); text-decoration: none; }
  .pi-link:hover { text-decoration: underline; }

  /* ── animations ──────────────────────────────────────────────────── */
  @keyframes piFadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
`;
