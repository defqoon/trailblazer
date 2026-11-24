import { z } from "zod";
import { GOAL_SPORTS, SPORTS, type GoalSport, type Sport } from "./sports";

export const sportSchema = z.enum(SPORTS);
export const goalSportSchema = z.enum(GOAL_SPORTS);

const isoDate = z.iso.date();
const monthDay = z.string().regex(/^\d{2}-\d{2}$/, "MM-DD");
/** 0 = Monday … 6 = Sunday */
const weekday = z.number().int().min(0).max(6);

export const goalLegSchema = z.object({
  sport: goalSportSchema,
  distanceKm: z.number().positive().max(1000),
  elevationGainM: z.number().min(0).max(30000),
  /** null = same as gain (a loop) */
  elevationLossM: z.number().min(0).max(30000).nullable(),
});
export type GoalLeg = z.infer<typeof goalLegSchema>;

export const goalSchema = z.object({
  name: z.string().trim().min(1, "Give your event a name").max(120),
  eventDate: isoDate,
  /** One leg = single-sport event; several = multisport (in race order). */
  legs: z
    .array(goalLegSchema)
    .min(1)
    .max(6)
    .refine((legs) => new Set(legs.map((l) => l.sport)).size === legs.length, "Each sport can appear only once"),
  /** null = "just finish strong" */
  targetTimeMin: z.number().positive().nullable(),
  /** 1 = smooth trail / road, 2 = rocky singletrack, 3 = scrambling / off-trail */
  technicality: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  priority: z.enum(["finish", "perform"]),
});
export type Goal = z.infer<typeof goalSchema>;

export const goalSports = (g: Pick<Goal, "legs">): GoalSport[] => g.legs.map((l) => l.sport);
export const goalTotals = (g: Pick<Goal, "legs">) => ({
  distanceKm: g.legs.reduce((a, l) => a + l.distanceKm, 0),
  elevationGainM: g.legs.reduce((a, l) => a + l.elevationGainM, 0),
});

export const regularActivitySchema = z.object({
  sport: sportSchema,
  perWeek: z.number().int().min(1).max(7),
  /** Preferred days; empty = let the plan choose. */
  days: z.array(weekday).max(7),
  durationMin: z.number().min(15).max(480),
});
export type RegularActivity = z.infer<typeof regularActivitySchema>;

export const sportWindowSchema = z.object({
  sport: sportSchema,
  /** Inclusive month-day range. Wraps over the new year when from > to (e.g. 12-01 → 03-31). */
  from: monthDay,
  to: monthDay,
});
export type SportWindow = z.infer<typeof sportWindowSchema>;

export const athleteProfileSchema = z.object({
  age: z.number().int().min(14).max(90),
  sex: z.enum(["male", "female", "unspecified"]),
  experience: z.enum(["beginner", "intermediate", "advanced"]),
  weightKg: z.number().min(30).max(250),
  current: z.object({
    weeklyHours: z.number().min(0).max(30),
    sessionsPerWeek: z.number().int().min(0).max(14),
    longestSessionMin: z.number().min(0).max(1200),
  }),
  availability: z
    .object({
      /** Days you can train. */
      days: z.array(weekday).min(2).max(7),
      longDay: weekday,
      maxWeeklyHours: z.number().min(2).max(30),
      maxWeekdayMin: z.number().min(20).max(300),
      backToBack: z.boolean(),
    })
    .refine((a) => a.days.includes(a.longDay), {
      message: "Long day must be one of your training days",
      path: ["longDay"],
    }),
  /**
   * Endurance sports you can train with, and when each is possible.
   * Goal sports without a window are treated as available all year.
   */
  sports: z.array(sportWindowSchema),
  /** Things you do every week regardless of the plan (e.g. climbing 2×). */
  activities: z.array(regularActivitySchema).max(8),
  workouts: z.object({
    /** Willing to do structured intervals. */
    structured: z.boolean(),
    strengthPerWeek: z.number().int().min(0).max(3),
    strengthAccess: z.enum(["none", "home", "gym"]),
    mobilityPerWeek: z.number().int().min(0).max(7),
  }),
  terrain: z.object({
    /** Biggest continuous climb reachable on a weekday. */
    maxLocalClimbM: z.number().min(0).max(3000),
    treadmillIncline: z.boolean(),
    stairs: z.boolean(),
  }),
  injuries: z.string().max(1000),
  dexa: z.object({ recent: z.boolean(), date: isoDate.nullable() }),
  maxHr: z.number().int().min(120).max(230).nullable(),
  restingHr: z.number().int().min(30).max(100).nullable(),
});
export type AthleteProfile = z.infer<typeof athleteProfileSchema>;

