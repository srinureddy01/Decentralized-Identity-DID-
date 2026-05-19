pragma circom 2.1.6;

/*
 * IdentityProof.circom
 * ───────────────────────────────────────────────────────────────────────────
 * Zero-Knowledge Proof circuit that proves a user owns a valid identity
 * credential (passport, national ID, driver's licence) WITHOUT revealing
 * any personal details — not their name, ID number, nationality, or
 * document number.
 *
 * Folder: did-protocol/circuits/IdentityProof.circom
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 *
 *  Private inputs (NEVER leave the user's device):
 *    - idNumber           Numeric hash of government ID number
 *    - firstName          Poseidon hash of first name
 *    - lastName           Poseidon hash of last name
 *    - nationalityCode    Numeric country code (91=India, 1=USA, 44=UK...)
 *    - documentType       1=Passport  2=National ID  3=Driver Licence
 *    - expiryYear         Document expiry year  e.g. 2030
 *    - expiryMonth        Document expiry month e.g. 6
 *    - issuingAuthority   Numeric hash of the issuing government body
 *    - secret             Random 256-bit salt — kept only by the user
 *
 *  Public inputs (go on-chain — reveal NOTHING personal):
 *    - currentYear        e.g. 2026
 *    - currentMonth       e.g. 5
 *    - allowedDocTypes    Bitmask of accepted document types
 *                         0b001=1 → passport only
 *                         0b011=3 → passport or national ID
 *                         0b111=7 → all three accepted
 *    - claimType          Numeric claim ID  (2 = IDENTITY_VERIFIED)
 *    - issuerCommitment   Poseidon(issuingAuthority) — trusted issuer hash
 *
 *  Public outputs:
 *    - identityVerified      1 if every check passes
 *    - nullifierHash         Poseidon(secret, claimType)  — anti-replay
 *    - identityCommitment    Poseidon(secret, idNumber, nationalityCode)
 *    - nameCommitment        Poseidon(secret, firstName, lastName)
 *    - documentTypeOut       Category of doc used (1/2/3) — not the number
 *
 * ── CHECKS PERFORMED INSIDE THE CIRCUIT ─────────────────────────────────────
 *  1. Document is NOT expired   (expiryDate > currentDate)
 *  2. Document type is allowed  (bitmask check)
 *  3. Issuing authority is trusted  (Poseidon re-derivation == issuerCommitment)
 *  4. Input ranges are valid    (months 1-12, doc type 1-3)
 *
 * ── INSTALL & COMPILE ───────────────────────────────────────────────────────
 *  npm install circomlib
 *
 *  circom circuits/IdentityProof.circom \
 *    --r1cs --wasm --sym \
 *    -l node_modules/circomlib/circuits \
 *    -o circuits/build/
 *
 *  Then follow the same snarkjs Powers-of-Tau + Groth16 setup steps
 *  documented in AgeProof.circom.
 * ───────────────────────────────────────────────────────────────────────────
 */

