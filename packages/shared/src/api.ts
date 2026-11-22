import type { AthleteProfile, Goal, Phase, WorkoutStep, WorkoutType } from "./schemas";
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
