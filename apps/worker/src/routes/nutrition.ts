import {
  athleteProfileSchema,
  computeBmr,
  computeDailyTargets,
  computeRecommendations,
  computeWeightTrend,
  DEFAULT_NUTRITION_SETTINGS,
  detectTrainingFocus,
  estimateWorkoutKcal,
  nutritionSettingsSchema,
  type FoodEntryDto,
  type FoodItem,
  type MealType,
  type NutritionDayDto,
  type NutritionDayWorkoutDto,
  type NutritionSettings,
  type WorkoutStatus,
} from "@trailblazer/shared";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Hono } from "hono";
import {
  activities,
  athleteProfile,
  bodyMeasurements,
  dailyMetrics,
  dexaScans,
  foodEntries,
  goals,
  nutritionSettings,
  plannedWorkouts,
  plans,
} from "../db/schema";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { parseBody } from "../lib/validate";

export const nutritionRoutes = new Hono<AppEnv>();

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextIsoDate(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function loadSettings(d1: D1Database): Promise<NutritionSettings> {
  const row = await getDb(d1).select().from(nutritionSettings).where(eq(nutritionSettings.id, 1)).get();
  if (!row) return DEFAULT_NUTRITION_SETTINGS;
  const parsed = nutritionSettingsSchema.safeParse(row.data);
  return parsed.success ? parsed.data : DEFAULT_NUTRITION_SETTINGS;
}

nutritionRoutes.get("/nutrition/settings", async (c) => {
  return c.json({ settings: await loadSettings(c.env.DB) });
});

nutritionRoutes.put("/nutrition/settings", async (c) => {
  const body = await parseBody(c, nutritionSettingsSchema);
  if (!body.ok) return body.res;
  const now = new Date().toISOString();
  await getDb(c.env.DB)
    .insert(nutritionSettings)
    .values({ id: 1, data: body.data, updatedAt: now })
    .onConflictDoUpdate({
      target: nutritionSettings.id,
      set: { data: body.data, updatedAt: now },
    });
  return c.json({ settings: body.data });
});

nutritionRoutes.get("/nutrition/day", async (c) => {
  const dateParam = c.req.query("date");
  const date = dateParam && ISO_DATE_RE.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);
  const startIso = `${date}T00:00:00.000Z`;
  const endIso = `${nextIsoDate(date)}T00:00:00.000Z`;
  const weightSinceIso = new Date(Date.now() - 45 * 86_400_000).toISOString();

  const db = getDb(c.env.DB);

  const [
    settings,
    profileRow,
    latestDexa,
    recentWeights,
    activePlan,
    todayActivities,
    todayMetric,
    todayPlanned,
    todayFood,
  ] = await Promise.all([
    loadSettings(c.env.DB),
    db.select().from(athleteProfile).where(eq(athleteProfile.id, 1)).get(),
    db
      .select()
      .from(dexaScans)
      .where(eq(dexaScans.status, "confirmed"))
      .orderBy(desc(dexaScans.scanDate))
      .limit(1)
      .get(),
    db
      .select()
      .from(bodyMeasurements)
      .where(gte(bodyMeasurements.measuredAt, weightSinceIso))
      .orderBy(desc(bodyMeasurements.measuredAt))
      .limit(120),
    db.select().from(plans).where(eq(plans.status, "active")).orderBy(desc(plans.id)).limit(1).get(),
    db
      .select()
      .from(activities)
      .where(and(gte(activities.startTime, startIso), lt(activities.startTime, endIso))),
    db.select().from(dailyMetrics).where(eq(dailyMetrics.date, date)).get(),
    db.select().from(plannedWorkouts).where(eq(plannedWorkouts.date, date)),
    db
      .select()
      .from(foodEntries)
      .where(and(gte(foodEntries.eatenAt, startIso), lt(foodEntries.eatenAt, endIso)))
      .orderBy(foodEntries.eatenAt),
  ]);

  const profileParsed = profileRow ? athleteProfileSchema.safeParse(profileRow.data) : null;
  const profile = profileParsed?.success ? profileParsed.data : null;

  const activeGoal = activePlan
    ? await db.select().from(goals).where(eq(goals.id, activePlan.goalId)).get()
    : null;

  const latestBody = recentWeights[0] ?? null;
  const weightKg = latestBody?.weightKg ?? profile?.weightKg ?? 72;

  const bmr = computeBmr({
    settings,
    dexaScan: latestDexa ?? null,
    latestBody,
    profile,
  });

  const trainingFocus = detectTrainingFocus(settings.trainingFocus, {
    goalSport: activeGoal?.sport ?? null,
    strengthPerWeek: profile?.workouts.strengthPerWeek ?? null,
    weeklyEnduranceHours: profile?.current.weeklyHours ?? null,
  });

  const workouts: NutritionDayWorkoutDto[] = todayActivities.map((a) => {
    const estimated = a.kcal == null || a.kcal <= 0;
    const kcal = estimated ? estimateWorkoutKcal(a.sport, a.movingTimeS, weightKg) : Math.round(a.kcal!);
    return {
      id: a.id,
      source: a.source,
      name: a.name || a.sport,
      sport: a.sport,
      movingTimeS: a.movingTimeS,
      kcal,
      estimated,
    };
  });

  const activitiesKcal = workouts.reduce((s, w) => s + w.kcal, 0);
  const metricActiveKcal = todayMetric?.activeKcal ? Math.round(todayMetric.activeKcal) : 0;
  // Avoid double-counting if both Strava activities and Health Connect activeKcal are present
  const workoutKcal = Math.max(activitiesKcal, metricActiveKcal);

  const targets = computeDailyTargets({
    settings,
    bmr,
    weightKg,
    trainingFocus,
    workoutKcal,
  });

  const entries: FoodEntryDto[] = todayFood.map((row) => ({
    id: row.id,
    eatenAt: row.eatenAt,
    meal: (row.meal as MealType | null) ?? null,
    description: row.description,
    photoKey: row.photoKey ?? null,
    items: Array.isArray(row.items) ? (row.items as FoodItem[]) : [],
    kcal: row.kcal,
    kcalMin: row.kcalMin ?? null,
    kcalMax: row.kcalMax ?? null,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    confidence: (row.confidence as "low" | "medium" | "high" | null) ?? null,
    userCorrected: Boolean(row.userCorrected),
    createdAt: row.createdAt,
  }));

  const totals = {
    kcal: Math.round(entries.reduce((s, e) => s + e.kcal, 0)),
    proteinG: Math.round(entries.reduce((s, e) => s + e.proteinG, 0) * 10) / 10,
    carbsG: Math.round(entries.reduce((s, e) => s + e.carbsG, 0) * 10) / 10,
    fatG: Math.round(entries.reduce((s, e) => s + e.fatG, 0) * 10) / 10,
    mealCount: entries.length,
  };

  const remainingKcal = targets.adjustedKcal - totals.kcal;
  const usedPct = targets.adjustedKcal > 0 ? (totals.kcal / targets.adjustedKcal) * 100 : 0;
  const alertTriggered =
    settings.calorieAlertEnabled &&
    totals.mealCount > 0 &&
    (usedPct >= settings.calorieAlertPct || remainingKcal <= 250);

  const recommendations = computeRecommendations({ targets, totals, settings });
  const weightTrend = computeWeightTrend(
    recentWeights.map((w) => ({
      measuredAt: w.measuredAt,
      weightKg: w.weightKg,
      fatPct: w.fatPct,
      source: w.source,
    })),
    settings.weightGoal,
  );

  return c.json({
    date,
    settings,
    targets,
    totals,
    remainingKcal,
    alertTriggered,
    workouts,
    plannedToday: todayPlanned.map((w) => ({
      id: w.id,
      title: w.title,
      sport: w.sport,
      durationMin: w.durationMin,
      status: w.status as WorkoutStatus,
    })),
    entries,
    recommendations,
    weightTrend,
  } satisfies NutritionDayDto);
});
