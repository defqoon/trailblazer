import type { NutritionSettings } from "../schemas";
import type { DailyTargets } from "./targets";

export interface NutritionRecommendation {
  id: string;
  tone: "info" | "warn" | "success";
  title: string;
  body: string;
}

export interface DayTotals {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealCount: number;
}

export function computeRecommendations(params: {
  targets: DailyTargets;
  totals: DayTotals;
  settings: Pick<NutritionSettings, "calorieAlertEnabled" | "calorieAlertPct" | "weightGoal">;
}): NutritionRecommendation[] {
  const { targets, totals, settings } = params;
  const recs: NutritionRecommendation[] = [];

  const remainingKcal = targets.adjustedKcal - totals.kcal;
  const usedPct = targets.adjustedKcal > 0 ? (totals.kcal / targets.adjustedKcal) * 100 : 0;

  // 1. Calorie pacing / snacking control
  if (remainingKcal < 0) {
    recs.push({
      id: "over_budget",
      tone: "warn",
      title: `${Math.abs(Math.round(remainingKcal))} kcal over today's budget`,
      body: "No stress — one day won't derail a week. Skip extra snacks tonight and reset tomorrow.",
    });
  } else if (settings.calorieAlertEnabled && (usedPct >= settings.calorieAlertPct || remainingKcal <= 250)) {
    recs.push({
      id: "approaching_limit",
      tone: "warn",
      title: `Close to daily budget (${Math.round(remainingKcal)} kcal left)`,
      body: "Good moment to pause evening snacking or pick something light and high-protein (yogurt, fruit, tea).",
    });
  }

  // 2. Protein pacing
  const proteinLeft = Math.round(targets.macros.proteinG - totals.proteinG);
  if (totals.mealCount > 0 && proteinLeft >= 35 && remainingKcal > 0 && remainingKcal < proteinLeft * 12) {
    recs.push({
      id: "protein_priority",
      tone: "info",
      title: `${proteinLeft}g protein still to go`,
      body: "Make your next meal protein-forward (chicken, fish, eggs, tofu, Greek yogurt, or a protein shake) to hit target without overshooting calories.",
    });
  } else if (totals.mealCount > 0 && proteinLeft <= 10 && remainingKcal >= 0) {
    recs.push({
      id: "protein_hit",
      tone: "success",
      title: "Protein target on track",
      body: `You've logged ${Math.round(totals.proteinG)}g of ${targets.macros.proteinG}g protein today.`,
    });
  }

  // 3. Endurance fueling / workout recovery
  if (targets.workoutKcal >= 500) {
    const carbPct = targets.macros.carbsG > 0 ? totals.carbsG / targets.macros.carbsG : 1;
    if (carbPct < 0.65) {
      recs.push({
        id: "endurance_carbs",
        tone: "info",
        title: `Big session today (+${targets.workoutKcal} kcal)`,
        body: "Prioritize carbs (oats, rice, pasta, fruit) to refill glycogen and recover well for tomorrow.",
      });
    }
  }

  // 4. Fat floor check (only after meaningful intake)
  if (totals.kcal >= 1000 && totals.fatG < targets.macros.fatG * 0.45) {
    recs.push({
      id: "fat_floor",
      tone: "info",
      title: "Dietary fat is quite low today",
      body: "Include a small serving of healthy fats (olive oil, nuts, avocado, or oily fish) to support recovery and hormones.",
    });
  }

  return recs.slice(0, 3);
}
