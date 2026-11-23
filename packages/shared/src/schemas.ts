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

export const foodEstimateSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      grams: z.number().nonnegative(),
      kcal: z.number().nonnegative(),
      proteinG: z.number().nonnegative(),
      carbsG: z.number().nonnegative(),
      fatG: z.number().nonnegative(),
    }),
  ),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.string().default(""),
});
export type FoodEstimate = z.infer<typeof foodEstimateSchema>;

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
