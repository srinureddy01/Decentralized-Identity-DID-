// this file on the utlis/zkp.js
// in this code discribe the actuall procedure and it has the several modules as well 
/**
 * zkp.js
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/utils/zkp.js
 *
 * Browser-side Zero-Knowledge Proof generation utility.
 * Runs the compiled circom WASM circuits directly in the browser
 * via snarkjs — private data NEVER leaves the user's device.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────
 *  • Loads compiled WASM circuits from /public/circuits/
 *  • Builds circuit input objects from raw user form data
 *  • Generates Groth16 zk-SNARK proofs using snarkjs
 *  • Formats proof points for Solidity (pi_b transposition)
 *  • Extracts nullifier hash from public signals
 *  • Validates proof locally before sending to chain
 *  • Provides a React hook (useZKP) for component integration
 *
 * ── CIRCUIT FILES REQUIRED ───────────────────────────────────────────────
 *  After running `npm run proof:all` from the project root,
 *  copy these files into did-protocol/frontend/public/circuits/:
 *
 *    AgeProof.wasm               compiled circuit (from circuits/build/)
 *    AgeProof_final.zkey         proving key     (from circuits/build/)
 *    IdentityProof.wasm          compiled circuit (from circuits/build/)
 *    IdentityProof_final.zkey    proving key     (from circuits/build/)
 *
 * ── EXPORTS ──────────────────────────────────────────────────────────────
 *
 *  generateAgeProof(inputs)          → Promise<ZKPResult>
 *  generateIdentityProof(inputs)     → Promise<ZKPResult>
 *  verifyProofLocally(proof, signals, vkeyPath) → Promise<boolean>
 *  formatProofForSolidity(proof)     → SolidityProof
 *  buildAgeInputs(formData)          → AgeCircuitInputs
 *  buildIdentityInputs(formData)     → IdentityCircuitInputs
 *  textToField(str)                  → string  (field element)
 *  extractNullifier(publicSignals)   → string  (hex bytes32)
 *  useZKP()                          → React hook
 *
 * ── ZKPResult shape ──────────────────────────────────────────────────────
 *  {
 *    proof:          { pi_a, pi_b, pi_c }   raw snarkjs proof
 *    publicSignals:  string[]               public output values
 *    solidityProof:  { pi_a, pi_b, pi_c }   formatted for Solidity
 *    nullifierHash:  string                 bytes32 hex string
 *    claimType:      string                 "AGE_OVER_18" | "IDENTITY_VERIFIED"
 *    generatedAt:    number                 Date.now()
 *  }
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Constants ─────────────────────────────────────────────────────────────────

// Circuit WASM + zkey paths (relative to /public/)
export const CIRCUIT_PATHS = {
  AGE_OVER_18: {
    wasm:  "/circuits/AgeProof.wasm",
    zkey:  "/circuits/AgeProof_final.zkey",
    vkey:  "/circuits/AgeProof_verification_key.json",
  },
  IDENTITY_VERIFIED: {
    wasm:  "/circuits/IdentityProof.wasm",
    zkey:  "/circuits/IdentityProof_final.zkey",
    vkey:  "/circuits/IdentityProof_verification_key.json",
  },
};

// BN128 scalar field prime — all inputs must be < this
const SNARK_FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Numeric IDs for claim types (must match circuit claimType input)
export const CLAIM_NUMERIC_IDS = {
  AGE_OVER_18:        1,
  IDENTITY_VERIFIED:  2,
};

// ── Field element helpers ─────────────────────────────────────────────────────

/**
 * Convert any UTF-8 string into a BN128 field element string.
 * Used to convert text inputs (names, ID numbers) into numbers
 * the circom circuit can process.
 *
 * Algorithm: polynomial rolling hash mod SNARK_FIELD_SIZE
 * — deterministic, collision-resistant for our use case,
 *   and always produces a valid field element.
 *
 * @param {string} str  Any UTF-8 string
 * @returns {string}    Decimal string safe for circuit input
 *
 * @example
 *   textToField("Alice")  → "12345678901234567890..."
 *   textToField("")       → "0"
 */
export function textToField(str) {
  if (!str || typeof str !== "string") return "0";
  let hash = 0n;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31n + BigInt(str.charCodeAt(i))) % SNARK_FIELD_SIZE;
  }
  return hash.toString();
}

