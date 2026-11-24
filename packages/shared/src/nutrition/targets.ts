import type {
  ActivityLevel,
  AthleteProfile,
  NutritionSettings,
  ResolvedTrainingFocus,
  WeightGoal,
} from "../schemas";

export type BmrSource =
  | "dexa_bmr"
  | "dexa_lean_mass"
  | "scale_bmr"
  | "scale_lean_mass"
  | "profile_estimate"
  | "default";

export interface BmrResult {
  bmrKcal: number;
  source: BmrSource;
  label: string;
}

export interface BmrInputs {
  settings: Pick<NutritionSettings, "dexaBmrKcal" | "dexaLeanMassKg">;
  dexaScan?: { leanMassKg?: number | null } | null;
  latestBody?: { weightKg?: number | null; fatPct?: number | null; bmrKcal?: number | null } | null;
  profile?: Pick<AthleteProfile, "age" | "sex" | "weightKg"> | null;
}

const katchMcArdle = (leanMassKg: number) => Math.round(370 + 21.6 * leanMassKg);

/**
 * Determine resting metabolic rate (BMR) from the most accurate available source:
 * 1. Explicit DEXA RMR/BMR in settings
 * 2. DEXA lean mass (from latest confirmed DEXA scan or settings) via Katch-McArdle
 * 3. Smart scale (Renpho) BMR or body-fat-derived lean mass
 * 4. Profile-based estimate (age, sex, weight)
 */
export function computeBmr(inputs: BmrInputs): BmrResult {
  const { settings, dexaScan, latestBody, profile } = inputs;

  if (settings.dexaBmrKcal && settings.dexaBmrKcal > 0) {
    return {
      bmrKcal: Math.round(settings.dexaBmrKcal),
      source: "dexa_bmr",
      label: "DEXA scan RMR",
    };
  }

  const dexaLean = dexaScan?.leanMassKg ?? settings.dexaLeanMassKg ?? null;
  if (dexaLean && dexaLean > 20) {
    return {
      bmrKcal: katchMcArdle(dexaLean),
      source: "dexa_lean_mass",
      label: `DEXA lean mass (${dexaLean.toFixed(1)} kg)`,
    };
  }

  if (latestBody?.bmrKcal && latestBody.bmrKcal > 0) {
    return {
      bmrKcal: Math.round(latestBody.bmrKcal),
      source: "scale_bmr",
      label: "Renpho scale BMR",
    };
  }

  if (latestBody?.weightKg && latestBody.fatPct && latestBody.fatPct > 2 && latestBody.fatPct < 65) {
    const leanKg = latestBody.weightKg * (1 - latestBody.fatPct / 100);
    return {
      bmrKcal: katchMcArdle(leanKg),
      source: "scale_lean_mass",
      label: `Scale body composition (${leanKg.toFixed(1)} kg lean)`,
    };
  }

  const weightKg = latestBody?.weightKg ?? profile?.weightKg ?? null;
  if (weightKg) {
    // Mifflin-St Jeor using average adult height (175 cm male / 163 cm female / 170 cm unspecified)
    const age = profile?.age ?? 35;
    const sex = profile?.sex ?? "unspecified";
    const assumedHeightCm = sex === "male" ? 175 : sex === "female" ? 163 : 170;
    const sexOffset = sex === "male" ? 5 : sex === "female" ? -161 : -78;
    const bmr = Math.round(10 * weightKg + 6.25 * assumedHeightCm - 5 * age + sexOffset);
    return {
      bmrKcal: Math.max(1100, bmr),
      source: "profile_estimate",
      label: "Estimated from profile",
    };
  }

  return {
    bmrKcal: 1700,
    source: "default",
    label: "Default baseline (add DEXA or weight in Settings)",
  };
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.3,
  moderate: 1.4,
};

const GOAL_DELTA_KCAL: Record<WeightGoal, number> = {
  lose_slow: -250,
  lose: -450,
  maintain: 0,
  gain: 250,
};

export interface PlanFocusInput {
  goalSport?: string | null;
  strengthPerWeek?: number | null;
  weeklyEnduranceHours?: number | null;
}

const ENDURANCE_SPORTS = new Set([
  "trail_run",
  "road_run",
  "run",
  "hike",
  "cycling",
  "mtb",
  "ski_tour",
  "xc_ski",
  "swim",
  "row",
]);

