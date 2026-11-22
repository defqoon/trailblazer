import { goalSports, type AthleteProfile, type Goal, type GoalLeg, type Phase, type WeekSkeleton } from "../schemas";
import { ENDURANCE_SPORTS, SPORT_LABELS, VERTICAL_SPORTS, type GoalSport, type Sport } from "../sports";
import { addDays, diffDays, inSeason, mondayOf } from "./dates";

type Experience = AthleteProfile["experience"];

/** Minutes per "effort-km" (km + climbing/divisor; ITRA-style for foot sports). */
const EFFORT_PACE: Record<GoalSport, Record<Experience, number>> = {
  trail_run: { beginner: 8.5, intermediate: 6.5, advanced: 5 },
  road_run: { beginner: 7, intermediate: 5.75, advanced: 4.75 },
  hike: { beginner: 12, intermediate: 10, advanced: 8.5 },
  mountaineering: { beginner: 14, intermediate: 12, advanced: 10 },
  ski_touring: { beginner: 8, intermediate: 6.5, advanced: 5 },
  bike: { beginner: 2.5, intermediate: 2.1, advanced: 1.8 },
  swim: { beginner: 30, intermediate: 24, advanced: 19 },
  paddle: { beginner: 12, intermediate: 10, advanced: 8 },
};
/** Metres of climbing that cost as much as 1 km of distance (Infinity = climbing ignored). */
const CLIMB_DIVISOR: Record<GoalSport, number> = {
  trail_run: 100,
  road_run: 100,
  hike: 100,
  mountaineering: 100,
  ski_touring: 100,
  bike: 25,
  swim: Infinity,
  paddle: Infinity,
};
const TECHNICAL_SPORTS: readonly GoalSport[] = ["trail_run", "hike", "mountaineering", "ski_touring"];
const TECHNICALITY_FACTOR = { 1: 1, 2: 1.05, 3: 1.15 } as const;
const TRANSITION_MIN = 5;

function legMinutesRaw(leg: GoalLeg, experience: Experience, technicality: Goal["technicality"]): number {
  const effortKm = leg.distanceKm + leg.elevationGainM / CLIMB_DIVISOR[leg.sport];
  const tech = TECHNICAL_SPORTS.includes(leg.sport) ? TECHNICALITY_FACTOR[technicality] : 1;
  return effortKm * EFFORT_PACE[leg.sport][experience] * tech;
}

/** Estimated minutes per leg (scaled to the target time if one is given). */
export function estimateLegMinutes(goal: Goal, experience: Experience): { sport: GoalSport; minutes: number }[] {
  const raw = goal.legs.map((l) => legMinutesRaw(l, experience, goal.technicality));
  const transitions = TRANSITION_MIN * (goal.legs.length - 1);
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = goal.targetTimeMin && total > 0 ? Math.max(0, goal.targetTimeMin - transitions) / total : 1;
  return goal.legs.map((l, i) => ({ sport: l.sport, minutes: Math.round(raw[i]! * scale) }));
}

/** Estimated event duration in minutes (target time wins if given). */
export function estimateEventMinutes(goal: Goal, experience: Experience): number {
  if (goal.targetTimeMin) return goal.targetTimeMin;
  const legs = estimateLegMinutes(goal, experience);
  return legs.reduce((a, l) => a + l.minutes, 0) + TRANSITION_MIN * (goal.legs.length - 1);
}

/** The leg that takes the most time drives the plan's cross-training choices. */
export function primarySport(goal: Goal, experience: Experience): GoalSport {
  const legs = estimateLegMinutes(goal, experience);
  return legs.reduce((best, l) => (l.minutes > best.minutes ? l : best), legs[0]!).sport;
}

const PEAK_BASE_HOURS: Record<Experience, number> = { beginner: 4, intermediate: 6, advanced: 9 };
const RAMP: Record<Experience, number> = { beginner: 0.06, intermediate: 0.08, advanced: 0.1 };
const PHASE_HOURS_CEIL: Record<Phase, number> = { base: 0.7, build: 0.88, specific: 1, taper: 1 };
const PHASE_LONG_CEIL: Record<Phase, number> = { base: 0.65, build: 0.85, specific: 1, taper: 1 };
const PHASE_VERT_FACTOR: Record<Phase, number> = { base: 0.55, build: 0.8, specific: 1, taper: 0.8 };