/**
 * Convert a hex string (e.g. wallet signature) into a field element.
 * Used by deriveSecretFromSignature.
 *
 * @param {string} hex  Hex string with or without 0x prefix
 * @returns {string}    Decimal string
 */
export function hexToField(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const big   = BigInt("0x" + clean) % SNARK_FIELD_SIZE;
  return big.toString();
}

/**
 * Derive a deterministic secret field element from a wallet signature.
 * The user signs a fixed message once → same wallet always gives same secret.
 * This means users NEVER need to remember or store a secret separately.
 *
 * @param {string} walletSignature  Hex signature from wallet.signMessage()
 * @returns {string}                Field element string for circuit "secret" input
 *
 * @example
 *   const sig    = await wallet.signMessage("DID Protocol ZKP Secret v1");
 *   const secret = deriveSecretFromSignature(sig);
 *   // Pass `secret` as the `secret` input to any circuit
 */
export function deriveSecretFromSignature(walletSignature) {
  return hexToField(walletSignature);
}

// ── Input builders ────────────────────────────────────────────────────────────

/**
 * Build the full input object for AgeProof.circom from raw form values.
 *
 * @param {object} formData
 * @param {string} formData.birthYear     e.g. "1995"
 * @param {string} formData.birthMonth    e.g. "7"
 * @param {string} formData.birthDay      e.g. "14"
 * @param {string} formData.secret        Random string or wallet-derived secret
 *
 * @returns {AgeCircuitInputs}  Object ready to pass into snarkjs.groth16.fullProve
 *
 * @example
 *   const inputs = buildAgeInputs({
 *     birthYear: "1995", birthMonth: "7", birthDay: "14",
 *     secret: deriveSecretFromSignature(sig),
 *   });
 */
export function buildAgeInputs(formData) {
  _validateRequired(formData, ["birthYear", "birthMonth", "birthDay", "secret"]);

  const now = new Date();

  return {
    // Private inputs
    birthYear:    String(formData.birthYear),
    birthMonth:   String(formData.birthMonth),
    birthDay:     String(formData.birthDay),
    secret:       typeof formData.secret === "string" && formData.secret.length > 20
                    ? textToField(formData.secret)
                    : String(formData.secret),

    // Public inputs
    currentYear:  String(now.getFullYear()),
    currentMonth: String(now.getMonth() + 1),
    currentDay:   String(now.getDate()),
    minAge:       "18",
    claimType:    String(CLAIM_NUMERIC_IDS.AGE_OVER_18),
  };
}

/**
 * Build the full input object for IdentityProof.circom from raw form values.
 *
 * @param {object} formData
 * @param {string} formData.idNumber          Government ID number (hashed internally)
 * @param {string} formData.firstName         First name as on document
 * @param {string} formData.lastName          Last name as on document
 * @param {string} formData.nationalityCode   Numeric country code e.g. "91"
 * @param {string} formData.documentType      "1" | "2" | "3"
 * @param {string} formData.expiryYear        e.g. "2030"
 * @param {string} formData.expiryMonth       e.g. "6"
 * @param {string} formData.issuingAuthority  Name of issuing body
 * @param {string} formData.secret            Random string or wallet-derived secret
 * @param {string} formData.issuerCommitment  Poseidon(issuingAuthority) — from verifier
 *
 * @returns {IdentityCircuitInputs}
 */
export function buildIdentityInputs(formData) {
  _validateRequired(formData, [
    "idNumber", "firstName", "lastName",
    "nationalityCode", "documentType",
    "expiryYear", "expiryMonth",
    "issuingAuthority", "secret",
  ]);

  const now = new Date();

  return {
    // Private inputs — text fields hashed to field elements
    idNumber:         textToField(formData.idNumber),
    firstName:        textToField(formData.firstName),
    lastName:         textToField(formData.lastName),
    nationalityCode:  String(formData.nationalityCode),
    documentType:     String(formData.documentType),
    expiryYear:       String(formData.expiryYear),
    expiryMonth:      String(formData.expiryMonth),
    issuingAuthority: textToField(formData.issuingAuthority),
    secret:           typeof formData.secret === "string" && formData.secret.length > 20
                        ? textToField(formData.secret)
                        : String(formData.secret),

    // Public inputs
    currentYear:      String(now.getFullYear()),
    currentMonth:     String(now.getMonth() + 1),
    allowedDocTypes:  "7",    // 0b111 — accept all doc types
    claimType:        String(CLAIM_NUMERIC_IDS.IDENTITY_VERIFIED),
    issuerCommitment: formData.issuerCommitment ?? "0",
  };
}

