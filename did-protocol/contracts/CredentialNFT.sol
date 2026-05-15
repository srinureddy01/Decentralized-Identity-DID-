// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CredentialNFT
 * @notice Soulbound NFT (non-transferable) minted to a wallet address once
 *         their Zero-Knowledge Proof is verified via ZKPVerifier.sol.
 *
 *         "Soulbound" means the NFT is permanently locked to the wallet
 *         that received it — it cannot be sold, transferred, or moved.
 *         This makes it a trustworthy on-chain badge of verified identity.
 *
 * @dev    Implements ERC-721 storage & metadata patterns but BLOCKS all
 *         transfer functions (transferFrom, safeTransferFrom, approve).
 *         Integrates with ZKPVerifier to gate minting behind a valid proof.
 *
 *         Folder: did-protocol/contracts/CredentialNFT.sol
 *
 * ─── MINT FLOW ───────────────────────────────────────────────────────────────
 *  1. User submits ZKP proof → ZKPVerifier.verifyProof() → claim recorded.
 *  2. User calls CredentialNFT.mintCredential(claimType).
 *  3. Contract checks ZKPVerifier.hasClaim(msg.sender, claimType) == true.
 *  4. NFT is minted with metadata pointing to an IPFS badge image.
 *  5. Token is soulbound — transfer attempts revert forever.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Minimal ERC-721 interface we implement manually (no OpenZeppelin dependency
// needed — keeps the contract self-contained and easy to audit).
interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata data
    ) external returns (bytes4);
}

