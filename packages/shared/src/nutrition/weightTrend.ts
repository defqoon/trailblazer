import type { WeightGoal } from "../schemas";

export interface WeightPoint {
  measuredAt: string; // ISO datetime
  weightKg: number;
  fatPct?: number | null;
  source?: string;
}

export type WeightTrendStatus =
  | "insufficient_data"
  | "on_track"
  | "steady"
  | "too_fast"
  | "above_target"
  | "below_target";

export interface WeightTrendSummary {
  latestWeightKg: number | null;
  latestFatPct: number | null;
  latestMeasuredAt: string | null;
  latestSource: string | null;
  /** 7-day rolling average ending at the most recent weigh-in. */
  avg7dKg: number | null;
  /** Weekly rate of change (kg/week), negative = losing weight. */
  weeklyRateKg: number | null;
  daysSinceLastWeighIn: number | null;
  /** True when >= 7 days since last weigh-in (or never weighed in). */
  weighInDue: boolean;
  status: WeightTrendStatus;
  message: string;
  /** Optional gentle calorie adjustment suggestion after >= 3 weeks of data. */
  suggestedAdjustmentKcal: number | null;
}

const MS_DAY = 86_400_000;
const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function computeWeightTrend(
  points: WeightPoint[],
  goal: WeightGoal,
  now: Date = new Date(),
): WeightTrendSummary {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.weightKg) && p.weightKg > 0)
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());

  if (sorted.length === 0) {
    return {
      latestWeightKg: null,
      latestFatPct: null,
      latestMeasuredAt: null,
      latestSource: null,
      avg7dKg: null,
      weeklyRateKg: null,
      daysSinceLastWeighIn: null,
      weighInDue: true,
      status: "insufficient_data",
      message: "No weigh-ins yet. Step on your scale once a week (or sync Renpho via Health Connect) to track the trend.",
      suggestedAdjustmentKcal: null,
    };
  }

  const latest = sorted[0]!;
  const latestTs = new Date(latest.measuredAt).getTime();
  const daysSinceLastWeighIn = Math.max(0, Math.floor((now.getTime() - latestTs) / MS_DAY));
  const weighInDue = daysSinceLastWeighIn >= 7;

  // 7-day average anchored at the latest weigh-in
  const recent7 = sorted.filter((p) => latestTs - new Date(p.measuredAt).getTime() <= 7 * MS_DAY);
  const avg7dKg = round1(recent7.reduce((s, p) => s + p.weightKg, 0) / recent7.length);

  // Compare against measurements 14–35 days prior to latest
  const older = sorted.filter((p) => {
    const ageDays = (latestTs - new Date(p.measuredAt).getTime()) / MS_DAY;
    return ageDays >= 10 && ageDays <= 35;
  });

  if (older.length === 0) {
    return {
      latestWeightKg: round1(latest.weightKg),
      latestFatPct: latest.fatPct != null ? round1(latest.fatPct) : null,
      latestMeasuredAt: latest.measuredAt,
      latestSource: latest.source ?? null,
      avg7dKg,
      weeklyRateKg: null,
      daysSinceLastWeighIn,
      weighInDue,
      status: "insufficient_data",
      message: "Building your weekly baseline — check back after 2–3 weekly weigh-ins for a reliable trend.",
      suggestedAdjustmentKcal: null,
    };
  }

  const olderAvg = older.reduce((s, p) => s + p.weightKg, 0) / older.length;
  const olderMeanTs = older.reduce((s, p) => s + new Date(p.measuredAt).getTime(), 0) / older.length;
  const spanWeeks = Math.max(1, (latestTs - olderMeanTs) / (7 * MS_DAY));
  const weeklyRateKg = round2((avg7dKg - olderAvg) / spanWeeks);
  const hasThreeWeeks = spanWeeks >= 2.5;

  let status: WeightTrendStatus = "on_track";
  let message = "";
  let suggestedAdjustmentKcal: number | null = null;

  if (goal === "lose" || goal === "lose_slow") {
    const targetMin = goal === "lose" ? -0.75 : -0.45;
    const targetMax = goal === "lose" ? -0.2 : -0.1;
    if (weeklyRateKg < targetMin) {
      status = "too_fast";
      message = `Trending ${weeklyRateKg.toFixed(2)} kg/wk — faster than ideal for training recovery. Consider adding ~150 kcal/day.`;
      if (hasThreeWeeks) suggestedAdjustmentKcal = 150;
    } else if (weeklyRateKg <= targetMax) {
      status = "on_track";
      message = `On track (${weeklyRateKg.toFixed(2)} kg/wk). Steady, sustainable loss.`;
    } else {
      status = "above_target";
      message =
        weeklyRateKg <= 0.1
          ? `Weight holding steady (${weeklyRateKg >= 0 ? "+" : ""}${weeklyRateKg.toFixed(2)} kg/wk). Give it another week or trim ~100–150 kcal/day.`
          : `Trending slightly up (+${weeklyRateKg.toFixed(2)} kg/wk). No stress — double-check portions or trim ~150 kcal/day.`;
      if (hasThreeWeeks) suggestedAdjustmentKcal = -150;
    }
  } else if (goal === "gain") {
    if (weeklyRateKg >= 0.1 && weeklyRateKg <= 0.4) {
      status = "on_track";
      message = `On track (+${weeklyRateKg.toFixed(2)} kg/wk). Clean lean-gain pace.`;
    } else if (weeklyRateKg > 0.4) {
      status = "above_target";
      message = `Gaining faster than planned (+${weeklyRateKg.toFixed(2)} kg/wk). Consider trimming ~150 kcal/day.`;
      if (hasThreeWeeks) suggestedAdjustmentKcal = -150;
    } else {
      status = "below_target";
      message = `Not gaining yet (${weeklyRateKg >= 0 ? "+" : ""}${weeklyRateKg.toFixed(2)} kg/wk). Consider adding ~150 kcal/day.`;
      if (hasThreeWeeks) suggestedAdjustmentKcal = 150;
    }
  } else {
    // maintain
    if (Math.abs(weeklyRateKg) <= 0.15) {
      status = "steady";
      message = `Holding steady (${weeklyRateKg >= 0 ? "+" : ""}${weeklyRateKg.toFixed(2)} kg/wk).`;
    } else if (weeklyRateKg > 0.15) {
      status = "above_target";
      message = `Drifting up (+${weeklyRateKg.toFixed(2)} kg/wk).`;
    } else {
      status = "below_target";
      message = `Drifting down (${weeklyRateKg.toFixed(2)} kg/wk).`;
    }
  }

  return {
    latestWeightKg: round1(latest.weightKg),
    latestFatPct: latest.fatPct != null ? round1(latest.fatPct) : null,
    latestMeasuredAt: latest.measuredAt,
    latestSource: latest.source ?? null,
    avg7dKg,
    weeklyRateKg,
    daysSinceLastWeighIn,
    weighInDue,
    status,
    message,
    suggestedAdjustmentKcal,
  };
}
