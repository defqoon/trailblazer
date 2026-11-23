import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () => integer("id").primaryKey({ autoIncrement: true });
const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);

export const goals = sqliteTable("goals", {
  id: id(),
  /** Primary sport (the leg that takes the most time). */
  sport: text("sport").notNull().default("trail_run"),
  /** GoalLeg[]: one per sport, in race order. */
  legs: text("legs", { mode: "json" }).notNull().default([]),
  name: text("name").notNull(),
  eventDate: text("event_date").notNull(),
  /** Totals across legs. */
  distanceKm: real("distance_km").notNull(),
  elevationGainM: real("elevation_gain_m").notNull(),
  elevationLossM: real("elevation_loss_m"),
  targetTimeMin: real("target_time_min"),
  technicality: integer("technicality").notNull().default(1),
  priority: text("priority", { enum: ["finish", "perform"] }).notNull().default("finish"),
  terrainNotes: text("terrain_notes").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
});

/** Single row (id = 1); stored as validated JSON (`athleteProfileSchema`). */
export const athleteProfile = sqliteTable("athlete_profile", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).notNull(),
  createdAt: createdAt(),
  /** Set by the app on every write (nullable: SQLite can't ADD COLUMN with a computed default). */
  updatedAt: text("updated_at"),
});

export const plans = sqliteTable("plans", {
  id: id(),
  goalId: integer("goal_id")
    .notNull()
    .references(() => goals.id),
  status: text("status", { enum: ["draft", "active", "archived"] }).notNull().default("draft"),
  startDate: text("start_date").notNull(),
  /** The PlanRequest (goal + profile snapshot) the plan was generated from. */
  request: text("request", { mode: "json" }).notNull().default({}),
  /** PlanSummary: event estimate, peaks, phases, warnings. */
  summary: text("summary", { mode: "json" }).notNull().default({}),
  engineVersion: integer("engine_version").notNull().default(1),
  createdAt: createdAt(),
});

