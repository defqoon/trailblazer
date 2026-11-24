import { describe, expect, it } from "vitest";
import { DEFAULT_NUTRITION_SETTINGS } from "../schemas";
import { computeRecommendations } from "./recommendations";
import { computeBmr, computeDailyTargets, detectTrainingFocus, estimateWorkoutKcal } from "./targets";
import { computeWeightTrend } from "./weightTrend";

describe("nutrition engine", () => {
  it("prioritizes DEXA BMR over DEXA lean mass, scale BMR, and profile", () => {
    const res1 = computeBmr({
      settings: { dexaBmrKcal: 1850, dexaLeanMassKg: 60 },
      latestBody: { weightKg: 75, fatPct: 18, bmrKcal: 1700 },
    });
    expect(res1.source).toBe("dexa_bmr");
    expect(res1.bmrKcal).toBe(1850);

    const res2 = computeBmr({
      settings: { dexaBmrKcal: null, dexaLeanMassKg: 62 },
      latestBody: { weightKg: 75, fatPct: 18, bmrKcal: 1700 },
    });
    expect(res2.source).toBe("dexa_lean_mass");
    expect(res2.bmrKcal).toBe(Math.round(370 + 21.6 * 62));

    const res3 = computeBmr({
      settings: { dexaBmrKcal: null, dexaLeanMassKg: null },
      latestBody: { weightKg: 75, fatPct: 20, bmrKcal: null },
    });
    expect(res3.source).toBe("scale_lean_mass");
    expect(res3.bmrKcal).toBe(Math.round(370 + 21.6 * 60));
  });

  it("computes daily targets with default 75% workout credit and heavy-day recovery guard", () => {
    const bmr = computeBmr({ settings: { dexaBmrKcal: 1800, dexaLeanMassKg: null } });
    const settings = { ...DEFAULT_NUTRITION_SETTINGS, weightGoal: "lose" as const };

    // Rest day: 1800 * 1.2 - 450 = 1710
    const rest = computeDailyTargets({
      settings,
      bmr,
      weightKg: 75,
      trainingFocus: "endurance",
      workoutKcal: 0,
    });
    expect(rest.baseKcal).toBe(1710);
    expect(rest.adjustedKcal).toBe(1710);
    expect(rest.heavyDayGuardApplied).toBe(false);

    // Big run day (+800 kcal, 75% credit = +600): deficit capped to -250 -> base 1910 + 600 = 2510
    const longRun = computeDailyTargets({
      settings,
      bmr,
      weightKg: 75,
      trainingFocus: "endurance",
      workoutKcal: 800,
    });
    expect(longRun.heavyDayGuardApplied).toBe(true);
    expect(longRun.baseKcal).toBe(1910);
    expect(longRun.workoutCreditKcal).toBe(600);
    expect(longRun.adjustedKcal).toBe(2510);
    expect(longRun.macros.carbsG).toBeGreaterThan(rest.macros.carbsG);
  });

  it("respects manual calorie override", () => {
    const bmr = computeBmr({ settings: { dexaBmrKcal: 1800, dexaLeanMassKg: null } });
    const targets = computeDailyTargets({
      settings: { ...DEFAULT_NUTRITION_SETTINGS, mode: "manual", manualKcal: 2200 },
      bmr,
      weightKg: 75,
      trainingFocus: "strength",
      workoutKcal: 400,
    });
    expect(targets.baseKcal).toBe(2200);
    expect(targets.adjustedKcal).toBe(2500);
    expect(targets.macros.proteinG).toBe(150);
  });

  it("detects training focus from plan", () => {
    expect(detectTrainingFocus("auto", { goalSport: "trail_run", strengthPerWeek: 1 })).toBe("endurance");
    expect(detectTrainingFocus("auto", { goalSport: "trail_run", strengthPerWeek: 2 })).toBe("hybrid");
    expect(detectTrainingFocus("auto", { goalSport: null, strengthPerWeek: 3 })).toBe("strength");
    expect(detectTrainingFocus("strength", { goalSport: "trail_run", strengthPerWeek: 0 })).toBe("strength");
  });

  it("estimates workout kcal when watch kcal is missing", () => {
    expect(estimateWorkoutKcal("trail_run", 3600, 70)).toBe(Math.round(9.5 * 70));
  });

  it("emits calorie-approaching and protein-gap recommendations", () => {
    const bmr = computeBmr({ settings: { dexaBmrKcal: 1700, dexaLeanMassKg: null } });
    const targets = computeDailyTargets({
      settings: { ...DEFAULT_NUTRITION_SETTINGS, mode: "manual", manualKcal: 2000 },
      bmr,
      weightKg: 75,
      trainingFocus: "hybrid",
      workoutKcal: 0,
    });
    const recs = computeRecommendations({
      targets,
      totals: { kcal: 1780, proteinG: 80, carbsG: 230, fatG: 60, mealCount: 3 },
      settings: DEFAULT_NUTRITION_SETTINGS,
    });
    expect(recs.some((r) => r.id === "approaching_limit")).toBe(true);
    expect(recs.some((r) => r.id === "protein_priority")).toBe(true);
  });

  it("tracks weekly weight trend calmly and flags weekly weigh-in when due", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const trend = computeWeightTrend(
      [
        { measuredAt: "2026-11-22T08:00:00Z", weightKg: 76.2, fatPct: 18.1, source: "health_connect" },
        { measuredAt: "2026-11-15T08:00:00Z", weightKg: 76.6, fatPct: 18.4, source: "health_connect" },
        { measuredAt: "2026-11-08T08:00:00Z", weightKg: 77.0, fatPct: 18.7, source: "health_connect" },
        { measuredAt: "2026-11-01T08:00:00Z", weightKg: 77.4, fatPct: 19.0, source: "health_connect" },
      ],
      "lose",
      now,
    );
    expect(trend.status).toBe("on_track");
    expect(trend.weighInDue).toBe(false);
    expect(trend.weeklyRateKg).toBeLessThan(-0.2);

    const overdue = computeWeightTrend(
      [{ measuredAt: "2026-11-10T08:00:00Z", weightKg: 77.0, source: "manual" }],
      "lose",
      now,
    );
    expect(overdue.weighInDue).toBe(true);
    expect(overdue.daysSinceLastWeighIn).toBe(14);
  });
});
