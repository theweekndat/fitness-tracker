import { useState } from "react";
import type { ScanRow } from "../lib/db";
import { ConnectionPanel, type Status } from "./ConnectionPanel";
import { DevicePanel, type DeviceResults } from "./DevicePanel";
import { HevyPanel } from "./HevyPanel";
import { OuraPanel } from "./OuraPanel";
import { ReportPanel } from "./ReportPanel";
import { ScannerPanel } from "./ScannerPanel";

export function Spike() {
  const [status, setStatus] = useState<Status>(null);
  const [hevyNotes, setHevyNotes] = useState<Record<string, string>>({});
  const [device, setDevice] = useState<DeviceResults | null>(null);
  const [scans, setScans] = useState<ScanRow[]>([]);

  return (
    <main className="page">
      <h1>Phase 0 checks</h1>
      <p className="muted small">
        Work top to bottom. Everything runs through your own Worker; results stay on this phone until you export the
        report.
      </p>
      <ConnectionPanel onStatus={setStatus} />
      <HevyPanel onDone={setHevyNotes} />
      <OuraPanel status={status} />
      <DevicePanel onResults={setDevice} />
      <ScannerPanel onScans={setScans} />
      <ReportPanel status={status} hevyNotes={hevyNotes} device={device} scans={scans} />
    </main>
  );
}
