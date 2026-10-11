import { useState } from "react";
import { api } from "../lib/api";
import type { Capture } from "../lib/db";
import { capture, CaptureView, Pill } from "./common";

const COLLECTIONS = ["daily_sleep", "sleep", "daily_readiness", "daily_activity"] as const;

function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function OuraPanel({ status }: { status: Record<string, unknown> | null }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [captures, setCaptures] = useState<Capture[]>([]);
  const oura = (status?.["oura"] ?? null) as { connected?: boolean; reconnect_required?: boolean; configured?: boolean } | null;
  const callback = new URLSearchParams(location.hash.split("?")[1] ?? "");

  const connect = async () => {
    const res = await api("oura/start", { method: "POST" });
    const url = (res.body as { url?: string } | null)?.url;
    if (res.ok && url) location.href = url;
    else setMsg(`Could not start: ${JSON.stringify(res.body)}`);
  };

  const fetchAll = async () => {
    setBusy(true);
    // Oura treats end_date as exclusive on several endpoints, so end is tomorrow (brief §4.2).
    const qs = `start_date=${localDate(-7)}&end_date=${localDate(1)}`;
    const out: Capture[] = [];
    // One at a time: refresh tokens are single-use, so parallel calls could race a refresh.
    for (const c of COLLECTIONS) out.push(await capture(`oura:${c}`, `oura/data/${c}?${qs}`));
    setCaptures(out);
    setBusy(false);
  };

  return (
    <section className="card">
      <h2>3. Oura</h2>
      {callback.get("oura") === "connected" && <p><Pill tone="good">Oura connected</Pill></p>}
      {callback.get("oura") === "error" && (
        <p>
          <Pill tone="bad">Oura connect failed: {callback.get("reason")}</Pill>
        </p>
      )}
      <p className="muted small">
        Status: {oura ? (oura.connected ? "connected" : "not connected") : "unknown (check the Worker first)"}
        {oura?.reconnect_required ? " · reconnect required" : ""}
        {oura && !oura.configured ? " · OURA_CLIENT_ID/SECRET not set" : ""}
      </p>
      <div className="row">
        <button onClick={connect}>Connect Oura</button>
        <button className="primary" disabled={busy} onClick={fetchAll}>
          {busy ? "Fetching…" : "Fetch last 7 days (4 collections)"}
        </button>
        <button
          onClick={async () => {
            await api("oura/disconnect", { method: "POST" });
            setMsg("Disconnected. Tokens deleted.");
          }}
        >
          Disconnect
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
      {captures.map((c) => (
        <CaptureView key={c.id} c={c} />
      ))}
    </section>
  );
}
