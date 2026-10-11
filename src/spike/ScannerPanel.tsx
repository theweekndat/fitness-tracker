import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { db, type ScanRow } from "../lib/db";
import { analyseOffProduct, summariseOff } from "../lib/offReport";
import { Pill } from "./common";

const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
]);

const TARGET = 25;

export function ScannerPanel({ onScans }: { onScans: (rows: ScanRow[]) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const readerRef = useRef(new BrowserMultiFormatReader(hints));
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState("");
  const [rows, setRows] = useState<ScanRow[]>([]);

  const reload = async () => {
    const all = await db.scans.orderBy("at").toArray();
    // Latest result per barcode.
    const byCode = new Map(all.map((r) => [r.barcode, r]));
    const list = [...byCode.values()].reverse();
    setRows(list);
    onScans(list);
  };

  useEffect(() => {
    void reload();
    return () => controlsRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  };

  const lookup = async (barcode: string, method: ScanRow["method"]) => {
    setMsg(`Looking up ${barcode}…`);
    const res = await api(`off/product/${barcode}`);
    const result = analyseOffProduct(barcode, res.status, res.body);
    await db.scans.add({ ...result, at: Date.now(), method, cache: res.headers.get("x-hub-cache"), raw: res.body });
    setMsg(
      result.found
        ? `Found: ${result.name ?? "(no name)"}`
        : result.unavailable
          ? `Open Food Facts unavailable (${res.status}). Not counted; try this barcode again later.`
          : `Not found (${res.status}). This is the "Scan label" fallback case.`,
    );
    await reload();
  };

  const startCamera = async () => {
    setMsg("");
    try {
      setScanning(true);
      controlsRef.current = await readerRef.current.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current!,
        (result) => {
          if (!result) return;
          stop();
          void lookup(result.getText(), "camera");
        },
      );
    } catch (e) {
      setScanning(false);
      setMsg(`Camera failed: ${String(e)}. Try "Photo" instead.`);
    }
  };

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const result = await readerRef.current.decodeFromImageUrl(url);
      await lookup(result.getText(), "photo");
    } catch {
      setMsg("No barcode found in that photo. Try closer and in focus, or type the number.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const s = summariseOff(rows);

  return (
    <section className="card">
      <h2>5. Barcode scan + Open Food Facts</h2>
      <p className="muted small">
        Scan {TARGET} different Australian pantry or supermarket products. Each result is stored on this phone. Food data
        © Open Food Facts contributors, ODbL.
      </p>
      <p>
        <strong>
          {rows.length} / {TARGET}
        </strong>{" "}
        scanned{s.unavailable ? ` (${s.unavailable} while OFF was down, not counted)` : ""} · hit rate {s.hitRatePct}% · complete macros {s.completeMacrosPct}% of hits · kJ-only {s.kjOnlyPct}% ·
        serving size {s.servingSizePct}% · kcal mismatch &gt;15% {s.macroGapOver15Pct}%
      </p>
      <video ref={videoRef} playsInline muted style={{ display: scanning ? "block" : "none" }} />
      <div className="row">
        {scanning ? (
          <button onClick={stop}>Stop camera</button>
        ) : (
          <button className="primary" onClick={startCamera}>
            Scan with camera
          </button>
        )}
        <label className="button">
          Photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              void fromPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="Or type the barcode digits"
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ""))}
        />
        <button
          disabled={manual.length < 8}
          onClick={() => {
            void lookup(manual, "manual");
            setManual("");
          }}
        >
          Look up
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Barcode</th>
                <th>Result</th>
                <th>Product</th>
                <th>kcal</th>
                <th>P/C/F</th>
                <th>Serving</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.barcode}>
                  <td>{r.barcode}</td>
                  <td>
                    {r.found ? <Pill tone="good">hit</Pill> : r.unavailable ? <Pill tone="warn">down</Pill> : <Pill tone="bad">miss</Pill>}
                  </td>
                  <td>{r.name ?? "–"}</td>
                  <td>{r.kcal100 ? "yes" : r.kjOnly ? "kJ only" : "no"}</td>
                  <td>{[r.protein100, r.carbs100, r.fat100].map((b) => (b ? "✓" : "✗")).join(" ")}</td>
                  <td>{r.servingSize ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <button
          style={{ marginTop: 8 }}
          onClick={async () => {
            if (confirm("Delete all scan results on this phone?")) {
              await db.scans.clear();
              await reload();
            }
          }}
        >
          Clear scans
        </button>
      )}
    </section>
  );
}
