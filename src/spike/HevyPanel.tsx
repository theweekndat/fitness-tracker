import { useState } from "react";
import type { Capture } from "../lib/db";
import { capture, CaptureView } from "./common";

// Page sizes are undocumented here (brief §4.1): probe from large to small and record the largest accepted.
const PAGE_SIZE_PROBE = [100, 50, 20, 10, 5];

async function probePageSize(source: string, path: string, extra = ""): Promise<{ c: Capture; max: number | null }> {
  let last: Capture | null = null;
  for (const size of PAGE_SIZE_PROBE) {
    last = await capture(source, `hevy/${path}?page=1&pageSize=${size}${extra}`);
    if (last.status === 200) return { c: last, max: size };
    if (last.status !== 400) break;
  }
  return { c: last!, max: null };
}

export function HevyPanel({ onDone }: { onDone: (notes: Record<string, string>) => void }) {
  const [busy, setBusy] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const run = async () => {
    setBusy(true);
    const out: Capture[] = [];
    const n: Record<string, string> = {};
    // Sequential on purpose: rate limits are unknown.
    const w = await probePageSize("hevy:workouts", "workouts");
    out.push(w.c);
    n["workouts max pageSize"] = String(w.max ?? "none accepted");

    out.push(await capture("hevy:workouts/count", "hevy/workouts/count"));

    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const ev = await probePageSize("hevy:workouts/events", "workouts/events", `&since=${encodeURIComponent(since)}`);
    out.push(ev.c);
    n["events max pageSize"] = String(ev.max ?? "none accepted");

    const t = await probePageSize("hevy:exercise_templates", "exercise_templates");
    out.push(t.c);
    n["exercise_templates max pageSize"] = String(t.max ?? "none accepted");

    const r = await probePageSize("hevy:routines", "routines");
    out.push(r.c);
    n["routines max pageSize"] = String(r.max ?? "none accepted");

    const f = await probePageSize("hevy:routine_folders", "routine_folders");
    out.push(f.c);
    n["routine_folders max pageSize"] = String(f.max ?? "none accepted");

    // One workout by id, if the list returned any.
    const list = w.c.body as { workouts?: { id?: string }[] } | null;
    const firstId = list?.workouts?.[0]?.id;
    if (firstId) out.push(await capture("hevy:workouts/{id}", `hevy/workouts/${encodeURIComponent(firstId)}`));

    setCaptures(out);
    setNotes(n);
    onDone(n);
    setBusy(false);
  };

  return (
    <section className="card">
      <h2>2. Hevy</h2>
      <p className="muted small">
        Read-only. Calls every allowlisted endpoint once through the Worker, finds the largest accepted page size, and
        records the real field names.
      </p>
      <button className="primary" disabled={busy} onClick={run}>
        {busy ? "Running…" : "Run Hevy checks"}
      </button>
      {Object.keys(notes).length > 0 && (
        <pre>{Object.entries(notes).map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
      )}
      {captures.map((c) => (
        <CaptureView key={c.id} c={c} />
      ))}
    </section>
  );
}