// ── Proof generation ──────────────────────────────────────────────────────────

/**
 * Core proof generation function.
 * Dynamically imports snarkjs (keeps initial bundle lean),
 * then calls groth16.fullProve with the WASM circuit.
 *
 * @param {string} claimType   "AGE_OVER_18" | "IDENTITY_VERIFIED"
 * @param {object} inputs      Circuit input object (from buildAgeInputs etc.)
 * @param {Function} onProgress  Optional progress callback (message: string)
 *
 * @returns {Promise<ZKPResult>}
 *
 * @throws {ZKPError} with human-readable message on failure
 */
async function _generateProof(claimType, inputs, onProgress) {
  const paths = CIRCUIT_PATHS[claimType];
  if (!paths) throw new ZKPError(`Unknown claim type: "${claimType}"`);

  onProgress?.("Loading snarkjs…");
  let snarkjs;
  try {
    snarkjs = await import("snarkjs");
  } catch {
    throw new ZKPError(
      "Failed to load snarkjs. Run `npm install snarkjs` in the frontend folder."
    );
  }

  onProgress?.(`Loading ${claimType} circuit WASM…`);
  _assertCircuitFilesExist(paths);

  onProgress?.("Generating proof — this may take 5–30 seconds…");

  let proof, publicSignals;
  try {
    ({ proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      paths.wasm,
      paths.zkey
    ));
  } catch (err) {
    throw new ZKPError(_parseSnarkjsError(err));
  }

  onProgress?.("Proof generated. Formatting for Solidity…");

  const solidityProof  = formatProofForSolidity(proof);
  const nullifierHash  = extractNullifier(publicSignals, claimType);

  return {
    proof,
    publicSignals,
    solidityProof,
    nullifierHash,
    claimType,
    generatedAt: Date.now(),
  };
}

/**
 * Generate an Age Over 18 ZKP proof.
 *
 * @param {object}   formData    Raw user form data
 * @param {Function} onProgress  Optional callback(message: string)
 * @returns {Promise<ZKPResult>}
 *
 * @example
 *   const result = await generateAgeProof(
 *     { birthYear: "1995", birthMonth: "7", birthDay: "14", secret: sig },
 *     (msg) => setLog(msg)
 *   );
 *   console.log(result.nullifierHash); // "0xabc123..."
 *   console.log(result.solidityProof); // { pi_a, pi_b, pi_c }
 */
export async function generateAgeProof(formData, onProgress) {
  onProgress?.("Building circuit inputs…");
  const inputs = buildAgeInputs(formData);
  return _generateProof("AGE_OVER_18", inputs, onProgress);
}

/**
 * Generate an Identity Verified ZKP proof.
 *
 * @param {object}   formData    Raw user form data
 * @param {Function} onProgress  Optional callback(message: string)
 * @returns {Promise<ZKPResult>}
 */
export async function generateIdentityProof(formData, onProgress) {
  onProgress?.("Building circuit inputs…");
  const inputs = buildIdentityInputs(formData);
  return _generateProof("IDENTITY_VERIFIED", inputs, onProgress);
}

// ── Proof formatting ──────────────────────────────────────────────────────────

/**
 * Format a raw snarkjs proof for Solidity.
 *
 * snarkjs outputs pi_b as [[x1,x2],[y1,y2]]
 * Solidity expects pi_b transposed:  [[x2,x1],[y2,y1]]
 * This is a known snarkjs ↔ Solidity convention difference.
 *
 * @param {object} proof  Raw proof from snarkjs.groth16.fullProve
 * @returns {SolidityProof}  { pi_a: [x,y], pi_b: [[x2,x1],[y2,y1]], pi_c: [x,y] }
 *
 * @example
 *   const fmt = formatProofForSolidity(proof);
 *   await zkpVerifier.verifyProof(
 *     claimType, fmt.pi_a, fmt.pi_b, fmt.pi_c, publicSignals, nullifier
 *   );
 */
export function formatProofForSolidity(proof) {
  return {
    pi_a: [proof.pi_a[0], proof.pi_a[1]],
    pi_b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],  // ← transposed
      [proof.pi_b[1][1], proof.pi_b[1][0]],  // ← transposed
    ],
    pi_c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

// ── Nullifier extraction ──────────────────────────────────────────────────────