/** Cross-training preference per primary goal sport (best transfer first). */
export const CROSS_PREFERENCE: Record<GoalSport, Sport[]> = {
  trail_run: ["trail_run", "ski_touring", "hike", "mountaineering", "road_run", "nordic_ski", "bike", "paddle", "swim"],
  road_run: ["road_run", "trail_run", "nordic_ski", "bike", "ski_touring", "hike", "mountaineering", "swim", "paddle"],
  hike: ["hike", "mountaineering", "trail_run", "ski_touring", "road_run", "nordic_ski", "bike", "paddle", "swim"],
  mountaineering: ["mountaineering", "hike", "ski_touring", "trail_run", "road_run", "nordic_ski", "bike", "paddle", "swim"],
  ski_touring: ["ski_touring", "trail_run", "hike", "mountaineering", "nordic_ski", "road_run", "bike", "paddle", "swim"],
  bike: ["bike", "road_run", "trail_run", "nordic_ski", "ski_touring", "hike", "mountaineering", "swim", "paddle"],
  swim: ["swim", "paddle", "road_run", "bike", "nordic_ski", "trail_run", "hike", "ski_touring", "mountaineering"],
  paddle: ["paddle", "swim", "nordic_ski", "bike", "road_run", "trail_run", "hike", "ski_touring", "mountaineering"],
};

export interface PlanSummary {
  totalWeeks: number;
  eventMinutes: number;
  legs: { sport: GoalSport; minutes: number }[];
  primarySport: GoalSport;
  peakHours: number;
  peakVerticalM: number;
  peakLongMin: number;
  phases: { phase: Phase; weeks: number }[];
  warnings: string[];
}

export interface Skeleton {
  summary: PlanSummary;
  weeks: WeekSkeleton[];
}

const label = (s: Sport) => SPORT_LABELS[s].toLowerCase();
const round = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Endurance sports in season for the whole week starting `weekStart`: goal sports first, then by transfer. */
function sportsAvailable(profile: AthleteProfile, goal: Goal, primary: GoalSport, weekStart: string): Sport[] {
  const listed = new Map<Sport, boolean>();
  for (const w of profile.sports) {
    const ok = [0, 1, 2, 3, 4, 5, 6].every((d) => inSeason(addDays(weekStart, d), w.from, w.to));
    listed.set(w.sport, (listed.get(w.sport) ?? false) || ok);
  }
  for (const s of goalSports(goal)) if (!listed.has(s)) listed.set(s, true); // goal sports without a window = all year
  const goalOrder = goalSports(goal);
  const pref = CROSS_PREFERENCE[primary];
  const rank = (s: Sport) => (goalOrder.includes(s as GoalSport) ? goalOrder.indexOf(s as GoalSport) - 100 : pref.indexOf(s));
  return [...listed.entries()]
    .filter(([s, ok]) => ok && (ENDURANCE_SPORTS as readonly string[]).includes(s))
    .map(([s]) => s)
    .sort((a, b) => rank(a) - rank(b));
}

function phaseLengths(totalWeeks: number, eventMinutes: number) {
  const taper = eventMinutes >= 240 && totalWeeks >= 10 ? 2 : 1;
  const rest = totalWeeks - taper;
  const specific = clamp(Math.round(rest * 0.3), Math.min(2, rest), 8);
  const build = clamp(Math.round(rest * 0.35), Math.min(1, rest - specific), 10);
  const base = rest - specific - build;
  return { base, build, specific, taper };
}

