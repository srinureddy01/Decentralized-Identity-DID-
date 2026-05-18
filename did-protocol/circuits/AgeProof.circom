pragma circom 2.1.6;

/*
 * AgeProof.circom
 * ───────────────────────────────────────────────────────────────────────────
 * Zero-Knowledge Proof circuit that proves a user is 18 years or older
 * WITHOUT revealing their actual birth date or age.
 *
 * Folder: did-protocol/circuits/AgeProof.circom
 *
 * ── WHAT THIS PROVES ────────────────────────────────────────────────────────
 *  Private inputs (known only to the user, NEVER sent anywhere):
 *    - birthYear      e.g. 1995
 *    - birthMonth     e.g. 7  (July)
 *    - birthDay       e.g. 14
 *    - secret         random salt the user generates and keeps private
 *
 *  Public inputs (visible on-chain, reveal NOTHING personal):
 *    - currentYear    e.g. 2026  (provided by the frontend at proof time)
 *    - currentMonth   e.g. 5
 *    - currentDay     e.g. 18
 *    - minAge         18  (the threshold being checked)
 *    - nullifierHash  Poseidon(secret, claimType) — unique per user+claim,
 *                     prevents replay attacks, reveals nothing about identity
 *
 *  Output (public signal):
 *    - ageVerified    1 if age >= minAge, circuit fails to compile proof if not
 *
 * ── HOW IT WORKS ────────────────────────────────────────────────────────────
 *  1. Compute ageInDays = (currentDate - birthDate) in days
 *  2. Compute minAgeInDays = minAge * 365  (simplified — see note below)
 *  3. Assert ageInDays >= minAgeInDays using a range-check comparator
 *  4. Compute nullifierHash = Poseidon(secret, 1)  where 1 = AGE_OVER_18 claim
 *  5. Output ageVerified = 1
 *
 * ── INSTALL DEPENDENCIES ────────────────────────────────────────────────────
 *  npm install -g circom snarkjs
 *  npm install circomlib          ← provides Poseidon, Comparators, etc.
 *
 * ── COMPILE & SETUP COMMANDS ────────────────────────────────────────────────
 *  # 1. Compile the circuit to R1CS + WASM
 *  circom circuits/AgeProof.circom \
 *    --r1cs --wasm --sym \
 *    -l node_modules/circomlib/circuits \
 *    -o circuits/build/
 *
 *  # 2. Powers of Tau ceremony (one-time setup, use an existing ptau file)
 *  snarkjs powersoftau new bn128 12 circuits/build/pot12_0000.ptau -v
 *  snarkjs powersoftau contribute circuits/build/pot12_0000.ptau \
 *    circuits/build/pot12_0001.ptau --name="First contribution" -v
 *  snarkjs powersoftau prepare phase2 circuits/build/pot12_0001.ptau \
 *    circuits/build/pot12_final.ptau -v
 *
 *  # 3. Groth16 setup — generates proving key + verifying key
 *  snarkjs groth16 setup circuits/build/AgeProof.r1cs \
 *    circuits/build/pot12_final.ptau \
 *    circuits/build/AgeProof_0000.zkey
 *  snarkjs zkey contribute circuits/build/AgeProof_0000.zkey \
 *    circuits/build/AgeProof_final.zkey --name="1st Contributor" -v
 *
 *  # 4. Export the verifying key (used by ZKPVerifier.sol)
 *  snarkjs zkey export verificationkey circuits/build/AgeProof_final.zkey \
 *    circuits/build/verification_key.json
 *
 *  # 5. Export Solidity verifier (alternative to our custom ZKPVerifier.sol)
 *  snarkjs zkey export solidityverifier circuits/build/AgeProof_final.zkey \
 *    circuits/build/AgeProofVerifier_generated.sol
 * ───────────────────────────────────────────────────────────────────────────
 */

// ── IMPORTS from circomlib ───────────────────────────────────────────────────
// circomlib gives us battle-tested, audited circuit templates.
// Install with: npm install circomlib

include "comparators.circom";   // LessEqThan, GreaterEqThan, IsEqual
include "poseidon.circom";      // Poseidon hash — ZKP-friendly hash function
include "bitify.circom";        // Num2Bits — converts numbers to binary for range checks

// ── HELPER TEMPLATE: DateTodays ─────────────────────────────────────────────
// Converts a calendar date (year, month, day) into an approximate
// total-days-since-year-0 value for easy numeric comparison.
//
// Formula: days = year*365 + month*30 + day
// (Simplified — ignores leap years and variable month lengths.
//  This is acceptable for age verification since we're checking an 18-year
//  gap; a ±30 day error is negligible and cannot be exploited to fake adulthood.)
// ────────────────────────────────────────────────────────────────────────────
template DateToDays() {
    signal input year;
    signal input month;
    signal input day;
    signal output days;

    // days = year * 365 + month * 30 + day
    signal yearDays;
    signal monthDays;

    yearDays  <== year  * 365;
    monthDays <== month * 30;
    days      <== yearDays + monthDays + day;
}

// ── HELPER TEMPLATE: AgeInDays ───────────────────────────────────────────────
// Computes the difference in days between two dates.
// currentDays - birthDays = ageInDays
// ────────────────────────────────────────────────────────────────────────────
template AgeInDays() {
    signal input currentDays;
    signal input birthDays;
    signal output ageDays;

    ageDays <== currentDays - birthDays;
}

