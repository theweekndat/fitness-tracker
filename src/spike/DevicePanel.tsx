import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { kvGet, kvSet } from "../lib/db";
import { Pill } from "./common";

export interface DeviceResults {
  standalone: boolean;
  userAgent: string;
  persist?: boolean | "unsupported";
  persisted?: boolean | "unsupported";
  quotaMb?: number;
  usageMb?: number;
  launches?: number;
  marker?: { at: number; launchesAtWrite: number } | null;
  serviceWorker?: string;
  notificationPermission?: string;
  push?: string;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function DevicePanel({ onResults }: { onResults: (r: DeviceResults) => void }) {
  const [r, setR] = useState<DeviceResults>({ standalone: isStandalone(), userAgent: navigator.userAgent });
  const update = (patch: Partial<DeviceResults>) =>
    setR((prev) => {
      const next = { ...prev, ...patch };
      onResults(next);
      return next;
    });

  useEffect(() => {
    void (async () => {
      // Launch counter: survives only if IndexedDB survives a force-quit.
      const launches = ((await kvGet<number>("launches")) ?? 0) + 1;
      await kvSet("launches", launches);
      const marker = (await kvGet<DeviceResults["marker"]>("marker")) ?? null;
      const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : "unsupported";
      const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
      const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      update({
        launches,
        marker,
        persisted,
        quotaMb: est?.quota ? Math.round(est.quota / 1e6) : undefined,
        usageMb: est?.usage ? Math.round((est.usage / 1e6) * 10) / 10 : undefined,
        serviceWorker: reg?.active ? "active" : reg ? "registered" : "none",
        notificationPermission: "Notification" in window ? Notification.permission : "unsupported",
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestPersist = async () => {
    update({ persist: navigator.storage?.persist ? await navigator.storage.persist() : "unsupported" });
  };

  const writeMarker = async () => {
    const marker = { at: Date.now(), launchesAtWrite: r.launches ?? 0 };
    await kvSet("marker", marker);
    update({ marker });
  };

  const subscribePush = async () => {
    try {
      if (!("Notification" in window) || !("PushManager" in window)) {
        update({ push: "unsupported here (on iPhone, install to Home Screen first)" });
        return;
      }
      const permission = await Notification.requestPermission();
      update({ notificationPermission: permission });
      if (permission !== "granted") return;
      const keyRes = await api("push/key");
      const publicKey = (keyRes.body as { publicKey?: string } | null)?.publicKey;
      if (!publicKey) {
        update({ push: `no VAPID key from Worker (${keyRes.status})` });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(publicKey) });
      const res = await api("push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      update({ push: res.ok ? `subscribed (${(res.body as { push_host?: string }).push_host})` : `subscribe failed ${res.status}` });
    } catch (e) {
      update({ push: `error: ${String(e)}` });
    }
  };

  const sendPush = async () => {
    const res = await api("push/test", { method: "POST" });
    const b = res.body as { ok?: boolean; upstream_status?: number; detail?: string };
    update({
      push: b?.ok
        ? `sent (push service ${b.upstream_status}). Did a notification appear? Note it in the report.`
        : `send failed: ${res.status} ${JSON.stringify(res.body)}`,
    });
  };

  const markerAge = r.marker ? Math.round((Date.now() - r.marker.at) / 60000) : null;

  return (
    <section className="card">
      <h2>4. This iPhone</h2>
      <p>
        {r.standalone ? <Pill tone="good">Running as Home-Screen app</Pill> : <Pill tone="warn">In browser tab: install to Home Screen for real results</Pill>}
      </p>
      <h3 className="small">Storage</h3>
      <p className="small">
        persisted(): {String(r.persisted)} · persist() request: {r.persist === undefined ? "not asked" : String(r.persist)}
        <br />
        Usage {r.usageMb ?? "?"} MB of {r.quotaMb ?? "?"} MB · service worker: {r.serviceWorker}
      </p>
      <div className="row">
        <button onClick={requestPersist}>Request persistent storage</button>
        <button onClick={writeMarker}>Write IndexedDB marker</button>
      </div>
      <p className="small">
        Launch count: {r.launches ?? "…"}.{" "}
        {r.marker
          ? `Marker written ${markerAge} min ago at launch ${r.marker.launchesAtWrite}. If the launch count went up since, IndexedDB survived a relaunch.`
          : "No marker yet. Write one, force-quit the app (swipe it away), reopen, and check this line."}
      </p>
      <h3 className="small">Web push</h3>
      <p className="small">
        Permission: {r.notificationPermission} · {r.push ?? "not tested"}
      </p>
      <div className="row">
        <button onClick={subscribePush}>Allow notifications and subscribe</button>
        <button onClick={sendPush}>Send test push</button>
      </div>
      <p className="muted small">After sending, lock the phone or switch apps; the push should arrive within a minute.</p>
    </section>
  );
}
