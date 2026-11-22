import { describe, expect, it } from "vitest";
import { sportFromStrava } from "./sports";

describe("sportFromStrava", () => {
  it("maps trail-relevant types", () => {
    expect(sportFromStrava("TrailRun")).toBe("trail_run");
    expect(sportFromStrava("BackcountrySki")).toBe("ski_touring");
    expect(sportFromStrava("Hike")).toBe("hike");
  });
  it("falls back to other", () => {
    expect(sportFromStrava("Kitesurf")).toBe("other");
  });
});