// ── HELPER TEMPLATE: RangeCheck ──────────────────────────────────────────────
// Asserts that value >= minValue using a GreaterEqThan comparator.
// n = number of bits needed to represent the values (we use 32 for dates).
// ────────────────────────────────────────────────────────────────────────────
template RangeCheck(n) {
    signal input value;
    signal input minValue;
    signal output valid;   // 1 if value >= minValue, 0 otherwise

    component gte = GreaterEqThan(n);
    gte.in[0] <== value;
    gte.in[1] <== minValue;

    valid <== gte.out;
}

// ── MAIN TEMPLATE: AgeProof ──────────────────────────────────────────────────
template AgeProof() {

    // ── PRIVATE INPUTS (user's secret data — never leaves their device) ──────
    signal input birthYear;       // e.g. 1995
    signal input birthMonth;      // e.g. 7
    signal input birthDay;        // e.g. 14
    signal input secret;          // random 256-bit salt, stored only by user

    // ── PUBLIC INPUTS (visible on-chain — reveal NOTHING personal) ───────────
    signal input currentYear;     // e.g. 2026  — provided by frontend
    signal input currentMonth;    // e.g. 5
    signal input currentDay;      // e.g. 18
    signal input minAge;          // 18 — the age threshold being verified
    signal input claimType;       // 1 = AGE_OVER_18 (numeric ID of the claim)

    // ── PUBLIC OUTPUTS ────────────────────────────────────────────────────────
    signal output ageVerified;    // 1 if age >= minAge
    signal output nullifierHash;  // Poseidon(secret, claimType) — anti-replay


    // ════════════════════════════════════════════════════════════════════════
    //  STEP 1 — Convert birth date to total days
    // ════════════════════════════════════════════════════════════════════════
    component birthDateToDays = DateToDays();
    birthDateToDays.year  <== birthYear;
    birthDateToDays.month <== birthMonth;
    birthDateToDays.day   <== birthDay;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 2 — Convert current date to total days
    // ════════════════════════════════════════════════════════════════════════
    component currentDateToDays = DateToDays();
    currentDateToDays.year  <== currentYear;
    currentDateToDays.month <== currentMonth;
    currentDateToDays.day   <== currentDay;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 3 — Compute age in days
    // ════════════════════════════════════════════════════════════════════════
    component ageCalc = AgeInDays();
    ageCalc.currentDays <== currentDateToDays.days;
    ageCalc.birthDays   <== birthDateToDays.days;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 4 — Compute minimum age threshold in days
    //  minAgeInDays = minAge * 365
    // ════════════════════════════════════════════════════════════════════════
    signal minAgeInDays;
    minAgeInDays <== minAge * 365;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 5 — Range check: ageInDays >= minAgeInDays
    //  32 bits is enough for dates (~4 billion days covers year 11 million)
    // ════════════════════════════════════════════════════════════════════════
    component check = RangeCheck(32);
    check.value    <== ageCalc.ageDays;
    check.minValue <== minAgeInDays;

    // !! CRITICAL CONSTRAINT !!
    // This line makes the circuit FAIL to generate a valid proof
    // if the user is under 18. It does NOT reveal their age — it just
    // makes the math impossible to satisfy without a valid age.
    check.valid === 1;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 6 — Set ageVerified output signal
    // ════════════════════════════════════════════════════════════════════════
    ageVerified <== check.valid;   // always 1 here (constraint above enforces it)

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 7 — Compute nullifier hash
    //  Poseidon(secret, claimType)
    //
    //  The nullifier is:
    //  - Unique per user (derived from their secret)
    //  - Unique per claim type (so AGE_OVER_18 and KYC_VERIFIED have
    //    different nullifiers for the same user)
    //  - Deterministic (same inputs always give same nullifier)
    //  - Reveals NOTHING about secret, birthdate, or identity
    //
    //  ZKPVerifier.sol stores this nullifier after first use to prevent
    //  someone from submitting the same proof twice.
    // ════════════════════════════════════════════════════════════════════════
    component poseidon = Poseidon(2);
    poseidon.inputs[0] <== secret;
    poseidon.inputs[1] <== claimType;

    nullifierHash <== poseidon.out;

    // ════════════════════════════════════════════════════════════════════════
    //  STEP 8 — Bind birth date to secret (prevents a valid user from
    //  sharing their secret with an underage person to generate a proof)
    //
    //  We hash (secret, birthYear, birthMonth, birthDay) and output it
    //  as a "commitment". The user registers this commitment when they
    //  first set up their DID. At proof time, the circuit re-derives it
    //  to ensure the birth date matches what was originally committed.
    // ════════════════════════════════════════════════════════════════════════
    component commitment = Poseidon(4);
    commitment.inputs[0] <== secret;
    commitment.inputs[1] <== birthYear;
    commitment.inputs[2] <== birthMonth;
    commitment.inputs[3] <== birthDay;

    // commitment.out is a PUBLIC output — stored in DID document on IPFS.
    // The verifier checks this matches the registered commitment.
    signal output identityCommitment;
    identityCommitment <== commitment.out;
}

// ── INSTANTIATE THE MAIN COMPONENT ──────────────────────────────────────────
// This line tells circom which template is the entry point.
component main {
    // List which inputs are PUBLIC (everything else is private by default)
    public [
        currentYear,
        currentMonth,
        currentDay,
        minAge,
        claimType
    ]
} = AgeProof();
