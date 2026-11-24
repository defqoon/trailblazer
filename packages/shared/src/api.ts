import type {
  AthleteProfile,
  FoodEstimate,
  FoodItem,
  Goal,
  MealType,
  NutritionSettings,
  Phase,
  WorkoutStep,
  WorkoutType,
} from "./schemas";
import type { DailyTargets, DayTotals, NutritionRecommendation, WeightTrendSummary } from "./nutrition";
import type { PlanSummary } from "./plan/periodization";
import type { Sport } from "./sports";

export type WorkoutStatus = "planned" | "done" | "partial" | "skipped";

export interface WorkoutDto {
  id: number;
  date: string;
  sport: Sport;
  type: WorkoutType;
  title: string;
  durationMin: number;
  distanceKm: number | null;
  verticalM: number | null;
  intensity: string | null;
  description: string;
  steps: WorkoutStep[];
  key: boolean;
  status: WorkoutStatus;
}

export interface WeekDto {
  id: number;
  index: number;
  weekStart: string;
  phase: Phase;
  isRecovery: boolean;
  targetHours: number;
  targetVerticalM: number;
  targetLongMin: number;
  sports: Sport[];
  notes: string[];
  workouts: WorkoutDto[];
}

export interface CurrentPlanDto {
  plan: { id: number; startDate: string; createdAt: string; summary: PlanSummary } | null;
  goal: (Goal & { id: number }) | null;
  weeks: WeekDto[];
  /** Last saved profile, used to prefill the wizard. */
  profile: AthleteProfile | null;
}

export interface FoodEntryDto {
  id: number;
  eatenAt: string;
  meal: MealType | null;
  description: string;
  photoKey: string | null;
  items: FoodItem[];
  kcal: number;
  kcalMin: number | null;
  kcalMax: number | null;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: "low" | "medium" | "high" | null;
  userCorrected: boolean;
  createdAt: string;
}

export interface FoodEstimateResponseDto {
  photoKey: string | null;
  provider: "gemini";
  model: string;
  estimate: FoodEstimate;
}

export interface NutritionDayWorkoutDto {
  id: number;
  source: string;
  name: string;
  sport: string;
  movingTimeS: number;
  kcal: number;
  estimated: boolean;
}

export interface NutritionDayDto {
  date: string;
  settings: NutritionSettings;
  targets: DailyTargets;
  totals: DayTotals;
  remainingKcal: number;
  alertTriggered: boolean;
  workouts: NutritionDayWorkoutDto[];
  plannedToday: Array<{ id: number; title: string; sport: string; durationMin: number; status: WorkoutStatus }>;
  entries: FoodEntryDto[];
  recommendations: NutritionRecommendation[];
  weightTrend: WeightTrendSummary;
}
