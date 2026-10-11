import { useEffect, useState } from "react";
import { api, getToken, setToken } from "../lib/api";
import { Pill } from "./common";

export type Status = Record<string, unknown> | null;

export function ConnectionPanel({ onStatus }: { onStatus: (s: Status) => void }) {
  const [token, setTokenInput] = useState(getToken());
  const [result, setResult] = useState<{ status: number; body: unknown } | null>(null);

  const check = async () => {
    const res = await api("status");
    setResult(res);
    onStatus(res.ok ? (res.body as Record<string, unknown>) : null);
  };

  useEffect(() => {
    if (getToken()) void check();
    // Run once on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card">
      <h2>1. Worker connection</h2>
      <p className="muted small">Paste the APP_TOKEN you set as a Worker secret. It is kept on this device only.</p>
      <div className="row">
        <input
          type="password"
          autoComplete="off"
          placeholder="APP_TOKEN"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            setToken(token);
            void check();
          }}
        >
          Save and check /api/status
        </button>
      </div>
      {result && (
        <>
          <p>
            {result.status === 200 ? (
              <Pill tone="good">Connected</Pill>
            ) : result.status === 401 ? (
              <Pill tone="bad">401: token wrong, or APP_TOKEN secret not set (min 32 chars)</Pill>
            ) : (
              <Pill tone="bad">Status {result.status || "network error"}</Pill>
            )}
          </p>
          <pre>{JSON.stringify(result.body, null, 2)}</pre>
        </>
      )}
    </section>
  );
}
