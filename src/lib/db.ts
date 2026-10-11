import Dexie, { type Table } from "dexie";
import type { OffScanResult } from "./offReport";

export interface Capture {
  id?: number;
  /** e.g. "hevy:workouts" or "oura:daily_sleep" */
  source: string;
  path: string;
  status: number;
  at: number;
  ms: number;
  body: unknown;
}

export interface ScanRow extends OffScanResult {
  id?: number;
  at: number;
  method: "camera" | "photo" | "manual";
  cache: string | null;
  raw: unknown;
}

export interface KvRow {
  key: string;
  value: unknown;
}

/** Phase 0 spike database. Phase 1 replaces this with the real schema (brief §6). */
class SpikeDb extends Dexie {
  captures!: Table<Capture, number>;
  scans!: Table<ScanRow, number>;
  kv!: Table<KvRow, string>;

  constructor() {
    super("hub-spike");
    this.version(1).stores({ captures: "++id, source, at", scans: "++id, barcode, at", kv: "key" });
  }
}

export const db = new SpikeDb();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
