/**
 * Flattens a JSON value into "path: type" lines with every value removed, so real API
 * field names can be recorded in docs without copying health data.
 * Arrays are written as `[]` and every element is merged, so optional fields show up.
 */
export function shapeOf(value: unknown, maxArrayItems = 200): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (path: string, type: string) => {
    const key = path || "(root)";
    if (!out.has(key)) out.set(key, new Set());
    out.get(key)!.add(type);
  };
  const walk = (v: unknown, path: string) => {
    if (v === null) return add(path, "null");
    if (Array.isArray(v)) {
      add(path, v.length ? "array" : "array(empty)");
      for (const item of v.slice(0, maxArrayItems)) walk(item, `${path}[]`);
      return;
    }
    if (typeof v === "object") {
      add(path, "object");
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, path ? `${path}.${k}` : k);
      return;
    }
    add(path, typeof v);
  };
  walk(value, "");
  return out;
}

export function shapeLines(value: unknown): string[] {
  return [...shapeOf(value)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, types]) => `${path}: ${[...types].sort().join(" | ")}`);
}
