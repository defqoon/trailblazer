import {
  athleteProfileSchema,
  buildPlan,
  goalSchema,
  goalTotals,
  planRequestSchema,
  workoutStatusSchema,
  type AthleteProfile,
  type CurrentPlanDto,
  type Goal,
  type PlanSummary,
  type WeekDto,
  type WorkoutDto,
} from "@trailblazer/shared";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { athleteProfile, goals, plannedWorkouts, plans, planWeeks } from "../db/schema";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { parseBody } from "../lib/validate";

export const ENGINE_VERSION = 1;

export const planRoutes = new Hono<AppEnv>();

async function loadProfile(d1: D1Database): Promise<AthleteProfile | null> {
  const row = await getDb(d1).select().from(athleteProfile).where(eq(athleteProfile.id, 1)).get();
  if (!row) return null;
  const parsed = athleteProfileSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

planRoutes.get("/profile", async (c) => c.json({ profile: await loadProfile(c.env.DB) }));

planRoutes.get("/plan/current", async (c) => {
  const db = getDb(c.env.DB);
  const profile = await loadProfile(c.env.DB);
  const plan = await db.select().from(plans).where(eq(plans.status, "active")).orderBy(desc(plans.id)).get();
  if (!plan) return c.json({ plan: null, goal: null, weeks: [], profile } satisfies CurrentPlanDto);

  const goal = await db.select().from(goals).where(eq(goals.id, plan.goalId)).get();
  const weekRows = await db.select().from(planWeeks).where(eq(planWeeks.planId, plan.id)).orderBy(asc(planWeeks.weekStart));
  const workoutRows = weekRows.length
    ? await db
        .select()
        .from(plannedWorkouts)
        .where(inArray(plannedWorkouts.planWeekId, weekRows.map((w) => w.id)))
        .orderBy(asc(plannedWorkouts.date), asc(plannedWorkouts.id))
    : [];

  const byWeek = new Map<number, WorkoutDto[]>();
  for (const w of workoutRows) {
    const list = byWeek.get(w.planWeekId) ?? [];
    list.push({
      id: w.id,
      date: w.date,
      sport: w.sport as WorkoutDto["sport"],
      type: w.type as WorkoutDto["type"],
      title: w.title,
      durationMin: w.durationMin,
      distanceKm: w.distanceKm,
      verticalM: w.verticalM,
      intensity: w.intensity,
      description: w.description,
      steps: w.steps as WorkoutDto["steps"],
      key: w.key,
      status: w.status,
    });
    byWeek.set(w.planWeekId, list);
  }

  const weeks: WeekDto[] = weekRows.map((w, index) => ({
    id: w.id,
    index,
    weekStart: w.weekStart,
    phase: w.phase as WeekDto["phase"],
    isRecovery: w.isRecovery,
    targetHours: w.targetHours,
    targetVerticalM: w.targetVerticalM,
    targetLongMin: w.targetLongMin,
    sports: w.sports as WeekDto["sports"],
    notes: w.notes ? w.notes.split("\n") : [],
    workouts: byWeek.get(w.id) ?? [],
  }));

  return c.json({
    plan: { id: plan.id, startDate: plan.startDate, createdAt: plan.createdAt, summary: plan.summary as PlanSummary },
    goal: goal ? toGoalDto(goal) : null,
    weeks,
    profile,
  } satisfies CurrentPlanDto);
});

function toGoalDto(row: typeof goals.$inferSelect): Goal & { id: number } {
  const parsed = goalSchema.safeParse({
    name: row.name,
    eventDate: row.eventDate,
    legs: row.legs,
    targetTimeMin: row.targetTimeMin,
    technicality: row.technicality,
    priority: row.priority,
  });
  if (parsed.success) return { id: row.id, ...parsed.data };
  // Goals saved before multisport legs existed: rebuild a single leg from the totals.
  return {
    id: row.id,
    name: row.name,
    eventDate: row.eventDate,
    legs: [{ sport: row.sport as Goal["legs"][number]["sport"], distanceKm: row.distanceKm, elevationGainM: row.elevationGainM, elevationLossM: row.elevationLossM }],
    targetTimeMin: row.targetTimeMin,
    technicality: row.technicality as Goal["technicality"],
    priority: row.priority,
  };
}

planRoutes.post("/plan", async (c) => {
  const body = await parseBody(c, planRequestSchema);
  if (!body.ok) return body.res;
  const req = body.data;
  if (req.goal.eventDate <= req.startDate) return c.json({ error: "The event must be after the start date." }, 400);

  let built: ReturnType<typeof buildPlan>;
  try {
    built = buildPlan(req);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Could not build plan" }, 400);
  }

  const db = getDb(c.env.DB);
  const { goal, profile } = req;

  // 1. Archive the previous plan/goal, save the new goal + profile.
  await db.batch([
    db.update(plans).set({ status: "archived" }).where(eq(plans.status, "active")),
    db.update(goals).set({ active: false }).where(eq(goals.active, true)),
    db
      .insert(athleteProfile)
      .values({ id: 1, data: profile })
      .onConflictDoUpdate({ target: athleteProfile.id, set: { data: profile, updatedAt: new Date().toISOString() } }),
  ]);
  const goalRow = await db
    .insert(goals)
    .values({
      sport: built.summary.primarySport,
      legs: goal.legs,
      name: goal.name,
      eventDate: goal.eventDate,
      ...goalTotals(goal),
      elevationLossM: goal.legs.length === 1 ? goal.legs[0]!.elevationLossM : null,
      targetTimeMin: goal.targetTimeMin,
      technicality: goal.technicality,
      priority: goal.priority,
    })
    .returning({ id: goals.id })
    .get();
  const planRow = await db
    .insert(plans)
    .values({
      goalId: goalRow.id,
      status: "active",
      startDate: req.startDate,
      request: req,
      summary: built.summary,
      engineVersion: ENGINE_VERSION,
    })
    .returning({ id: plans.id })
    .get();

  // 2. Bulk insert weeks + workouts with json_each: two statements regardless of plan length.
  const weeksJson = JSON.stringify(
    built.weeks.map((w) => ({ ...w, notes: w.notes.join("\n"), isRecovery: w.isRecovery ? 1 : 0 })),
  );
  const workoutsJson = JSON.stringify(
    built.weeks.flatMap((w, i) =>
      (built.workouts[i] ?? []).map((wo) => ({ ...wo, weekStart: w.weekStart, key: wo.key ? 1 : 0 })),
    ),
  );
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO plan_weeks (plan_id, week_start, phase, is_recovery, target_hours, target_vertical_m, target_long_min, sports, goal_sport_share, notes)
         SELECT ?1, j.value->>'weekStart', j.value->>'phase', j.value->>'isRecovery', j.value->>'targetHours',
                j.value->>'targetVerticalM', j.value->>'targetLongMin', json(j.value->'sports'), j.value->>'goalSportShare', j.value->>'notes'
         FROM json_each(?2) j`,
      ).bind(planRow.id, weeksJson),
      c.env.DB.prepare(
        `INSERT INTO planned_workouts (plan_week_id, date, sport, type, title, duration_min, distance_km, vertical_m, intensity, description, steps, key)
         SELECT pw.id, j.value->>'date', j.value->>'sport', j.value->>'type', j.value->>'title', j.value->>'durationMin',
                j.value->>'distanceKm', j.value->>'verticalM', j.value->>'intensity', j.value->>'description', json(j.value->'steps'), j.value->>'key'
         FROM json_each(?2) j
         JOIN plan_weeks pw ON pw.plan_id = ?1 AND pw.week_start = j.value->>'weekStart'`,
      ).bind(planRow.id, workoutsJson),
    ]);
  } catch (err) {
    await db.delete(plans).where(eq(plans.id, planRow.id));
    throw err;
  }

  return c.json({ id: planRow.id }, 201);
});

planRoutes.delete("/plan/current", async (c) => {
  const db = getDb(c.env.DB);
  await db.batch([
    db.update(plans).set({ status: "archived" }).where(eq(plans.status, "active")),
    db.update(goals).set({ active: false }).where(eq(goals.active, true)),
  ]);
  return c.json({ ok: true });
});

planRoutes.patch("/workouts/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "bad id" }, 400);
  const body = await parseBody(c, z.object({ status: workoutStatusSchema }));
  if (!body.ok) return body.res;
  const db = getDb(c.env.DB);
  const updated = await db
    .update(plannedWorkouts)
    .set({ status: body.data.status })
    .where(eq(plannedWorkouts.id, id))
    .returning({ id: plannedWorkouts.id })
    .get();
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});