export const planWeeks = sqliteTable(
  "plan_weeks",
  {
    id: id(),
    planId: integer("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    phase: text("phase").notNull(),
    isRecovery: integer("is_recovery", { mode: "boolean" }).notNull().default(false),
    targetHours: real("target_hours").notNull(),
    targetVerticalM: real("target_vertical_m").notNull(),
    targetLongMin: real("target_long_min").notNull(),
    sports: text("sports", { mode: "json" }).$type<string[]>().notNull().default([]),
    goalSportShare: real("goal_sport_share").notNull().default(1),
    /** Newline-separated coaching notes for the week. */
    notes: text("notes").notNull().default(""),
  },
  (t) => [uniqueIndex("plan_weeks_plan_week").on(t.planId, t.weekStart)],
);

export const plannedWorkouts = sqliteTable(
  "planned_workouts",
  {
    id: id(),
    planWeekId: integer("plan_week_id")
      .notNull()
      .references(() => planWeeks.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    sport: text("sport").notNull(),
    type: text("type").notNull(), // easy, long, vert_intervals, tempo, strength, back_to_back, ...
    title: text("title").notNull(),
    durationMin: real("duration_min").notNull(),
    distanceKm: real("distance_km"),
    verticalM: real("vertical_m"),
    intensity: text("intensity"), // Z1–Z5 / RPE
    description: text("description").notNull().default(""),
    steps: text("steps", { mode: "json" }).notNull().default([]),
    key: integer("key", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["planned", "done", "partial", "skipped"] })
      .notNull()
      .default("planned"),
  },
  (t) => [index("planned_workouts_date").on(t.date)],
);

export const activities = sqliteTable(
  "activities",
  {
    id: id(),
    source: text("source").notNull(), // strava | garmin | manual
    externalId: text("external_id").notNull(),
    startTime: text("start_time").notNull(),
    sport: text("sport").notNull(),
    name: text("name").notNull().default(""),
    movingTimeS: integer("moving_time_s").notNull(),
    elapsedTimeS: integer("elapsed_time_s").notNull(),
    distanceM: real("distance_m").notNull().default(0),
    elevationGainM: real("elevation_gain_m").notNull().default(0),
    elevationLossM: real("elevation_loss_m"),
    avgHr: real("avg_hr"),
    maxHr: real("max_hr"),
    kcal: real("kcal"),
    load: real("load"),
    polyline: text("polyline"),
    plannedWorkoutId: integer("planned_workout_id").references(() => plannedWorkouts.id, {
      onDelete: "set null",
    }),
    raw: text("raw", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("activities_source_ext").on(t.source, t.externalId),
    index("activities_start").on(t.startTime),
  ],
);

export const dailyMetrics = sqliteTable("daily_metrics", {
  date: text("date").primaryKey(),
  steps: integer("steps"),
  restingHr: real("resting_hr"),
  hrv: real("hrv"),
  sleepMin: real("sleep_min"),
  vo2maxRun: real("vo2max_run"),
  vo2maxBike: real("vo2max_bike"),
  readiness: real("readiness"),
  activeKcal: real("active_kcal"),
  createdAt: createdAt(),
  /** Set by the app on every write (nullable: SQLite can't ADD COLUMN with a computed default). */
  updatedAt: text("updated_at"),
});

export const bodyMeasurements = sqliteTable(
  "body_measurements",
  {
    id: id(),
    source: text("source").notNull(), // renpho | manual | csv
    externalId: text("external_id"),
    measuredAt: text("measured_at").notNull(),
    weightKg: real("weight_kg").notNull(),
    fatPct: real("fat_pct"),
    muscleKg: real("muscle_kg"),
    waterPct: real("water_pct"),
    bmrKcal: real("bmr_kcal"),
  },
  (t) => [
    uniqueIndex("body_source_ext").on(t.source, t.externalId),
    index("body_measured").on(t.measuredAt),
  ],
);

export const dexaScans = sqliteTable("dexa_scans", {
  id: id(),
  scanDate: text("scan_date").notNull(),
  status: text("status", { enum: ["processing", "review", "confirmed", "failed"] })
    .notNull()
    .default("processing"),
  r2Key: text("r2_key").notNull(),
  totalFatPct: real("total_fat_pct"),
  fatMassKg: real("fat_mass_kg"),
  leanMassKg: real("lean_mass_kg"),
  boneMassKg: real("bone_mass_kg"),
  visceralFatG: real("visceral_fat_g"),
  boneDensityTScore: real("bmd_t_score"),
  regions: text("regions", { mode: "json" }), // { arms, legs, trunk, android, gynoid: {fatKg, leanKg} }
  extracted: text("extracted", { mode: "json" }),
  createdAt: createdAt(),
});

export const foodEntries = sqliteTable(
  "food_entries",
  {
    id: id(),
    eatenAt: text("eaten_at").notNull(),
    meal: text("meal"), // breakfast | lunch | dinner | snack | during_activity
    description: text("description").notNull().default(""),
    photoKey: text("photo_key"),
    items: text("items", { mode: "json" }),
    kcal: real("kcal").notNull(),
    proteinG: real("protein_g").notNull(),
    carbsG: real("carbs_g").notNull(),
    fatG: real("fat_g").notNull(),
    confidence: text("confidence"),
    userCorrected: integer("user_corrected", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("food_eaten").on(t.eatenAt)],
);

export const chatThreads = sqliteTable("chat_threads", {
  id: id(),
  title: text("title").notNull().default("New chat"),
  createdAt: createdAt(),
});

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: id(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content", { mode: "json" }).notNull(), // Anthropic content blocks
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_thread").on(t.threadId)],
);

/** OAuth tokens, AES-GCM encrypted with TOKEN_ENC_KEY. */
export const integrationTokens = sqliteTable("integration_tokens", {
  provider: text("provider").primaryKey(), // strava | garmin | renpho
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  status: text("status").notNull().default("ok"), // ok | error
  lastError: text("last_error"),
  lastSyncAt: text("last_sync_at"),
  createdAt: createdAt(),
  /** Set by the app on every write (nullable: SQLite can't ADD COLUMN with a computed default). */
  updatedAt: text("updated_at"),
});