contract CredentialNFT {

    // ─────────────────────────────────────────────
    //  ERC-721 METADATA
    // ─────────────────────────────────────────────

    string public name   = "DID Credential";
    string public symbol = "DIDCRED";

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────

    struct Credential {
        address holder;       // wallet address that owns this credential
        bytes32 claimType;    // e.g. keccak256("AGE_OVER_18")
        string  claimLabel;   // human-readable label e.g. "Age Over 18"
        string  metadataURI;  // IPFS URI of the credential badge JSON
        uint256 issuedAt;     // block timestamp of minting
        bool    isRevoked;    // true if credential has been revoked
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    address public owner;
    address public zkpVerifier;   // address of ZKPVerifier.sol

    uint256 private _nextTokenId; // auto-incrementing token ID counter

    // tokenId => Credential
    mapping(uint256 => Credential) private _credentials;

    // tokenId => owner address (ERC-721 ownership)
    mapping(uint256 => address) private _owners;

    // owner address => token count
    mapping(address => uint256) private _balances;

    // address => claimType => tokenId (prevent duplicate minting per claim)
    mapping(address => mapping(bytes32 => uint256)) private _claimToToken;

    // tokenId => approved address (always zero — soulbound blocks approvals)
    mapping(uint256 => address) private _tokenApprovals;

    // Claim type => IPFS metadata URI template set by owner
    mapping(bytes32 => string) public claimMetadataURI;

    // Claim type => human-readable label
    mapping(bytes32 => string) public claimLabels;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    // Standard ERC-721 events
    event Transfer(
        address indexed from,
        address indexed to,
        uint256 indexed tokenId
    );
    event Approval(
        address indexed owner,
        address indexed approved,
        uint256 indexed tokenId
    );
    event ApprovalForAll(
        address indexed owner,
        address indexed operator,
        bool approved
    );

    // Custom events
    event CredentialMinted(
        address indexed holder,
        uint256 indexed tokenId,
        bytes32 indexed claimType,
        string  claimLabel,
        uint256 timestamp
    );

    event CredentialRevoked(
        address indexed holder,
        uint256 indexed tokenId,
        bytes32 indexed claimType,
        uint256 timestamp
    );

    event ClaimTypeRegistered(
        bytes32 indexed claimType,
        string  label,
        string  metadataURI
    );

    event ZKPVerifierUpdated(address newVerifier);

    // ─────────────────────────────────────────────
    //  ERRORS  (gas-efficient revert messages)
    // ─────────────────────────────────────────────

    error Soulbound();                  // transfer attempted on soulbound token
    error NotOwner();                   // caller is not contract owner
    error ClaimNotVerified();           // ZKPVerifier says no valid claim
    error AlreadyMinted();              // wallet already holds this credential
    error TokenDoesNotExist();          // tokenId not minted yet
    error CredentialRevoked();          // credential has been revoked
    error ClaimTypeNotRegistered();     // claimType has no metadata set
    error ZeroAddress();                // address(0) passed where not allowed

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier tokenExists(uint256 tokenId) {
        if (_owners[tokenId] == address(0)) revert TokenDoesNotExist();
        _;
    }

    // ─────────────────────────────────────────────
    //  CONSTRUCTOR
    // ─────────────────────────────────────────────

    /**
     * @param _zkpVerifier  Address of the deployed ZKPVerifier contract.
     */
    constructor(address _zkpVerifier) {
        if (_zkpVerifier == address(0)) revert ZeroAddress();
        owner       = msg.sender;
        zkpVerifier = _zkpVerifier;
        _nextTokenId = 1; // start token IDs at 1, not 0
    }

    // ─────────────────────────────────────────────
    //  ADMIN — SETUP CLAIM TYPES
    // ─────────────────────────────────────────────

    /**
     * @notice Register a claim type with a human-readable label and IPFS badge URI.
     *         Must be called before anyone can mint a credential of this type.
     *
     * @param claimType    keccak256("AGE_OVER_18") or any claim hash
     * @param label        "Age Over 18" — shown in wallets / explorers
     * @param metadataURI  IPFS URI of the ERC-721 metadata JSON for this badge
     *
     * @dev Metadata JSON should follow the OpenSea standard:
     *      {
     *        "name": "Age Over 18 — DID Credential",
     *        "description": "Zero-knowledge verified age credential",
     *        "image": "ipfs://Qm.../age-badge.png",
     *        "attributes": [{ "trait_type": "Claim", "value": "AGE_OVER_18" }]
     *      }
     */
    function registerClaimType(
        bytes32       claimType,
        string calldata label,
        string calldata metadataURI
    ) external onlyOwner {
        require(bytes(label).length > 0,       "CredentialNFT: label empty");
        require(bytes(metadataURI).length > 0, "CredentialNFT: URI empty");

        claimLabels[claimType]      = label;
        claimMetadataURI[claimType] = metadataURI;

        emit ClaimTypeRegistered(claimType, label, metadataURI);
    }

    /**
     * @notice Update the ZKPVerifier contract address (e.g. after a re-deploy).
     */
    function setZKPVerifier(address _zkpVerifier) external onlyOwner {
        if (_zkpVerifier == address(0)) revert ZeroAddress();
        zkpVerifier = _zkpVerifier;
        emit ZKPVerifierUpdated(_zkpVerifier);
    }

    // ─────────────────────────────────────────────
    //  CORE — MINT CREDENTIAL
    // ─────────────────────────────────────────────

    /**
     * @notice Mint a soulbound credential NFT to the caller's wallet.
     *         Caller must have a valid verified claim in ZKPVerifier first.
     *
     * @param claimType  keccak256 of the claim, e.g. keccak256("AGE_OVER_18").
     *                   Must match a registered claim type AND a verified proof.
     *
     * Emits {Transfer} (ERC-721 standard) and {CredentialMinted}.
     */
    function mintCredential(bytes32 claimType) external {
        // 1. Claim type must be registered by owner
        if (bytes(claimLabels[claimType]).length == 0) {
            revert ClaimTypeNotRegistered();
        }

        // 2. ZKPVerifier must confirm caller has a valid proof for this claim
        if (!_zkpHasClaim(msg.sender, claimType)) {
            revert ClaimNotVerified();
        }

        // 3. Wallet must not already hold a credential for this claim type
        if (_claimToToken[msg.sender][claimType] != 0) {
            revert AlreadyMinted();
        }

        // 4. Mint the token
        uint256 tokenId = _nextTokenId++;

        _owners[tokenId]   = msg.sender;
        _balances[msg.sender]++;

        _credentials[tokenId] = Credential({
            holder:      msg.sender,
            claimType:   claimType,
            claimLabel:  claimLabels[claimType],
            metadataURI: claimMetadataURI[claimType],
            issuedAt:    block.timestamp,
            isRevoked:   false
        });

        _claimToToken[msg.sender][claimType] = tokenId;

        // ERC-721: mint = transfer from zero address
        emit Transfer(address(0), msg.sender, tokenId);

        emit CredentialMinted(
            msg.sender,
            tokenId,
            claimType,
            claimLabels[claimType],
            block.timestamp
        );
    }

    // ─────────────────────────────────────────────
    //  ADMIN — REVOKE CREDENTIAL
    // ─────────────────────────────────────────────

    /**
     * @notice Revoke a credential. The NFT stays in the wallet but is marked
     *         invalid. Useful when a real-world credential expires or is found
     *         fraudulent.
     *
     * @param tokenId  The token ID to revoke.
     */
    function revokeCredential(uint256 tokenId)
        external
        onlyOwner
        tokenExists(tokenId)
    {
        Credential storage cred = _credentials[tokenId];
        require(!cred.isRevoked, "CredentialNFT: already revoked");

        cred.isRevoked = true;

        emit CredentialRevoked(
            cred.holder,
            tokenId,
            cred.claimType,
            block.timestamp
        );
    }

    // ─────────────────────────────────────────────
    //  READ FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Get full credential details for a token.
     */
    function getCredential(uint256 tokenId)
        external
        view
        tokenExists(tokenId)
        returns (Credential memory)
    {
        return _credentials[tokenId];
    }

    /**
     * @notice Get the token ID for a specific wallet + claim type combo.
     * @return tokenId, or 0 if none minted.
     */
    function getTokenByClaim(address holder, bytes32 claimType)
        external
        view
        returns (uint256)
    {
        return _claimToToken[holder][claimType];
    }

    /**
     * @notice Check if a wallet holds a valid (non-revoked) credential for a claim.
     */
    function hasValidCredential(address holder, bytes32 claimType)
        external
        view
        returns (bool)
    {
        uint256 tokenId = _claimToToken[holder][claimType];
        if (tokenId == 0) return false;
        return !_credentials[tokenId].isRevoked;
    }

    /**
     * @notice ERC-721 tokenURI — returns IPFS metadata URI for the badge.
     */
    function tokenURI(uint256 tokenId)
        external
        view
        tokenExists(tokenId)
        returns (string memory)
    {
        return _credentials[tokenId].metadataURI;
    }

    /**
     * @notice ERC-721 ownerOf.
     */
    function ownerOf(uint256 tokenId)
        external
        view
        tokenExists(tokenId)
        returns (address)
    {
        return _owners[tokenId];
    }

    /**
     * @notice ERC-721 balanceOf.
     */
    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balances[holder];
    }

    /**
     * @notice Total number of credentials ever minted.
     */
    function totalSupply() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    /**
     * @notice ERC-165 interface support.
     */
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f || // ERC-721Metadata
            interfaceId == 0x01ffc9a7;   // ERC-165
    }

    // ─────────────────────────────────────────────
    //  SOULBOUND — BLOCK ALL TRANSFERS
    // ─────────────────────────────────────────────

    /**
     * @dev All transfer and approval functions revert with {Soulbound}.
     *      This makes the credential permanently locked to the minting wallet.
     *      Complies with EIP-5192 (Minimal Soulbound NFT).
     */
    function transferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert Soulbound();
    }

    function approve(address, uint256) external pure {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) external pure {
        revert Soulbound();
    }

    function getApproved(uint256) external pure returns (address) {
        return address(0); // no approvals ever
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false; // no operator approvals ever
    }

    // ─────────────────────────────────────────────
    //  INTERNAL HELPERS
    // ─────────────────────────────────────────────

    /**
     * @dev Calls ZKPVerifier.hasClaim() via low-level call so this contract
     *      doesn't need to import the ZKPVerifier interface — keeping it
     *      deployable independently.
     *
     *      Function selector: bytes4(keccak256("hasClaim(address,bytes32)"))
     */
    function _zkpHasClaim(address prover, bytes32 claimType)
        internal
        view
        returns (bool)
    {
        (bool success, bytes memory result) = zkpVerifier.staticcall(
            abi.encodeWithSelector(
                bytes4(keccak256("hasClaim(address,bytes32)")),
                prover,
                claimType
            )
        );
        if (!success || result.length == 0) return false;
        return abi.decode(result, (bool));
    }
}