export const planRequestSchema = z.object({
  goal: goalSchema,
  profile: athleteProfileSchema,
  startDate: isoDate,
});
export type PlanRequest = z.infer<typeof planRequestSchema>;

export const PHASES = ["base", "build", "specific", "taper"] as const;
export type Phase = (typeof PHASES)[number];

export const WORKOUT_TYPES = [
  "easy",
  "long",
  "back_to_back",
  "vert_intervals",
  "tempo",
  "downhill",
  "strides",
  "simulation",
  "strength",
  "mobility",
  "activity",
  "recovery",
  "race",
] as const;
export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export interface WorkoutStep {
  label: string;
  durationMin: number | null;
  repeat?: number;
  intensity: string;
  notes?: string;
}

export interface WeekSkeleton {
  index: number;
  weekStart: string;
  phase: Phase;
  isRecovery: boolean;
  targetHours: number;
  targetVerticalM: number;
  targetLongMin: number;
  /** Endurance sports available during this week (goal sports first). */
  sports: Sport[];
  /** Fraction of endurance volume that may be done in the goal sports (impact ramp-in). */
  goalSportShare: number;
  /** Endurance sessions this week (ramps up from your current frequency). */
  sessions: number;
  notes: string[];
}

export interface PlannedWorkoutDraft {
  date: string;
  sport: Sport;
  type: WorkoutType;
  title: string;
  durationMin: number;
  distanceKm: number | null;
  verticalM: number | null;
  intensity: string;
  description: string;
  steps: WorkoutStep[];
  key: boolean;
}

export const workoutStatusSchema = z.enum(["planned", "done", "partial", "skipped"]);

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "during_activity"] as const;
export const mealTypeSchema = z.enum(MEAL_TYPES);
export type MealType = z.infer<typeof mealTypeSchema>;

export const foodItemSchema = z.object({
  name: z.string().min(1),
  grams: z.number().nonnegative(),
  kcal: z.number().nonnegative(),
  kcalMin: z.number().nonnegative().optional(),
  kcalMax: z.number().nonnegative().optional(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
});
export type FoodItem = z.infer<typeof foodItemSchema>;

export const foodFollowUpQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  suggestions: z.array(z.string().min(1)).max(5).default([]),
});
export type FoodFollowUpQuestion = z.infer<typeof foodFollowUpQuestionSchema>;

export const foodEstimateSchema = z.object({
  items: z.array(foodItemSchema),
  totalKcal: z.number().nonnegative(),
  kcalMin: z.number().nonnegative(),
  kcalMax: z.number().nonnegative(),
  kcalDelta: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  confidence: z.enum(["low", "medium", "high"]),
  needsClarification: z.boolean(),
  followUpQuestions: z.array(foodFollowUpQuestionSchema).max(4).default([]),
  notes: z.string().default(""),
});
export type FoodEstimate = z.infer<typeof foodEstimateSchema>;

export const foodClarificationTurnSchema = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(500),
});
export type FoodClarificationTurn = z.infer<typeof foodClarificationTurnSchema>;

export const foodEstimateRequestSchema = z.object({
  description: z.string().max(2000).default(""),
  meal: mealTypeSchema.optional(),
  photoKey: z.string().max(300).nullable().optional(),
  clarifications: z.array(foodClarificationTurnSchema).max(12).default([]),
});
export type FoodEstimateRequest = z.infer<typeof foodEstimateRequestSchema>;