/** Infer training focus from the active plan/profile when settings.trainingFocus === "auto". */
export function detectTrainingFocus(
  setting: NutritionSettings["trainingFocus"],
  plan?: PlanFocusInput | null,
): ResolvedTrainingFocus {
  if (setting !== "auto") return setting;
  if (!plan) return "hybrid";
  const hasEnduranceGoal = plan.goalSport ? ENDURANCE_SPORTS.has(plan.goalSport) : false;
  const strengthSessions = plan.strengthPerWeek ?? 0;
  const enduranceHours = plan.weeklyEnduranceHours ?? 0;

  if (hasEnduranceGoal && strengthSessions >= 2) return "hybrid";
  if (hasEnduranceGoal || enduranceHours >= 4) return "endurance";
  if (strengthSessions >= 3) return "strength";
  return "hybrid";
}

/** Rough kcal estimate for an activity when Strava/watch didn't supply calories. */
export function estimateWorkoutKcal(sport: string, movingTimeS: number, weightKg = 72): number {
  const hours = Math.max(0, movingTimeS) / 3600;
  const s = sport.toLowerCase();
  const met =
    s.includes("run") || s.includes("trail")
      ? 9.5
      : s.includes("ski")
        ? 8.0
        : s.includes("ride") || s.includes("cycl") || s.includes("bike") || s.includes("mtb")
          ? 7.5
          : s.includes("swim")
            ? 8.0
            : s.includes("hike") || s.includes("walk")
              ? 5.5
              : s.includes("strength") || s.includes("weight") || s.includes("climb")
                ? 5.0
                : 6.0;
  return Math.round(met * weightKg * hours);
}

export interface DailyTargets {
  bmr: BmrResult;
  trainingFocus: ResolvedTrainingFocus;
  mode: "auto" | "manual";
  /** Starting morning calorie budget (before today's workouts). */
  baseKcal: number;
  /** Raw workout calories burned today. */
  workoutKcal: number;
  /** Workout calories credited to today's budget (workoutKcal * workoutEatBackPct / 100). */
  workoutCreditKcal: number;
  /** Adjusted daily budget = baseKcal + workoutCreditKcal (with heavy-session recovery guard). */
  adjustedKcal: number;
  /** True if deficit was softened today to protect recovery on a big endurance session. */
  heavyDayGuardApplied: boolean;
  macros: {
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

export function computeDailyTargets(params: {
  settings: NutritionSettings;
  bmr: BmrResult;
  weightKg: number;
  trainingFocus: ResolvedTrainingFocus;
  workoutKcal: number;
}): DailyTargets {
  const { settings, bmr, weightKg, trainingFocus } = params;
  const workoutKcal = Math.max(0, Math.round(params.workoutKcal));
  const workoutCreditKcal = Math.round((workoutKcal * settings.workoutEatBackPct) / 100);

  let baseKcal: number;
  let heavyDayGuardApplied = false;

  if (settings.mode === "manual" && settings.manualKcal) {
    baseKcal = Math.round(settings.manualKcal);
  } else {
    const maintenanceBase = Math.round(bmr.bmrKcal * ACTIVITY_MULTIPLIERS[settings.activityLevel]);
    let goalDelta = GOAL_DELTA_KCAL[settings.weightGoal];

    // Protect recovery on big endurance training days (> 600 kcal workout burn)
    if (goalDelta < -250 && workoutKcal >= 600 && trainingFocus !== "strength") {
      goalDelta = -250;
      heavyDayGuardApplied = true;
    }

    baseKcal = Math.max(1200, maintenanceBase + goalDelta);
  }

  const adjustedKcal = baseKcal + workoutCreditKcal;

  // Macro targets tailored to training focus and weight goal
  const isLosing = settings.weightGoal === "lose" || settings.weightGoal === "lose_slow";
  const proteinPerKg =
    trainingFocus === "strength"
      ? 2.0
      : trainingFocus === "endurance"
        ? isLosing
          ? 1.9
          : 1.7
        : isLosing
          ? 1.95
          : 1.85;

  const proteinG = Math.round(Math.max(90, Math.min(240, weightKg * proteinPerKg)));
  const fatPerKg = trainingFocus === "endurance" ? 0.8 : 0.85;
  const fatFloorG = Math.round(Math.max(45, weightKg * fatPerKg));
  const fatCapG = Math.round((adjustedKcal * 0.3) / 9);
  const fatG = Math.max(45, Math.min(fatFloorG, fatCapG));

  const remainingForCarbsKcal = Math.max(200, adjustedKcal - proteinG * 4 - fatG * 9);
  const carbsG = Math.round(remainingForCarbsKcal / 4);

  return {
    bmr,
    trainingFocus,
    mode: settings.mode,
    baseKcal,
    workoutKcal,
    workoutCreditKcal,
    adjustedKcal,
    heavyDayGuardApplied,
    macros: { proteinG, carbsG, fatG },
  };
}
