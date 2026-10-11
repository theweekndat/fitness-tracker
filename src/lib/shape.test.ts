import { describe, expect, it } from "vitest";
import { shapeLines } from "./shape";

describe("shapeLines", () => {
  it("records paths and types but never values", () => {
    const lines = shapeLines({
      data: [
        { day: "2026-10-10", score: 81, contributors: { deep_sleep: 70 } },
        { day: "2026-10-11", score: null },
      ],
      next_token: null,
    });
    expect(lines).toEqual([
      "(root): object",
      "data: array",
      "data[]: object",
      "data[].contributors: object",
      "data[].contributors.deep_sleep: number",
      "data[].day: string",
      "data[].score: null | number",
      "next_token: null",
    ]);
    expect(lines.join("\n")).not.toContain("2026");
    expect(lines.join("\n")).not.toContain("81");
  });
});