/**
 * Extract the nullifier hash from the circuit's public signals array
 * and return it as a bytes32 hex string for Solidity.
 *
 * Signal layout for AgeProof:
 *   publicSignals[0] = ageVerified (1)
 *   publicSignals[1] = nullifierHash
 *   publicSignals[2] = identityCommitment
 *
 * Signal layout for IdentityProof:
 *   publicSignals[0] = identityVerified (1)
 *   publicSignals[1] = nullifierHash
 *   publicSignals[2] = identityCommitment
 *   publicSignals[3] = nameCommitment
 *   publicSignals[4] = documentTypeOut
 *
 * @param {string[]} publicSignals  Array of decimal strings from snarkjs
 * @param {string}   claimType      "AGE_OVER_18" | "IDENTITY_VERIFIED"
 * @returns {string}                bytes32 hex string e.g. "0xabc123..."
 */
export function extractNullifier(publicSignals, claimType) {
  // nullifier is always at index 1 in both circuits
  const raw = publicSignals?.[1];
  if (!raw) throw new ZKPError("Could not extract nullifier from public signals.");

  const hex = BigInt(raw).toString(16).padStart(64, "0");
  return "0x" + hex;
}

/**
 * Extract all named output signals from the public signals array.
 * Returns a clean object with human-readable keys.
 *
 * @param {string[]} publicSignals
 * @param {string}   claimType
 * @returns {object}
 */
export function extractPublicOutputs(publicSignals, claimType) {
  if (claimType === "AGE_OVER_18") {
    return {
      ageVerified:        publicSignals[0],
      nullifierHash:      "0x" + BigInt(publicSignals[1]).toString(16).padStart(64, "0"),
      identityCommitment: publicSignals[2],
    };
  }

  if (claimType === "IDENTITY_VERIFIED") {
    return {
      identityVerified:   publicSignals[0],
      nullifierHash:      "0x" + BigInt(publicSignals[1]).toString(16).padStart(64, "0"),
      identityCommitment: publicSignals[2],
      nameCommitment:     publicSignals[3],
      documentTypeOut:    publicSignals[4],
    };
  }

  return { raw: publicSignals };
}

// ── Local verification ────────────────────────────────────────────────────────

/**
 * Verify a proof locally in the browser against the verification key JSON.
 * Useful for a fast sanity check BEFORE submitting on-chain (saves gas).
 *
 * @param {object}   proof          Raw snarkjs proof object
 * @param {string[]} publicSignals  Public signals array
 * @param {string}   claimType      "AGE_OVER_18" | "IDENTITY_VERIFIED"
 * @returns {Promise<boolean>}      true if proof is valid
 *
 * @example
 *   const ok = await verifyProofLocally(proof, publicSignals, "AGE_OVER_18");
 *   if (!ok) throw new Error("Proof failed local verification");
 */
export async function verifyProofLocally(proof, publicSignals, claimType) {
  const paths = CIRCUIT_PATHS[claimType];
  if (!paths?.vkey) return false;

  let snarkjs;
  try {
    snarkjs = await import("snarkjs");
  } catch {
    console.warn("[zkp.js] snarkjs not available for local verification.");
    return false;
  }

  try {
    const vkeyRes = await fetch(paths.vkey);
    if (!vkeyRes.ok) {
      console.warn(`[zkp.js] Verification key not found at ${paths.vkey}`);
      return false;
    }
    const vkey = await vkeyRes.json();
    return await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } catch (err) {
    console.error("[zkp.js] Local verification error:", err);
    return false;
  }
}

// ── Error class ───────────────────────────────────────────────────────────────

