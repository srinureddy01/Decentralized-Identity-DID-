/**
 * main.jsx
 * ─────────────────────────────────────────────────────────────────────────
 * Folder: did-protocol/frontend/src/main.jsx
 *
 * Vite entry point. Mounts the React app into the DOM.
 *
 * Handles:
 *   • React 18 createRoot mounting
 *   • Global CSS reset + base styles
 *   • Error boundary wrapping the entire app
 *   • Strict mode in development
 *   • Web Vitals reporting (optional)
 * ─────────────────────────────────────────────────────────────────────────
 */

import { StrictMode, Component } from "react";
import { createRoot }            from "react-dom/client";
import App                       from "./App";

// ── Global base styles ────────────────────────────────────────────────────────
// Injected before the app renders so there's no flash of unstyled content.
const globalStyles = `
  *, *::before, *::after {
    box-sizing: border-box;
    margin:     0;
    padding:    0;
  }

  html {
    font-size:               16px;
    -webkit-text-size-adjust: 100%;
    scroll-behavior:          smooth;
  }

  body {
    background:          #060609;
    color:               #eeeef5;
    font-family:         'Geist Mono', monospace;
    line-height:         1.5;
    min-height:          100vh;
    overflow-x:          hidden;
    -webkit-font-smoothing:  antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  #root {
    min-height: 100vh;
    isolation:  isolate;
  }

  /* Native scrollbar styling */
  ::-webkit-scrollbar       { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 99px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

  /* Selection colour */
  ::selection {
    background: rgba(198,241,53,0.25);
    color:      #eeeef5;
  }

  /* Remove default button/input appearance */
  button, input, select, textarea {
    font-family: inherit;
    font-size:   inherit;
  }

  /* Anchor base */
  a { color: inherit; }

  /* Focus ring — accessible but not intrusive */
  :focus-visible {
    outline:        2px solid rgba(198,241,53,0.6);
    outline-offset: 2px;
    border-radius:  4px;
  }
  :focus:not(:focus-visible) { outline: none; }
`;

// Inject global styles into <head>
const styleTag = document.createElement("style");
styleTag.id        = "did-protocol-global";
styleTag.textContent = globalStyles;
document.head.prepend(styleTag);

// ── Error Boundary ────────────────────────────────────────────────────────────
// Catches any unhandled render errors and shows a fallback UI
// instead of a blank white screen.
class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("[DID Protocol] Uncaught render error:", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const err = this.state.error;

    return (
      <div style={{
        minHeight:      "100vh",
        display:        "flex",
        flexDirection:  "column",
        alignItems:     "center",
        justifyContent: "center",
        padding:        "40px 24px",
        fontFamily:     "'Geist Mono', monospace",
        background:     "#060609",
        color:          "#eeeef5",
        textAlign:      "center",
        gap:            "20px",
      }}>
        {/* Logo mark */}
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none"
          style={{ color: "#ff5070" }}>
          <polygon points="16,2 30,9 30,23 16,30 2,23 2,9"
            stroke="currentColor" strokeWidth="1.5"/>
          <text x="16" y="21" textAnchor="middle"
            fontSize="14" fill="currentColor" fontFamily="monospace">!</text>
        </svg>

        <div>
          <p style={{ fontSize: "11px", letterSpacing: "0.2em",
            color: "#ff5070", marginBottom: "10px", textTransform: "uppercase" }}>
            Application Error
          </p>
          <h1 style={{ fontSize: "22px", fontWeight: "700",
            marginBottom: "10px", letterSpacing: "-0.01em" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "13px", color: "#7070a0",
            maxWidth: "400px", lineHeight: "1.6" }}>
            {err?.message || "An unexpected error occurred."}
          </p>
        </div>

        {/* Error details (dev only) */}
        {import.meta.env.DEV && err?.stack && (
          <pre style={{
            background:   "#0d0d12",
            border:       "1px solid rgba(255,255,255,0.07)",
            borderRadius: "8px",
            padding:      "14px 16px",
            fontSize:     "10px",
            color:        "#7070a0",
            textAlign:    "left",
            maxWidth:     "600px",
            width:        "100%",
            overflow:     "auto",
            maxHeight:    "200px",
            lineHeight:   "1.6",
          }}>
            {err.stack}
          </pre>
        )}

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              background:   "transparent",
              border:       "1px solid rgba(255,255,255,0.14)",
              borderRadius: "8px",
              color:        "#eeeef5",
              fontFamily:   "inherit",
              fontSize:     "12px",
              padding:      "10px 20px",
              cursor:       "pointer",
              letterSpacing: "0.06em",
            }}>
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background:   "#c6f135",
              border:       "none",
              borderRadius: "8px",
              color:        "#060609",
              fontFamily:   "inherit",
              fontSize:     "12px",
              fontWeight:   "700",
              padding:      "10px 20px",
              cursor:       "pointer",
              letterSpacing: "0.06em",
            }}>
            Reload Page
          </button>
        </div>

        <p style={{ fontSize: "11px", color: "#3c3c50" }}>
          DID Protocol · Sepolia Testnet
        </p>
      </div>
    );
  }
}

// ── Mount ─────────────────────────────────────────────────────────────────────
const container = document.getElementById("root");

if (!container) {
  throw new Error(
    '[DID Protocol] Could not find #root element. ' +
    'Make sure index.html contains <div id="root"></div>.'
  );
}

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