export const foodEntryCreateSchema = z.object({
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  date: isoDate.optional(),
  meal: mealTypeSchema.nullable().optional(),
  description: z.string().max(2000).default(""),
  photoKey: z.string().max(300).nullable().optional(),
  items: z.array(foodItemSchema).default([]),
  kcal: z.number().min(0).max(15000),
  kcalMin: z.number().min(0).max(15000).nullable().optional(),
  kcalMax: z.number().min(0).max(15000).nullable().optional(),
  proteinG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(2000),
  fatG: z.number().min(0).max(1000),
  confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
  userCorrected: z.boolean().default(false),
});
export type FoodEntryCreate = z.infer<typeof foodEntryCreateSchema>;

export const foodEntryUpdateSchema = foodEntryCreateSchema.partial();
export type FoodEntryUpdate = z.infer<typeof foodEntryUpdateSchema>;

export const WEIGHT_GOALS = ["lose_slow", "lose", "maintain", "gain"] as const;
export type WeightGoal = (typeof WEIGHT_GOALS)[number];

export const TRAINING_FOCUSES = ["auto", "endurance", "strength", "hybrid"] as const;
export type TrainingFocusSetting = (typeof TRAINING_FOCUSES)[number];
export type ResolvedTrainingFocus = Exclude<TrainingFocusSetting, "auto">;

export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const nutritionSettingsSchema = z.object({
  mode: z.enum(["auto", "manual"]).default("auto"),
  manualKcal: z.number().min(1000).max(8000).nullable().default(null),
  weightGoal: z.enum(WEIGHT_GOALS).default("maintain"),
  targetWeightKg: z.number().min(30).max(250).nullable().default(null),
  trainingFocus: z.enum(TRAINING_FOCUSES).default("auto"),
  activityLevel: z.enum(ACTIVITY_LEVELS).default("sedentary"),
  /** Percentage of workout burn added to today's calorie budget (default 75%). */
  workoutEatBackPct: z.number().min(0).max(100).default(75),
  /** Direct RMR/BMR from a DEXA scan report, if available. */
  dexaBmrKcal: z.number().min(800).max(4500).nullable().default(null),
  /** Lean mass (kg) from a DEXA scan (used for Katch-McArdle BMR when dexaBmrKcal is unset). */
  dexaLeanMassKg: z.number().min(20).max(150).nullable().default(null),
  /** Trigger follow-up questions when kcalMax - kcalMin exceeds this delta. */
  uncertaintyThresholdKcal: z.number().int().min(50).max(1000).default(200),
  calorieAlertEnabled: z.boolean().default(true),
  calorieAlertPct: z.number().int().min(50).max(100).default(85),
  weighInReminderEnabled: z.boolean().default(true),
  /** 0 = Monday … 6 = Sunday */
  weighInReminderDay: weekday.default(6),
  weighInReminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM")
    .default("08:30"),
});
export type NutritionSettings = z.infer<typeof nutritionSettingsSchema>;

export const DEFAULT_NUTRITION_SETTINGS: NutritionSettings = nutritionSettingsSchema.parse({});

export const manualWeightSchema = z.object({
  measuredAt: z.iso.datetime({ offset: true }).optional(),
  weightKg: z.number().min(20).max(300),
  fatPct: z.number().min(2).max(70).nullable().optional(),
  bmrKcal: z.number().min(800).max(4500).nullable().optional(),
});
export type ManualWeight = z.infer<typeof manualWeightSchema>;

export const renphoCsvImportSchema = z.object({
  csv: z.string().min(10).max(2_000_000),
});
export type RenphoCsvImport = z.infer<typeof renphoCsvImportSchema>;

/** Phone health data (Android Health Connect) pushed by the native app. */
export const healthSyncSchema = z.object({
  source: z.enum(["health_connect"]),
  days: z
    .array(
      z.object({
        date: isoDate,
        steps: z.number().int().min(0).max(200_000).nullable(),
        restingHr: z.number().min(20).max(150).nullable(),
        hrv: z.number().min(1).max(300).nullable(),
        vo2max: z.number().min(10).max(100).nullable(),
      }),
    )
    .max(400),
  body: z
    .array(
      z.object({
        externalId: z.string().min(1).max(200),
        measuredAt: z.iso.datetime({ offset: true }),
        weightKg: z.number().min(20).max(300),
        fatPct: z.number().min(2).max(70).nullable(),
      }),
    )
    .max(2000),
});
export type HealthSync = z.infer<typeof healthSyncSchema>;
