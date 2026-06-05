# ZKP Frontend Architecture

## Full Breakdown of Everything Inside

### The Core Idea — Why Browser-Side ZKP Matters

The entire point of ZKP is that private data never leaves the user's device.

`zkp.js` runs the compiled Circom WASM circuit directly in the browser using `snarkjs`. The private inputs (birth date, ID number, secret) are fed into the WASM, the math runs locally, and only the proof points and public signals are ever sent anywhere.

**Nothing sensitive touches the network.**

---

# Key Functions Explained

## `textToField(str)`

Converts any UTF-8 string (name, ID number, etc.) into a BN128 field element.

Uses a polynomial rolling hash modulo the SNARK scalar field.

Every string maps to a deterministic number that the circuit can process.

```js
const fieldValue = textToField("John Doe");
```

---

## `deriveSecretFromSignature(walletSignature)`

The most important UX decision in the file.

Instead of asking users to remember or store a secret, they simply sign a fixed message with their wallet:

- No gas
- No transaction
- No storage

Because wallet signatures are deterministic, the same wallet always produces the same secret.

```js
const sig = await wallet.signMessage(
  "DID Protocol ZKP Secret v1"
);

const secret = deriveSecretFromSignature(sig);
```

---

## `buildAgeInputs(formData)`

Takes raw form values and converts them into the exact structure expected by the Circom circuit.

Responsibilities:

- Hashes text fields using `textToField()`
- Reads current date using `new Date()`
- Formats everything into circuit-compatible inputs

```js
const inputs = buildAgeInputs({
  birthYear: "1995",
  birthMonth: "7",
  birthDay: "14",
  secret
});
```

---

## `_generateProof(claimType, inputs, onProgress)`

The proof-generation engine.

### What it does

1. Dynamically imports `snarkjs`
2. Loads circuit WASM from `/public/circuits/`
3. Loads `.zkey`
4. Calls:

```js
groth16.fullProve()
```

5. Packages the result into a `ZKPResult`

### Why dynamic imports?

Keeps the initial frontend bundle small and loads ZKP code only when needed.

---

## `formatProofForSolidity(proof)`

Critical Solidity compatibility layer.

### snarkjs Output

```js
pi_b = [
  [x1, x2],
  [y1, y2]
]
```

### Solidity Verifier Expectation

```js
pi_b = [
  [x2, x1],
  [y2, y1]
]
```

This is a well-known `snarkjs ↔ Solidity` convention mismatch.

Failing to transpose `pi_b` correctly will cause valid proofs to fail on-chain with little or no debugging information.

---

## `extractNullifier(publicSignals)`

Extracts the nullifier from the public signals array.

Both circuits store the nullifier at:

```js
publicSignals[1]
```

The function:

1. Reads the decimal string
2. Converts it to hex
3. Pads it to 32 bytes
4. Returns a Solidity-compatible `bytes32`

```js
const nullifierHash = extractNullifier(publicSignals);
```

Ready for:

```solidity
ZKPVerifier.verifyProof(...)
```

---

## `verifyProofLocally(proof, signals, claimType)`

Runs verification in the browser before spending gas.

### Process

Loads:

```text
/public/circuits/*_verification_key.json
```

Then executes:

```js
groth16.verify(...)
```

### Benefits

- Detects invalid proofs early
- Prevents failed on-chain transactions
- Saves users gas fees

---

# React Integration

## `useZKP()` Hook

Example usage inside `ProveIdentity.jsx`

```jsx
import { useZKP } from "../utils/zkp";
import { deriveSecretFromSignature } from "../utils/zkp";

function ProveIdentity({ wallet }) {
  const zkp = useZKP();

  const handleProve = async () => {
    // Derive secret from wallet
    const sig = await wallet.signMessage(
      "DID Protocol ZKP Secret v1"
    );

    const secret = deriveSecretFromSignature(sig);

    const result = await zkp.generateAge({
      birthYear: "1995",
      birthMonth: "7",
      birthDay: "14",
      secret,
    });

    if (result) {
      await zkpVerifier.verifyProof(
        claimType,
        result.solidityProof.pi_a,
        result.solidityProof.pi_b,
        result.solidityProof.pi_c,
        result.publicSignals,
        result.nullifierHash
      );
    }
  };

  return (
    <>
      {/* Live progress log */}
      {zkp.progress.map((line, i) => (
        <p key={i}>{line}</p>
      ))}

      {zkp.error && <p>{zkp.error}</p>}

      {zkp.loading && <p>Generating proof…</p>}

      <button
        onClick={handleProve}
        disabled={zkp.loading}
      >
        Prove Age
      </button>
    </>
  );
}
```

---

# Circuit Files Setup

After generating proving artifacts:

```bash
npm run proof:all
```

Copy the generated files into the frontend:

## AgeProof

```bash
cp circuits/build/AgeProof_js/AgeProof.wasm \
   frontend/public/circuits/

cp circuits/build/AgeProof_final.zkey \
   frontend/public/circuits/

cp circuits/build/verification_key.json \
   frontend/public/circuits/AgeProof_verification_key.json
```

---

## IdentityProof

```bash
cp circuits/build/IdentityProof_js/IdentityProof.wasm \
   frontend/public/circuits/

cp circuits/build/IdentityProof_final.zkey \
   frontend/public/circuits/
```

---

# Proof Generation Flow

```text
User Inputs
      │
      ▼
buildAgeInputs()
      │
      ▼
_generateProof()
      │
      ├── Load WASM
      ├── Load ZKey
      ├── groth16.fullProve()
      ▼
formatProofForSolidity()
      │
      ▼
extractNullifier()
      │
      ▼
verifyProofLocally()
      │
      ▼
Submit to ZKPVerifier.sol
```

---

# Security Properties

1. Private inputs never leave the browser

2. Secrets derived from wallet signatures

3. No secret storage required

4. Local proof verification before gas expenditure

5. Nullifier support for replay prevention

6. Solidity-compatible proof formatting

7. Dynamic loading minimizes frontend bundle size

---

# Result

The frontend provides a complete browser-native ZK proving pipeline:

- Input processing
- Secret derivation
- WASM circuit execution
- Proof generation
- Local verification
- Solidity formatting
- On-chain submission

All while keeping sensitive user data entirely on the user's device.
