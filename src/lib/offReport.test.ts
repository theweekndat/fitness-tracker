import { describe, expect, it } from "vitest";
import { analyseOffProduct, summariseOff } from "./offReport";

const product = (nutriments: Record<string, number>, extra: Record<string, unknown> = {}) => ({
  status: 1,
  product: { product_name: "Rolled Oats", brands: "Uncle Tobys", serving_size: "40 g", nutriments, ...extra },
});

describe("analyseOffProduct", () => {
  it("reads a complete product and checks kcal against 4P + 4C + 9F", () => {
    const r = analyseOffProduct(
      "9300633603454",
      200,
      product({ "energy-kcal_100g": 380, proteins_100g: 12, carbohydrates_100g: 60, fat_100g: 8 }),
    );
    expect(r).toMatchObject({ found: true, name: "Rolled Oats", kcal100: true, kjOnly: false, servingSize: "40 g" });
    // 4·12 + 4·60 + 9·8 = 360, gap 20/380 = 5.3%
    expect(r.macroGapPct).toBe(5.3);
  });

  it("flags kJ-only energy (common on Australian labels)", () => {
    const r = analyseOffProduct("1", 200, product({ "energy-kj_100g": 1590, proteins_100g: 12 }));
    expect(r.kcal100).toBe(false);
    expect(r.kjOnly).toBe(true);
    expect(r.macroGapPct).toBeNull();
  });

  it("treats status 0 and 404 as not found", () => {
    expect(analyseOffProduct("1", 404, { status: 0, status_verbose: "product not found" }).found).toBe(false);
    expect(analyseOffProduct("1", 200, { status: 0 }).found).toBe(false);
    expect(analyseOffProduct("1", 503, "busy").found).toBe(false);
  });
});

describe("summariseOff", () => {
  it("computes hit rate over all scans and completeness over hits", () => {
    const hit = analyseOffProduct("1", 200, product({ "energy-kcal_100g": 360, proteins_100g: 12, carbohydrates_100g: 60, fat_100g: 8 }));
    const miss = analyseOffProduct("2", 404, { status: 0 });
    const down = analyseOffProduct("3", 502, null);
    expect(down.unavailable).toBe(true);
    expect(summariseOff([hit, miss, miss, miss, down])).toMatchObject({
      total: 4,
      unavailable: 1,
      found: 1,
      hitRatePct: 25,
      completeMacrosPct: 100,
    });
  });
});
