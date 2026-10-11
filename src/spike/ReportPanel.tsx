import { useState } from "react";
import { db, type Capture, type ScanRow } from "../lib/db";
import { copyText, downloadText } from "../lib/download";
import { summariseOff } from "../lib/offReport";
import { shapeLines } from "../lib/shape";
import type { DeviceResults } from "./DevicePanel";

type Answer = "" | "yes" | "no" | "partly";

const QUESTIONS = [
  ["camera", "Camera scanning worked inside the Home-Screen app"],
  ["cameraPrompt", "The camera permission prompt did not reappear on every scan"],
  ["pushArrived", "The test push notification arrived"],
  ["pushLocked", "It arrived with the phone locked"],
  ["idbSurvived", "The IndexedDB marker survived a force-quit"],
] as const;

function latestPerSource(captures: Capture[]): Capture[] {
  const map = new Map<string, Capture>();
  for (const c of captures) map.set(c.source, c);
  return [...map.values()];
}

export function buildReport(input: {
  status: Record<string, unknown> | null;
  hevyNotes: Record<string, string>;
  device: DeviceResults | null;
  answers: Record<string, Answer>;
  notes: string;
  captures: Capture[];
  scans: ScanRow[];
}): string {
  const { status, hevyNotes, device, answers, notes, captures, scans } = input;
  const s = summariseOff(scans);
  const lines: string[] = [];
  lines.push(`# Phase 0 device report`, ``, `Generated ${new Date().toISOString()}`, ``);

  lines.push(`## Worker status`, "```json", JSON.stringify(status, null, 2), "```", ``);

  lines.push(`## Manual checks`);
  for (const [k, label] of QUESTIONS) lines.push(`- ${label}: **${answers[k] || "not answered"}**`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``);

  lines.push(`## Device`, "```json", JSON.stringify(device, null, 2), "```", ``);

  lines.push(`## Hevy page-size probe`);
  for (const [k, v] of Object.entries(hevyNotes)) lines.push(`- ${k}: ${v}`);
  lines.push(``);

  lines.push(`## API response shapes (field names and types only, no values)`, ``);
  for (const c of latestPerSource(captures)) {
    lines.push(`### ${c.source}`, ``, `\`GET /api/${c.path}\` → ${c.status} in ${c.ms} ms`, "```", ...shapeLines(c.body), "```", ``);
  }

  lines.push(`## Open Food Facts (${s.total} barcodes)`, ``);
  lines.push(
    `Hit rate ${s.hitRatePct}% (${s.found}/${s.total}, ${s.unavailable} excluded while OFF was down) · complete macros ${s.completeMacrosPct}% of hits · kJ-only ${s.kjOnlyPct}% · serving size ${s.servingSizePct}% · kcal vs 4P+4C+9F gap >15%: ${s.macroGapOver15Pct}%`,
    ``,
  );
  lines.push(`| Barcode | Found | Product | Brand | kcal/100g | P | C | F | Serving | kcal/serving | Gap % |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|---|---|`);
  const yn = (b: boolean) => (b ? "✓" : "✗");
  for (const r of scans) {
    const kcal = r.kcal100 ? "✓" : r.kjOnly ? "kJ only" : "✗";
    const cell = (v: string | null) => (v ?? "").replace(/\|/g, "/");
    lines.push(
      `| ${r.barcode} | ${r.unavailable ? "down" : yn(r.found)} | ${cell(r.name)} | ${cell(r.brand)} | ${kcal} | ${yn(r.protein100)} | ${yn(r.carbs100)} | ${yn(r.fat100)} | ${cell(r.servingSize)} | ${yn(r.kcalServing)} | ${r.macroGapPct ?? ""} |`,
    );
  }
  const firstHit = scans.find((r) => r.found);
  if (firstHit) {
    lines.push(``, `### Open Food Facts product shape (one hit)`, "```", ...shapeLines(firstHit.raw), "```");
  }
  return lines.join("\n");
}

export function ReportPanel(props: {
  status: Record<string, unknown> | null;
  hevyNotes: Record<string, string>;
  device: DeviceResults | null;
  scans: ScanRow[];
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const make = async () =>
    buildReport({ ...props, answers, notes, captures: await db.captures.orderBy("at").toArray() });

  return (
    <section className="card">
      <h2>6. Report</h2>
      <p className="muted small">
        Answer these after testing, then download or copy the report and send it back. It holds field names, not your
        health values.
      </p>
      {QUESTIONS.map(([k, label]) => (
        <div key={k} className="row" style={{ justifyContent: "space-between", margin: "6px 0" }}>
          <span className="small">{label}</span>
          <select
            value={answers[k] ?? ""}
            onChange={(e) => setAnswers((a) => ({ ...a, [k]: e.target.value as Answer }))}
            style={{ minHeight: 44, borderRadius: 10, padding: "0 8px" }}
          >
            <option value="">–</option>
            <option value="yes">yes</option>
            <option value="partly">partly</option>
            <option value="no">no</option>
          </select>
        </div>
      ))}
      <input placeholder="Any notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={async () => downloadText("phase0-report.md", await make(), "text/markdown")}>
          Download report
        </button>
        <button onClick={async () => setCopied(await copyText(await make()))}>{copied ? "Copied" : "Copy report"}</button>
      </div>
    </section>
  );
}
