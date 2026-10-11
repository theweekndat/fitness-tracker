import { useState } from "react";
import { api } from "../lib/api";
import { db, type Capture } from "../lib/db";
import { copyText, downloadText } from "../lib/download";
import { shapeLines } from "../lib/shape";

export function Pill({ tone, children }: { tone: "good" | "warn" | "bad"; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/** GET through the Worker and store the full response locally for the findings export. */
export async function capture(source: string, path: string): Promise<Capture> {
  const res = await api(path);
  const row: Capture = { source, path, status: res.status, at: Date.now(), ms: res.ms, body: res.body };
  row.id = await db.captures.add(row);
  return row;
}

export function CaptureView({ c }: { c: Capture }) {
  const [copied, setCopied] = useState(false);
  const lines = shapeLines(c.body);
  const tone = c.status >= 200 && c.status < 300 ? "good" : "bad";
  return (
    <div className="card">
      <div className="row">
        <strong>{c.source}</strong>
        <Pill tone={tone}>{c.status || "network error"}</Pill>
        <span className="muted small">
          {c.ms} ms · {new Date(c.at).toLocaleTimeString()}
        </span>
      </div>
      <p className="muted small">/api/{c.path}</p>
      <details>
        <summary>Field names and types ({lines.length} paths, no values)</summary>
        <pre>{lines.join("\n")}</pre>
      </details>
      <div className="row">
        <button onClick={() => downloadText(`${c.source.replace(/[:/]/g, "_")}.json`, JSON.stringify(c.body, null, 2))}>
          Download raw JSON
        </button>
        <button
          onClick={async () => {
            setCopied(await copyText(lines.join("\n")));
          }}
        >
          {copied ? "Copied" : "Copy shape"}
        </button>
      </div>
    </div>
  );
}
