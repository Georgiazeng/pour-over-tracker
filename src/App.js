import { useState } from "react";
import ImportView from "./ImportView";
import LegacyTracker from "./LegacyTracker";

// Timemore import is the main screen; the old manual tracker stays reachable.
export default function App() {
  const [legacy, setLegacy] = useState(false);
  if (legacy) {
    return (
      <>
        <button
          onClick={() => setLegacy(false)}
          style={{ position: "fixed", top: 10, left: 10, zIndex: 50, fontFamily: "'DM Mono',monospace", fontSize: 10,
            letterSpacing: ".08em", textTransform: "uppercase", padding: "6px 10px", borderRadius: 8,
            border: "1.5px solid #d4a574", background: "#fffdf9", color: "#2c1a0e", cursor: "pointer" }}
        >
          ← Import
        </button>
        <LegacyTracker />
      </>
    );
  }
  return <ImportView onOpenLegacy={() => setLegacy(true)} />;
}
