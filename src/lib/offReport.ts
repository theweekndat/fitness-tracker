/**
 * Phase 0 Open Food Facts completeness check. Field names follow the OFF "Fields used" wiki
 * (nutriments.energy-kcal_100g etc.); the raw body is stored next to each result so the
 * analysis can be rerun if the live payload uses different names.
 */
export interface OffScanResult {
  barcode: string;
  httpStatus: number;
  found: boolean;
  /** Upstream down or rate limited: says nothing about coverage, so excluded from the hit rate. */
  unavailable: boolean;
  name: string | null;
  brand: string | null;
  kcal100: boolean;
  kjOnly: boolean;
  protein100: boolean;
  carbs100: boolean;
  fat100: boolean;
  servingSize: string | null;
  kcalServing: boolean;
  /** |stated kcal − (4P + 4C + 9F)| / stated kcal, as a percentage; null when inputs are missing. */
  macroGapPct: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function analyseOffProduct(barcode: string, httpStatus: number, body: unknown): OffScanResult {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const product = (root["product"] && typeof root["product"] === "object" ? root["product"] : null) as Record<
    string,
    unknown
  > | null;
  const found = httpStatus === 200 && root["status"] === 1 && product !== null;
  const n = ((product?.["nutriments"] as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

  const kcal = num(n["energy-kcal_100g"]);
  const kj = num(n["energy-kj_100g"]) ?? num(n["energy_100g"]);
  const p = num(n["proteins_100g"]);
  const c = num(n["carbohydrates_100g"]);
  const f = num(n["fat_100g"]);
  const computed = p !== null && c !== null && f !== null ? 4 * p + 4 * c + 9 * f : null;
  const macroGapPct = kcal && computed !== null ? (Math.abs(kcal - computed) / kcal) * 100 : null;

  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    barcode,
    httpStatus,
    found,
    unavailable: httpStatus === 0 || httpStatus === 429 || httpStatus >= 500,
    name: str(product?.["product_name"]) ?? str(product?.["product_name_en"]),
    brand: str(product?.["brands"]),
    kcal100: kcal !== null,
    kjOnly: kcal === null && kj !== null,
    protein100: p !== null,
    carbs100: c !== null,
    fat100: f !== null,
    servingSize: str(product?.["serving_size"]),
    kcalServing: num(n["energy-kcal_serving"]) !== null,
    macroGapPct: macroGapPct === null ? null : Math.round(macroGapPct * 10) / 10,
  };
}

export function summariseOff(results: OffScanResult[]) {
  const unavailable = results.filter((r) => r.unavailable).length;
  const total = results.length - unavailable;
  const found = results.filter((r) => r.found);
  const pct = (k: number, of: number) => (of ? Math.round((k / of) * 100) : 0);
  const count = (pred: (r: OffScanResult) => boolean) => found.filter(pred).length;
  return {
    total,
    unavailable,
    found: found.length,
    hitRatePct: pct(found.length, total),
    completeMacrosPct: pct(count((r) => r.kcal100 && r.protein100 && r.carbs100 && r.fat100), found.length),
    kjOnlyPct: pct(count((r) => r.kjOnly), found.length),
    servingSizePct: pct(count((r) => r.servingSize !== null), found.length),
    macroGapOver15Pct: pct(count((r) => (r.macroGapPct ?? 0) > 15), found.length),
  };
}