export function buildSkeleton(goal: Goal, profile: AthleteProfile, startDate: string): Skeleton {
  const warnings: string[] = [];
  const firstMonday = mondayOf(startDate);
  const raceMonday = mondayOf(goal.eventDate);
  const totalWeeks = diffDays(firstMonday, raceMonday) / 7 + 1;
  if (totalWeeks < 4) throw new Error("The event needs to be at least 4 weeks away to build a plan.");
  if (totalWeeks > 78) throw new Error("The event is more than 18 months away. Pick a closer goal.");

  const exp = profile.experience;
  const eventMinutes = estimateEventMinutes(goal, exp);
  const eventHours = eventMinutes / 60;
  const legs = estimateLegMinutes(goal, exp);
  const primary = primarySport(goal, exp);
  const goalSet = goalSports(goal);
  const running = (s: Sport) => s === "trail_run" || s === "road_run";

  // ---- volume targets -------------------------------------------------------
  const wantedPeak = PEAK_BASE_HOURS[exp] + Math.min(eventHours, 10) * 0.6;
  let peakHours = Math.min(profile.availability.maxWeeklyHours, Math.max(wantedPeak, profile.current.weeklyHours));
  peakHours = round(peakHours, 0.5);
  if (wantedPeak > profile.availability.maxWeeklyHours + 1) {
    warnings.push(
      `For this event we'd suggest peaking around ${round(wantedPeak, 0.5)} h/week; your cap of ${profile.availability.maxWeeklyHours} h limits that. Long days and vertical will carry more of the load.`,
    );
  }
  const startHours = clamp(profile.current.weeklyHours || 2.5, 2, peakHours);

  const peakLongMin = round(clamp(eventMinutes * (eventMinutes <= 180 ? 0.9 : 0.6), 45, 390), 5);
  const startLong = clamp(profile.current.longestSessionMin || 45, 40, peakLongMin);
  const longStep = eventMinutes > 240 ? 20 : 15;

  const verticalGain = goal.legs.filter((l) => VERTICAL_SPORTS.includes(l.sport)).reduce((a, l) => a + l.elevationGainM, 0);
  const density = clamp(verticalGain / Math.max(eventHours, 0.5), 0, 650);

  const maxSessions = profile.availability.days.length;
  const startSessions = clamp(profile.current.sessionsPerWeek || 2, 2, maxSessions);

  // ---- phases & recovery cadence ------------------------------------------
  const lengths = phaseLengths(totalWeeks, eventMinutes);
  const phaseOf = (i: number): Phase =>
    i < lengths.base
      ? "base"
      : i < lengths.base + lengths.build
        ? "build"
        : i < totalWeeks - lengths.taper
          ? "specific"
          : "taper";
  const cycle = exp === "beginner" || profile.age >= 50 ? 3 : 4;
  const lastLoadWeek = totalWeeks - lengths.taper - 1;
  const isRecoveryWeek = (i: number) => i > 0 && i < lastLoadWeek && phaseOf(i) !== "taper" && (i + 1) % cycle === 0;

  // ---- walk the weeks -------------------------------------------------------
  const weeks: WeekSkeleton[] = [];
  let prevHours = startHours / (1 + RAMP[exp]);
  let prevLong = startLong - longStep;
  let lastLoadHours = startHours;
  let lastLoadLong = startLong;
  let primaryGap = 0;
  let prevSessions = 0;
  let reintroLeft = 0;
  const phaseWeekIdx: Record<Phase, number> = { base: 0, build: 0, specific: 0, taper: 0 };

  for (let i = 0; i < totalWeeks; i++) {
    const weekStart = addDays(firstMonday, i * 7);
    const phase = phaseOf(i);
    const recovery = isRecoveryWeek(i);
    const notes: string[] = [];
    phaseWeekIdx[phase]++;

    let hours: number;
    let longMin: number;
    if (phase === "taper") {
      const taperIdx = i - (totalWeeks - lengths.taper); // 0-based
      const factors = lengths.taper === 2 ? [0.7, 0.3] : [0.35];
      hours = lastLoadHours * (factors[taperIdx] ?? 0.4);
      longMin = taperIdx === lengths.taper - 1 ? 0 : lastLoadLong * 0.6;
      notes.push(taperIdx === lengths.taper - 1 ? "Race week: stay fresh, sharpen, sleep." : "Taper: volume drops, keep some intensity.");
    } else if (recovery) {
      hours = lastLoadHours * 0.65;
      longMin = lastLoadLong * 0.7;
      notes.push("Recovery week: absorb the training.");
    } else {
      const ceil = Math.max(PHASE_HOURS_CEIL[phase] * peakHours, Math.min(startHours, peakHours));
      hours = Math.min(ceil, prevHours * (1 + RAMP[exp]));
      const longCeil = Math.max(PHASE_LONG_CEIL[phase] * peakLongMin, startLong);
      longMin = Math.min(longCeil, prevLong + longStep, hours * 60 * 0.45);
      prevHours = hours;
      prevLong = longMin;
      lastLoadHours = hours;
      lastLoadLong = longMin;
    }

    const sports = sportsAvailable(profile, goal, primary, weekStart);
    const goalAvailable = goalSet.filter((g) => sports.includes(g));
    let goalSportShare = 1;
    for (const g of goalSet.filter((g) => !sports.includes(g))) {
      const sub = sports.find((s) => !goalSet.includes(s as GoalSport)) ?? goalAvailable[0];
      notes.push(
        sub
          ? `No ${label(g)} this week: ${label(sub)} carries that ${VERTICAL_SPORTS.includes(g) ? "aerobic and vertical" : "aerobic"} load.`
          : `No ${label(g)} this week, and no other listed sport is in season: use treadmill incline, stairs or hiking.`,
      );
    }
    if (!goalAvailable.length) {
      goalSportShare = 0;
      if (running(primary)) primaryGap++;
    } else {
      if (sports.includes(primary) && running(primary)) {
        if (primaryGap >= 3) reintroLeft = 3;
        primaryGap = 0;
      }
      if (reintroLeft > 0) {
        goalSportShare = [0.85, 0.7, 0.5][reintroLeft - 1]!;
        reintroLeft--;
        notes.push(
          `Reintroducing ${label(primary)} gradually (${Math.round(goalSportShare * 100)}% of volume) to protect tendons and bones.`,
        );
      } else if (sports.length > goalAvailable.length && (phase === "base" || phase === "build")) {
        goalSportShare = 0.75;
      }
    }

    // Add one session every two weeks until all your training days are used.
    const sessions = Math.min(maxSessions, startSessions + Math.floor(i / 2));
    if (i > 0 && sessions > prevSessions) notes.push(`Training frequency goes up to ${sessions} sessions this week.`);
    prevSessions = sessions;

    const raceWeek = i === totalWeeks - 1;
    const vertical = density * hours * PHASE_VERT_FACTOR[phase] * (recovery ? 0.8 : 1) * (raceWeek ? 0.5 : 1);

    weeks.push({
      index: i,
      weekStart,
      phase,
      isRecovery: recovery,
      targetHours: round(hours, 0.25),
      targetVerticalM: round(vertical, 50),
      targetLongMin: round(longMin, 5),
      sports: sports.length ? sports : ["hike"],
      goalSportShare,
      sessions,
      notes,
    });
  }

  const peakVerticalM = Math.max(...weeks.map((w) => w.targetVerticalM));
  if (density > 0 && profile.terrain.maxLocalClimbM < 200 && !profile.terrain.treadmillIncline && !profile.terrain.stairs) {
    warnings.push("You have little local climbing and no treadmill or stairs. Weekly vertical will be hard to hit midweek, so it'll mostly come from weekend days in the mountains.");
  }
  if (goal.legs.length > 1) {
    const total = legs.reduce((a, l) => a + l.minutes, 0) || 1;
    warnings.push(
      `Multisport: training is split by race time: ${legs.map((l) => `${label(l.sport)} ${Math.round((l.minutes / total) * 100)}%`).join(", ")}. The specific phase adds race simulations that link the legs.`,
    );
  }
  if (lengths.base + lengths.build + lengths.specific < 8) {
    warnings.push("This is a short build. The plan focuses on specificity rather than big volume gains.");
  }

  return {
    summary: {
      totalWeeks,
      eventMinutes,
      legs,
      primarySport: primary,
      peakHours: Math.max(...weeks.map((w) => w.targetHours)),
      peakVerticalM,
      peakLongMin: Math.max(...weeks.map((w) => w.targetLongMin)),
      phases: (["base", "build", "specific", "taper"] as Phase[])
        .map((phase) => ({ phase, weeks: lengths[phase] }))
        .filter((p) => p.weeks > 0),
      warnings,
    },
    weeks,
  };
}