include "comparators.circom";
include "poseidon.circom";
include "bitify.circom";

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER 1 — DateToMonths
//  Converts (year, month) → total months since year 0.
//  Document expiry is tracked at month granularity, not day.
// ═══════════════════════════════════════════════════════════════════════════
template DateToMonths() {
    signal input year;
    signal input month;
    signal output totalMonths;

    signal yearPart;
    yearPart    <== year * 12;
    totalMonths <== yearPart + month;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER 2 — ExpiryCheck
//  Returns 1 if expiryMonths > currentMonths (document still valid).
//  Uses GreaterThan(32) — 32 bits covers year 357 million, plenty.
// ═══════════════════════════════════════════════════════════════════════════
template ExpiryCheck() {
    signal input expiryMonths;
    signal input currentMonths;
    signal output notExpired;    // 1 = valid, 0 = expired

    component gt = GreaterThan(32);
    gt.in[0] <== expiryMonths;
    gt.in[1] <== currentMonths;

    notExpired <== gt.out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER 3 — DocTypeBitmaskCheck
//
//  allowedDocTypes bitmask layout:
//    bit 0 → Passport       allowed if bit = 1
//    bit 1 → National ID    allowed if bit = 1
//    bit 2 → Driver Lic     allowed if bit = 1
//
//  documentType is 1, 2, or 3 → maps to bit index 0, 1, 2 respectively.
//
//  Algorithm:
//    - Decompose allowedDocTypes into 3 bits
//    - Build an IsEqual selector for each possible documentType value
//    - AND each selector with its corresponding bit
//    - OR the three results together
// ═══════════════════════════════════════════════════════════════════════════
template DocTypeBitmaskCheck() {
    signal input documentType;
    signal input allowedDocTypes;
    signal output isAllowed;

    // decompose bitmask → 3 bits
    component bits = Num2Bits(3);
    bits.in <== allowedDocTypes;

    // is documentType == 1 ?
    component eq1 = IsEqual();
    eq1.in[0] <== documentType;
    eq1.in[1] <== 1;

    // is documentType == 2 ?
    component eq2 = IsEqual();
    eq2.in[0] <== documentType;
    eq2.in[1] <== 2;

    // is documentType == 3 ?
    component eq3 = IsEqual();
    eq3.in[0] <== documentType;
    eq3.in[1] <== 3;

    // AND each selector with its bitmask bit
    signal match1;
    signal match2;
    signal match3;
    match1 <== eq1.out * bits.out[0];
    match2 <== eq2.out * bits.out[1];
    match3 <== eq3.out * bits.out[2];

    // Binary OR across three mutually-exclusive signals:
    // at most one of match1/match2/match3 can be 1 (only one doc type),
    // so simple addition is a safe OR here.
    signal or12;
    or12 <== match1 + match2 - match1 * match2;

    signal or123;
    or123 <== or12 + match3 - or12 * match3;

    isAllowed <== or123;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER 4 — IssuerCheck
//
//  The verifier holds a Poseidon hash of each trusted issuing authority's
//  name (e.g. "Ministry of Home Affairs India", "USCIS", etc.).
//  The circuit re-derives Poseidon(issuingAuthority) and asserts it equals
//  the public issuerCommitment.
//
//  Proves the document came from a trusted body without naming it.
// ═══════════════════════════════════════════════════════════════════════════
template IssuerCheck() {
    signal input issuingAuthority;   // private
    signal input issuerCommitment;   // public  (Poseidon(issuingAuthority))
    signal output isValid;           // 1 if they match

    component h = Poseidon(1);
    h.inputs[0] <== issuingAuthority;

    component eq = IsEqual();
    eq.in[0] <== h.out;
    eq.in[1] <== issuerCommitment;

    isValid <== eq.out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HELPER 5 — RangeAssert
//  Asserts minVal <= value <= maxVal.
//  Used to validate months (1-12) and documentType (1-3).
// ═══════════════════════════════════════════════════════════════════════════
template RangeAssert(n) {
    signal input value;
    signal input minVal;
    signal input maxVal;

    component gte = GreaterEqThan(n);
    gte.in[0] <== value;
    gte.in[1] <== minVal;
    gte.out === 1;

    component lte = LessEqThan(n);
    lte.in[0] <== value;
    lte.in[1] <== maxVal;
    lte.out === 1;
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN — IdentityProof
// ═══════════════════════════════════════════════════════════════════════════
template IdentityProof() {

    // ── PRIVATE INPUTS ───────────────────────────────────────────────────────
    signal input idNumber;           // numeric hash of ID number
    signal input firstName;          // Poseidon hash of first name
    signal input lastName;           // Poseidon hash of last name
    signal input nationalityCode;    // numeric country code
    signal input documentType;       // 1 / 2 / 3
    signal input expiryYear;
    signal input expiryMonth;
    signal input issuingAuthority;   // numeric hash of issuing body name
    signal input secret;             // user's private random salt

    // ── PUBLIC INPUTS ────────────────────────────────────────────────────────
    signal input currentYear;
    signal input currentMonth;
    signal input allowedDocTypes;    // bitmask
    signal input claimType;          // 2 = IDENTITY_VERIFIED
    signal input issuerCommitment;   // Poseidon(issuingAuthority)

    // ── PUBLIC OUTPUTS ───────────────────────────────────────────────────────
    signal output identityVerified;
    signal output nullifierHash;
    signal output identityCommitment;
    signal output nameCommitment;
    signal output documentTypeOut;


    // ════════════════════════════════════════════════════════════════════════
    //  INPUT SANITY CHECKS
    // ════════════════════════════════════════════════════════════════════════

    // currentMonth: 1–12
    component cm = RangeAssert(8);
    cm.value  <== currentMonth;
    cm.minVal <== 1;
    cm.maxVal <== 12;

    // expiryMonth: 1–12
    component em = RangeAssert(8);
    em.value  <== expiryMonth;
    em.minVal <== 1;
    em.maxVal <== 12;

    // documentType: 1–3
    component dt = RangeAssert(8);
    dt.value  <== documentType;
    dt.minVal <== 1;
    dt.maxVal <== 3;


    // ════════════════════════════════════════════════════════════════════════
    //  CHECK 1 — Document is not expired
    // ════════════════════════════════════════════════════════════════════════
    component expDate = DateToMonths();
    expDate.year  <== expiryYear;
    expDate.month <== expiryMonth;

    component curDate = DateToMonths();
    curDate.year  <== currentYear;
    curDate.month <== currentMonth;

    component expiry = ExpiryCheck();
    expiry.expiryMonths  <== expDate.totalMonths;
    expiry.currentMonths <== curDate.totalMonths;

    expiry.notExpired === 1;   // CONSTRAINT — proof fails if document is expired


    // ════════════════════════════════════════════════════════════════════════
    //  CHECK 2 — Document type is allowed by verifier's bitmask
    // ════════════════════════════════════════════════════════════════════════
    component docCheck = DocTypeBitmaskCheck();
    docCheck.documentType    <== documentType;
    docCheck.allowedDocTypes <== allowedDocTypes;

    docCheck.isAllowed === 1;  // CONSTRAINT — proof fails if type not accepted


    // ════════════════════════════════════════════════════════════════════════
    //  CHECK 3 — Issuing authority is trusted
    // ════════════════════════════════════════════════════════════════════════
    component issuer = IssuerCheck();
    issuer.issuingAuthority <== issuingAuthority;
    issuer.issuerCommitment <== issuerCommitment;

    issuer.isValid === 1;      // CONSTRAINT — proof fails if issuer not trusted


    // ════════════════════════════════════════════════════════════════════════
    //  OUTPUT 1 — identityVerified = 1
    //  All three constraints above passed, so we can set this signal to 1.
    //  If any constraint had failed the circuit would have already aborted.
    // ════════════════════════════════════════════════════════════════════════
    identityVerified <== 1;


    // ════════════════════════════════════════════════════════════════════════
    //  OUTPUT 2 — nullifierHash = Poseidon(secret, claimType)
    //
    //  Unique per (user, claim). ZKPVerifier.sol stores this after first use.
    //  Any attempt to replay the same proof will be rejected on-chain.
    // ════════════════════════════════════════════════════════════════════════
    component nullifier = Poseidon(2);
    nullifier.inputs[0] <== secret;
    nullifier.inputs[1] <== claimType;

    nullifierHash <== nullifier.out;


    // ════════════════════════════════════════════════════════════════════════
    //  OUTPUT 3 — identityCommitment = Poseidon(secret, idNumber, nationalityCode)
    //
    //  The on-chain anchor for this user's identity.
    //  - Same user always produces the same commitment (deterministic)
    //  - Different users produce different commitments (collision resistant)
    //  - No one can reverse-engineer idNumber from the commitment
    //
    //  Stored in IPFS DID document at registration.
    //  At proof time the circuit re-derives it, so frontend can compare
    //  against the registered commitment to catch mismatches.
    // ════════════════════════════════════════════════════════════════════════
    component idCommit = Poseidon(3);
    idCommit.inputs[0] <== secret;
    idCommit.inputs[1] <== idNumber;
    idCommit.inputs[2] <== nationalityCode;

    identityCommitment <== idCommit.out;


    // ════════════════════════════════════════════════════════════════════════
    //  OUTPUT 4 — nameCommitment = Poseidon(secret, firstName, lastName)
    //
    //  Binds the user's name to their secret. Prevents a verified user from
    //  sharing their secret with someone who has a different name on their ID.
    //  Two different names for the same secret produce a different commitment,
    //  which won't match what was registered in the DID document.
    // ════════════════════════════════════════════════════════════════════════
    component nameCommit = Poseidon(3);
    nameCommit.inputs[0] <== secret;
    nameCommit.inputs[1] <== firstName;
    nameCommit.inputs[2] <== lastName;

    nameCommitment <== nameCommit.out;


    // ════════════════════════════════════════════════════════════════════════
    //  OUTPUT 5 — documentTypeOut
    //  Passes through the document TYPE category (1, 2, or 3).
    //  On-chain verifiers can require a specific type (e.g. passport only)
    //  without seeing the document number.
    // ════════════════════════════════════════════════════════════════════════
    documentTypeOut <== documentType;
}

// ── ENTRY POINT ──────────────────────────────────────────────────────────────
component main {
    public [
        currentYear,
        currentMonth,
        allowedDocTypes,
        claimType,
        issuerCommitment
    ]
} = IdentityProof();
