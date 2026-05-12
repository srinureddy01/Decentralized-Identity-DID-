// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DIDRegistry
 * @notice Decentralized Identity Registry — stores and manages DIDs on-chain.
 *         Each wallet address owns exactly one DID.
 *         The DID document itself is stored on IPFS; only the CID hash lives here.
 * @dev    Part of the did-protocol project.
 *         Folder: did-protocol/contracts/DIDRegistry.sol
 */
contract DIDRegistry {

    // ─────────────────────────────────────────────
    //  STRUCTS
    // ─────────────────────────────────────────────

    struct DIDDocument {
        string  did;           // e.g. "did:ethr:0xAbCd..."
        string  ipfsCID;       // IPFS CID of the encrypted DID document
        uint256 createdAt;     // block timestamp when DID was registered
        uint256 updatedAt;     // block timestamp of last update
        bool    isActive;      // false if DID has been deactivated
    }

    // ─────────────────────────────────────────────
    //  STATE VARIABLES
    // ─────────────────────────────────────────────

    // owner address => DID document
    mapping(address => DIDDocument) private _didDocuments;

    // DID string => owner address (for reverse lookup)
    mapping(string => address) private _didToOwner;

    // Total number of registered DIDs
    uint256 public totalDIDs;

    // ─────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────

    event DIDRegistered(
        address indexed owner,
        string  did,
        string  ipfsCID,
        uint256 timestamp
    );

    event DIDUpdated(
        address indexed owner,
        string  did,
        string  newIpfsCID,
        uint256 timestamp
    );

    event DIDDeactivated(
        address indexed owner,
        string  did,
        uint256 timestamp
    );

    // ─────────────────────────────────────────────
    //  MODIFIERS
    // ─────────────────────────────────────────────

    /// @dev Reverts if caller has not registered a DID yet.
    modifier hasDID() {
        require(
            bytes(_didDocuments[msg.sender].did).length > 0,
            "DIDRegistry: no DID registered for this address"
        );
        _;
    }

    /// @dev Reverts if caller's DID is deactivated.
    modifier isActive() {
        require(
            _didDocuments[msg.sender].isActive,
            "DIDRegistry: DID has been deactivated"
        );
        _;
    }

    // ─────────────────────────────────────────────
    //  WRITE FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Register a new DID for the caller's wallet address.
     * @param did      The DID string, e.g. "did:ethr:0xAbCd..."
     * @param ipfsCID  The IPFS CID of the caller's encrypted DID document.
     *
     * Requirements:
     * - Caller must not already have a registered DID.
     * - `did` and `ipfsCID` must not be empty strings.
     * - The DID string must not already be claimed by another address.
     */
    function registerDID(string calldata did, string calldata ipfsCID) external {
        require(
            bytes(_didDocuments[msg.sender].did).length == 0,
            "DIDRegistry: address already has a DID"
        );
        require(bytes(did).length > 0,      "DIDRegistry: DID cannot be empty");
        require(bytes(ipfsCID).length > 0,  "DIDRegistry: IPFS CID cannot be empty");
        require(
            _didToOwner[did] == address(0),
            "DIDRegistry: DID already claimed"
        );

        _didDocuments[msg.sender] = DIDDocument({
            did:       did,
            ipfsCID:   ipfsCID,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            isActive:  true
        });

        _didToOwner[did] = msg.sender;
        totalDIDs++;

        emit DIDRegistered(msg.sender, did, ipfsCID, block.timestamp);
    }

    /**
     * @notice Update the IPFS CID of your DID document.
     *         Use this when you update keys or add new credentials to your
     *         DID document on IPFS and need to point the registry at the new CID.
     * @param newIpfsCID  The new IPFS CID.
     */
    function updateDID(string calldata newIpfsCID) external hasDID isActive {
        require(bytes(newIpfsCID).length > 0, "DIDRegistry: IPFS CID cannot be empty");

        _didDocuments[msg.sender].ipfsCID   = newIpfsCID;
        _didDocuments[msg.sender].updatedAt = block.timestamp;

        emit DIDUpdated(
            msg.sender,
            _didDocuments[msg.sender].did,
            newIpfsCID,
            block.timestamp
        );
    }

    /**
     * @notice Permanently deactivate your DID.
     *         This cannot be undone — the DID string will remain reserved
     *         so it cannot be re-registered by anyone.
     */
    function deactivateDID() external hasDID isActive {
        string memory did = _didDocuments[msg.sender].did;

        _didDocuments[msg.sender].isActive  = false;
        _didDocuments[msg.sender].updatedAt = block.timestamp;

        emit DIDDeactivated(msg.sender, did, block.timestamp);
    }

    // ─────────────────────────────────────────────
    //  READ FUNCTIONS
    // ─────────────────────────────────────────────

    /**
     * @notice Resolve a wallet address to its DID document.
     * @param owner  The wallet address to look up.
     * @return       The DIDDocument struct for that address.
     */
    function resolveDID(address owner)
        external
        view
        returns (DIDDocument memory)
    {
        require(
            bytes(_didDocuments[owner].did).length > 0,
            "DIDRegistry: no DID found for this address"
        );
        return _didDocuments[owner];
    }

    /**
     * @notice Reverse-resolve a DID string to its owner address.
     * @param did  The DID string, e.g. "did:ethr:0xAbCd..."
     * @return     The wallet address that owns this DID.
     */
    function getOwnerByDID(string calldata did)
        external
        view
        returns (address)
    {
        address owner = _didToOwner[did];
        require(owner != address(0), "DIDRegistry: DID not found");
        return owner;
    }

    /**
     * @notice Check whether a wallet address has an active DID.
     * @param owner  The wallet address to check.
     * @return       True if the address has an active DID, false otherwise.
     */
    function hasActiveDID(address owner) external view returns (bool) {
        DIDDocument storage doc = _didDocuments[owner];
        return (bytes(doc.did).length > 0 && doc.isActive);
    }

    /**
     * @notice Get just the IPFS CID for a given address (cheaper call for the frontend).
     * @param owner  The wallet address.
     * @return       The IPFS CID string pointing to the DID document.
     */
    function getIPFSCID(address owner) external view returns (string memory) {
        require(
            bytes(_didDocuments[owner].did).length > 0,
            "DIDRegistry: no DID found for this address"
        );
        return _didDocuments[owner].ipfsCID;
    }
}
