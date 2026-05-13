 

 
 *
 * ─── HOW IT WORKS ────────────────────────────────────────────────────────────
 *  1. User runs circom circuit locally (AgeProof.circom) in the browser/backend.
 *  2. snarkjs generates a proof { pi_a, pi_b, pi_c } + publicSignals[].
 *  3. User calls verifyProof() on this contract with those values.
 *  4. Contract checks the Groth16 pairing equations on-chain.
 *  5. If valid → proof is recorded; user receives a verified badge / can proceed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
contract ZKPVerifier {

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────

    /// @dev Groth16 proof points (from snarkjs proof.json)
    struct Proof {
        uint256[2]    pi_a;   // G1 point A
        uint256[2][2] pi_b;   // G2 point B
        uint256[2]    pi_c;   // G1 point C
    }

    /// @dev Groth16 verification key (from snarkjs verification_key.json)
    struct VerifyingKey {
        uint256[2]    alpha;       // G1
        uint256[2][2] beta;        // G2
        uint256[2][2] gamma;       // G2
        uint256[2][2] delta;       // G2
        uint256[2][]  ic;          // G1 array — one per public input + 1
    }

    /// @dev Record of a verified proof stored on-chain
    struct VerifiedClaim {
        address prover;         // wallet that submitted the proof
        bytes32 claimType;      // keccak256 of claim name, e.g. keccak256("AGE_OVER_18")
        uint256 verifiedAt;     // block timestamp
        bool    isValid;        // can be revoked by owner
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;

    /// claimType => VerifyingKey
    mapping(bytes32 => VerifyingKey) private _verifyingKeys;

    /// prover address => claimType => VerifiedClaim
    mapping(address => mapping(bytes32 => VerifiedClaim)) public verifiedClaims;

    /// nullifier hash => used  (prevents proof replay attacks)
    mapping(bytes32 => bool) private _usedNullifiers;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event ProofVerified(
        address indexed prover,
        bytes32 indexed claimType,
        uint256 timestamp
    );

    event ProofRevoked(
        address indexed prover,
        bytes32 indexed claimType,
        uint256 timestamp
    );

    event VerifyingKeySet(
        bytes32 indexed claimType,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "ZKPVerifier: caller is not the owner");
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────
    //  ADMIN — SET VERIFYING KEY
    // ─────────────────────────────────────────────

    /**
     * @notice Store the Groth16 verifying key for a specific claim type.
     *         Called once after deployment using values from
     *         snarkjs's verification_key.json.
     *
     * @param claimType  keccak256 of the claim name, e.g. keccak256("AGE_OVER_18")
     * @param alpha      vk.alpha1 [x, y]
     * @param beta       vk.beta2  [[x1,x2],[y1,y2]]
     * @param gamma      vk.gamma2 [[x1,x2],[y1,y2]]
     * @param delta      vk.delta2 [[x1,x2],[y1,y2]]
     * @param ic         vk.IC     array of G1 points
     */
    function setVerifyingKey(
        bytes32          claimType,
        uint256[2]    calldata alpha,
        uint256[2][2] calldata beta,
        uint256[2][2] calldata gamma,
        uint256[2][2] calldata delta,
        uint256[2][]  calldata ic
    ) external onlyOwner {
        require(ic.length > 0, "ZKPVerifier: IC array cannot be empty");

        VerifyingKey storage vk = _verifyingKeys[claimType];
        vk.alpha = alpha;
        vk.beta  = beta;
        vk.gamma = gamma;
        vk.delta = delta;

        // copy dynamic array manually
        delete vk.ic;
        for (uint256 i = 0; i < ic.length; i++) {
            vk.ic.push(ic[i]);
        }

        emit VerifyingKeySet(claimType, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  CORE — VERIFY PROOF
    // ─────────────────────────────────────────────

    /**
     * @notice Submit a Groth16 ZKP proof for on-chain verification.
     *
     * @param claimType      keccak256("AGE_OVER_18") or other claim
     * @param pi_a           proof.pi_a from snarkjs
     * @param pi_b           proof.pi_b from snarkjs
     * @param pi_c           proof.pi_c from snarkjs
     * @param publicSignals  The public inputs array from snarkjs
     *                       For AgeProof: [1] if age>=18, plus nullifier hash
     * @param nullifierHash  Unique hash derived from the user's secret — prevents
     *                       the same proof from being replayed by someone else
     *
     * Emits {ProofVerified} on success.
     */
    function verifyProof(
        bytes32           claimType,
        uint256[2]    calldata pi_a,
        uint256[2][2] calldata pi_b,
        uint256[2]    calldata pi_c,
        uint256[]     calldata publicSignals,
        bytes32               nullifierHash
    ) external {
        // 1. Check verifying key exists for this claim
        require(
            _verifyingKeys[claimType].ic.length > 0,
            "ZKPVerifier: no verifying key set for this claim type"
        );

        // 2. Prevent replay attacks
        require(
            !_usedNullifiers[nullifierHash],
            "ZKPVerifier: proof already used (nullifier replay)"
        );

        // 3. Public signals length must match IC array (IC.length = signals + 1)
        require(
            publicSignals.length + 1 == _verifyingKeys[claimType].ic.length,
            "ZKPVerifier: wrong number of public signals"
        );

        // 4. Run Groth16 pairing check
        bool valid = _groth16Verify(
            claimType,
            Proof({ pi_a: pi_a, pi_b: pi_b, pi_c: pi_c }),
            publicSignals
        );
        require(valid, "ZKPVerifier: invalid proof");

        // 5. Mark nullifier as used
        _usedNullifiers[nullifierHash] = true;

        // 6. Record the verified claim on-chain
        verifiedClaims[msg.sender][claimType] = VerifiedClaim({
            prover:     msg.sender,
            claimType:  claimType,
            verifiedAt: block.timestamp,
            isValid:    true
        });

        emit ProofVerified(msg.sender, claimType, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  READ FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Check if an address has a valid verified claim of a given type.
     * @param prover     The wallet address to check.
     * @param claimType  keccak256 of the claim name.
     * @return           True if the address has a valid, non-revoked proof.
     */
    function hasClaim(address prover, bytes32 claimType)
        external
        view
        returns (bool)
    {
        return verifiedClaims[prover][claimType].isValid;
    }

    /**
     * @notice Get full details of a verified claim.
     * @param prover     The wallet address.
     * @param claimType  keccak256 of the claim name.
     */
    function getClaim(address prover, bytes32 claimType)
        external
        view
        returns (VerifiedClaim memory)
    {
        return verifiedClaims[prover][claimType];
    }

    /**
     * @notice Check if a nullifier has already been used.
     *         Frontend can call this before submitting to avoid wasted gas.
     */
    function isNullifierUsed(bytes32 nullifierHash)
        external
        view
        returns (bool)
    {
        return _usedNullifiers[nullifierHash];
    }

    // ─────────────────────────────────────────────
    //  ADMIN — REVOKE
    // ─────────────────────────────────────────────

    /**
     * @notice Revoke a previously verified claim (e.g. if credential is expired).
     *         Only the contract owner can revoke.
     * @param prover     The wallet address whose claim to revoke.
     * @param claimType  The claim type to revoke.
     */
    function revokeClaim(address prover, bytes32 claimType)
        external
        onlyOwner
    {
        require(
            verifiedClaims[prover][claimType].isValid,
            "ZKPVerifier: claim is not active"
        );
        verifiedClaims[prover][claimType].isValid = false;
        emit ProofRevoked(prover, claimType, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  INTERNAL — GROTH16 PAIRING CHECK
    // ─────────────────────────────────────────────

    /**
     * @dev Performs the Groth16 verification equation:
     *
     *   e(pi_a, pi_b) == e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta)
     *
     *   where vk_x = IC[0] + sum( publicSignals[i] * IC[i+1] )
     *
     *   Uses the EVM precompiles:
     *   - 0x06 : BN256 addition
     *   - 0x07 : BN256 scalar multiplication
     *   - 0x08 : BN256 pairing check
     */
    function _groth16Verify(
        bytes32       claimType,
        Proof memory  proof,
        uint256[]     calldata publicSignals
    ) internal view returns (bool) {
        VerifyingKey storage vk = _verifyingKeys[claimType];

        // ── Step 1: compute vk_x = IC[0] + Σ(signal[i] * IC[i+1]) ──────────
        uint256[2] memory vk_x;
        vk_x[0] = vk.ic[0][0];
        vk_x[1] = vk.ic[0][1];

        for (uint256 i = 0; i < publicSignals.length; i++) {
            require(
                publicSignals[i] < _SNARK_SCALAR_FIELD,
                "ZKPVerifier: public signal out of range"
            );
            // scalar mul: IC[i+1] * signal[i]
            uint256[2] memory mulResult = _scalarMul(vk.ic[i + 1], publicSignals[i]);
            // add to vk_x
            vk_x = _pointAdd(vk_x, mulResult);
        }

        // ── Step 2: run 4-pairing check via precompile 0x08 ─────────────────
        // Input layout for pairing precompile:
        // [ A_x, A_y, B_x1, B_x2, B_y1, B_y2 ] repeated for each pair
        // We check: e(-pi_a, pi_b) * e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta) == 1

        uint256[24] memory input;
 