export class ZKPError extends Error {
  constructor(message) {
    super(message);
    this.name = "ZKPError";
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _validateRequired(data, fields) {
  for (const f of fields) {
    if (data[f] === undefined || data[f] === null || data[f] === "") {
      throw new ZKPError(`Missing required input: "${f}"`);
    }
  }
}

function _assertCircuitFilesExist(paths) {
  // We can't check file existence in the browser, but we can warn clearly
  if (!paths.wasm || !paths.zkey) {
    throw new ZKPError(
      "Circuit WASM or zkey path is not configured. " +
      "Run `npm run proof:all` from the project root to compile circuits, " +
      "then copy the output files to frontend/public/circuits/."
    );
  }
}

function _parseSnarkjsError(err) {
  const msg = err?.message || String(err);

  if (msg.includes("Assert Failed") || msg.includes("constraint")) {
    return (
      "Proof generation failed: your inputs did not satisfy the circuit constraints. " +
      "Check that your birth date is correct and your age is ≥ 18."
    );
  }
  if (msg.includes("fetch") || msg.includes("404") || msg.includes("Failed to fetch")) {
    return (
      "Circuit files not found. Make sure AgeProof.wasm and AgeProof_final.zkey " +
      "exist in frontend/public/circuits/. Run `npm run proof:all` to generate them."
    );
  }
  if (msg.includes("memory") || msg.includes("WebAssembly")) {
    return (
      "WebAssembly error — your browser may not support the required features. " +
      "Try Chrome or Firefox with hardware acceleration enabled."
    );
  }
  return `Proof generation failed: ${msg}`;
}

// commented by svr bz usabulity and nessery needs.
// ── React hook ────────────────────────────────────────────────────────────────
// as per the usage (zkp) 

/**
 * useZKP()
 * ─────────────────────────────────────────────────────────────────────────
 * React hook that wraps the ZKP generation flow with:
 *   • loading state
 *   • progress log lines
 *   • error handling
 *   • result storage
 *
 * @returns {{
 *   generateAge:      (formData) => Promise<ZKPResult | null>
 *   generateIdentity: (formData) => Promise<ZKPResult | null>
 *   verifyLocally:    (proof, signals, claimType) => Promise<boolean>
 *   loading:          boolean
 *   progress:         string[]          log lines shown in terminal UI
 *   error:            string | null
 *   result:           ZKPResult | null
 *   reset:            () => void
 * }}
 *
 * @example
 *   const zkp = useZKP();
 *
 *   const handleGenerate = async () => {
 *     const result = await zkp.generateAge({
 *       birthYear: "1995", birthMonth: "7", birthDay: "14",
 *       secret: walletSignature,
 *     });
 *     if (result) {
 *       console.log(result.nullifierHash);
 *       console.log(result.solidityProof);
 *     }
 *   };
 *
 *   // In JSX:
 *   {zkp.progress.map((line, i) => <p key={i}>{line}</p>)}
 *   {zkp.error && <p className="error">{zkp.error}</p>}
 */
export function useZKP() {
  const { useState, useCallback } = require("react");

  const [loading,  setLoading]  = useState(false);
  const [progress, setProgress] = useState([]);
  const [error,    setError]    = useState(null);
  const [result,   setResult]   = useState(null);

  const _addLog = useCallback((msg) => {
    setProgress(prev => [...prev, msg]);
  }, []);

  const _run = useCallback(async (fn) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress([]);

    try {
      const res = await fn(_addLog);
      setResult(res);
      return res;
    } catch (err) {
      const msg = err instanceof ZKPError
        ? err.message
        : `Unexpected error: ${err.message}`;
      setError(msg);
      _addLog(`✕ ${msg}`);
      return null;
    } finally {
      setLoading(false);
    }
  }, [_addLog]);

  const generateAge = useCallback((formData) =>
    _run((log) => generateAgeProof(formData, log)),
  [_run]);

  const generateIdentity = useCallback((formData) =>
    _run((log) => generateIdentityProof(formData, log)),
  [_run]);

  const verifyLocally = useCallback(
    (proof, signals, claimType) => verifyProofLocally(proof, signals, claimType),
    []
  );

  const reset = useCallback(() => {
    setLoading(false);
    setProgress([]);
    setError(null);
    setResult(null);
  }, []);

  return {
    generateAge,
    generateIdentity,
    verifyLocally,
    loading,
    progress,
    error,
    result,
    reset,
  };
}

// ── Named convenience exports ─────────────────────────────────────────────────

export {
  CIRCUIT_PATHS as circuitPaths,
  CLAIM_NUMERIC_IDS as claimIds,
};

// ── Default export: all utilities bundled ─────────────────────────────────────
export default {
  // Proof generation
  generateAgeProof,
  generateIdentityProof,

  // Input builders
  buildAgeInputs,
  buildIdentityInputs,

  // Formatting
  formatProofForSolidity,
  extractNullifier,
  extractPublicOutputs,

  // Verification
  verifyProofLocally,

  // Field helpers
  textToField,
  hexToField,
  deriveSecretFromSignature,

  // React
  useZKP,

  // Error class
  ZKPError,

  // Constants
  CIRCUIT_PATHS,
  CLAIM_NUMERIC_IDS,
};
