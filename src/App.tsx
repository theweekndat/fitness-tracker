import { lazy, Suspense, useEffect, useState } from "react";
import { copyText } from "./lib/download";

// The barcode decoder is large; keep it out of the app shell.
const Spike = lazy(() => import("./spike/Spike").then((m) => ({ default: m.Spike })));

function currentRoute(): string {
  return (location.hash.replace(/^#/, "").split("?")[0] || "/") as string;
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route === "/spike")
    return (
      <Suspense fallback={<main className="page muted">Loading…</main>}>
        <Spike />
      </Suspense>
    );
  return (
    <main className="page">
      <h1>Hub</h1>
      <p className="muted">Phase 0: verification spike. Feature screens arrive in Phase 1.</p>
      <a className="button primary" href="#/spike">
        Open the Phase 0 checks
      </a>
      <TokenGenerator />
    </main>
  );
}

/** Makes a random APP_TOKEN on-device, so setup needs no computer. */
function TokenGenerator() {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <section className="card">
      <h2>Need an APP_TOKEN?</h2>
      <p className="muted small">
        Generates 64 random hex characters on this device. Paste it into the Worker secret APP_TOKEN, then into the
        Phase 0 page. Nothing is sent anywhere.
      </p>
      <div className="row">
        <button
          onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setToken(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
            setCopied(false);
          }}
        >
          Generate token
        </button>
        {token && (
          <button
            onClick={async () => {
              setCopied(await copyText(token));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {token && <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{token}</pre>}
    </section>
  );
}
