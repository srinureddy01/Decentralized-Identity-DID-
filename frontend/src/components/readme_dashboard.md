Design direction
The aesthetic goes editorial dark — DM Serif Display (italic serif) paired with DM Mono, a floating particle canvas for depth, and a layout that feels like a Bloomberg terminal crossed with an identity vault. Stat pills, hexagonal avatars, and colour-coded claim cards make scanning instant.

4 tabs and what each shows
Identity tab — Full DID document table: DID string, IPFS CID with live link, registered/updated timestamps, active status, network, and controller address. Plus an explainer card on the ``did:ethr`` method.
Claims tab — One card per claim type (Age Over 18, Identity Verified). Each card shows verified/unverified status, description, and date verified — or a "Prove Now →" button that fires ``onGoProve`` if not yet verified. A ZKP explainer sits below.
Credentials tab — Soulbound NFT badge cards showing token ID, claim category, wallet address, and a non-transferable lock badge. Empty state prompts to prove identity if no badges held yet.
Activity tab — Chronological event feed pulled from on-chain data (DID registration timestamp, claim verification timestamps), displayed as a timeline with connecting lines.

Key technical details
``fetchData()`` — single async function that calls all 3 contracts in sequence: ``DIDRegistry.resolveDID()``, then ``ZKPVerifier.getClaim()`` for each claim type, then ``CredentialNFT.getTokenByClaim()``. Runs on mount and on manual refresh.
Particle canvas — 40 floating particles drawn on a <canvas> using ``requestAnimationFrame``. Positioned ``fixed`` behind all content, zero pointer events.
Deterministic hex avatar — generates a radial gradient SVG hexagon from the first 2 hex chars of the wallet address. No image fetch needed.
Stat pills — live counts of DIDs (0 or 1), verified claims, and NFT badges held. Turn green when non-zero.
