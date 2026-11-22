import {
  goalTotals,
  type AthleteProfile,
  type Goal,
  type Phase,
  type PlannedWorkoutDraft,
  type RegularActivity,
  type WeekSkeleton,
  type WorkoutStep,
  type WorkoutType,
} from "../schemas";
import { SPORT_LABELS, type GoalSport, type Sport } from "../sports";
import { addDays, weekdayOf } from "./dates";
import type { Skeleton } from "./periodization";

const round5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
const round50 = (x: number) => Math.round(x / 50) * 50;
const FOOT: Sport[] = ["trail_run", "road_run", "hike", "mountaineering"];
const MOUNTAIN: Sport[] = ["trail_run", "hike", "mountaineering", "ski_touring"];
const isWeekday = (d: number) => d <= 4;
const lower = (s: Sport) => SPORT_LABELS[s].toLowerCase();

/** Session types that count as endurance volume. */
export const ENDURANCE_TYPES: readonly WorkoutType[] = [
  "easy",
  "long",
  "back_to_back",
  "vert_intervals",
  "tempo",
  "downhill",
  "strides",
  "simulation",
  "recovery",
];
export const isEndurance = (w: { type: WorkoutType }) => ENDURANCE_TYPES.includes(w.type);

/** Relative share of weekly vertical per minute of session, by type. */
const VERT_WEIGHT: Record<WorkoutType, number> = {
  long: 1.2,
  back_to_back: 1,
  simulation: 1.1,
  vert_intervals: 1.5,
  downhill: 1.2,
  easy: 0.6,
  tempo: 0.3,
  strides: 0.4,
  recovery: 0.3,
  strength: 0,
  mobility: 0,
  activity: 0,
  race: 0,
};
const SPORT_VERT_WEIGHT: Partial<Record<Sport, number>> = {
  trail_run: 1,
  hike: 1.1,
  mountaineering: 1.2,
  ski_touring: 1.3,
  road_run: 0.25,
  nordic_ski: 0.4,
};

interface Slot {
  day: number; // 0..6
  type: WorkoutType;
  durationMin: number;
  sport: Sport;
}
type Unassigned = Omit<Slot, "sport">;

interface Ctx {
  goal: Goal;
  profile: AthleteProfile;
  week: WeekSkeleton;
  phaseWeek: number; // 0-based index within the phase
  eventMinutes: number;
  /** Share of race time per goal sport. */
  legShares: { sport: GoalSport; share: number }[];
  primary: GoalSport;
}

// ---------------------------------------------------------------------------
// Day selection
// ---------------------------------------------------------------------------

const circDist = (a: number, b: number) => {
  const d = Math.abs(a - b);
  return Math.min(d, 7 - d);
};

/** Pick `n` days from `candidates` that are as far as possible from `avoid` and each other. */
function spreadDays(candidates: number[], avoid: number[], n: number): number[] {
  const picked: number[] = [];
  const pool = [...candidates];
  while (picked.length < n && pool.length) {
    let best = pool[0]!;
    let bestScore = -1;
    for (const d of pool) {
      const others = [...avoid, ...picked];
      const score = others.length ? Math.min(...others.map((o) => circDist(o, d))) : 7 - d;
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    }
    picked.push(best);
    pool.splice(pool.indexOf(best), 1);
  }
  return picked.sort((a, b) => a - b);
}

function qualityTypes(ctx: Ctx, sessions: number): WorkoutType[] {
  const { week, profile, primary } = ctx;
  if (!profile.workouts.structured) return [];
  if (week.isRecovery) return ["strides"];
  const beginner = profile.experience === "beginner";
  const few = beginner || sessions < 4;
  const mountain = MOUNTAIN.includes(primary);
  switch (week.phase) {
    case "base":
      return ["strides"];
    case "build":
      return few ? ["vert_intervals"] : ["vert_intervals", "tempo"];
    case "specific":
      if (few) return ["vert_intervals"];
      return mountain && FOOT.includes(primary) ? ["vert_intervals", "downhill"] : ["vert_intervals", "tempo"];
    case "taper":
      return ["vert_intervals"];
  }
}

// ---------------------------------------------------------------------------
// Session content
// ---------------------------------------------------------------------------

const pick = <T>(arr: readonly T[], i: number): T => arr[Math.min(i, arr.length - 1)]!;

function intervalSet(ctx: Ctx, sport: Sport): { reps: number; work: number; rest: number; zone: string; cue: string } {
  const i = ctx.phaseWeek;
  const climbing = MOUNTAIN.includes(sport) || sport === "road_run";
  if (ctx.week.phase === "taper") return { reps: 4, work: 3, rest: 3, zone: "Z4", cue: "sharp but controlled, finish fresh" };
  if (ctx.week.phase === "specific") {
    const [reps, work] = pick([[3, 10], [4, 10], [3, 12], [4, 12], [3, 15], [4, 15]] as const, i);
    const cue =
      sport === "ski_touring"
        ? "sustained skinning at race effort"
        : sport === "bike"
          ? "sustained climbing at race effort"
          : sport === "swim" || sport === "paddle" || sport === "nordic_ski"
            ? "steady race-pace effort"
            : "steep sustained climb (15–25%), power-hike where it's faster, use poles if you'll race with them";
    return { reps, work, rest: Math.round(work / 2), zone: "Z3–Z4", cue };
  }
  const [reps, work] = pick([[5, 3], [6, 3], [5, 4], [6, 4], [5, 5], [6, 5]] as const, i);
  const cue = sport === "bike" ? "seated climbing" : climbing ? "uphill, strong rhythm" : "strong, smooth technique";
  return { reps, work, rest: sport === "swim" ? 1 : work, zone: "Z4", cue };
}

function describe(ctx: Ctx, slot: Slot, verticalM: number | null): Pick<PlannedWorkoutDraft, "title" | "description" | "steps" | "intensity"> {
  const { profile, week } = ctx;
  const s = slot.sport;
  const sportName = lower(s);
  const d = slot.durationMin;
  const foot = FOOT.includes(s);
  const vertNote = verticalM && verticalM > 0 ? ` Aim for ~${verticalM} m of climbing.` : "";
  const local = profile.terrain.maxLocalClimbM;
  const lapsNote =
    verticalM && foot && local > 0 && verticalM > local * 1.2 && isWeekday(slot.day)
      ? ` That's about ${Math.ceil(verticalM / local)} laps of your local ${local} m climb${profile.terrain.treadmillIncline ? ", or a treadmill at 12–15% incline" : ""}.`
      : "";
  const fuel = d >= 90 ? " Fuel from the first 30 min: 60–90 g carbs/h and 400–750 ml/h fluids. Practise race nutrition and kit." : "";

  switch (slot.type) {
    case "long": {
      const specific = week.phase === "specific";
      const body =
        s === "ski_touring"
          ? "Long ski tour at a steady Z1–Z2. Practise quick transitions and eating on the move."
          : s === "bike"
            ? "Long endurance ride, mostly Z2."
            : s === "swim"
              ? "Long continuous swim, steady Z2. Practise sighting if your race is in open water."
              : s === "paddle"
                ? "Long steady paddle, Z2. Focus on efficient technique as you tire."
                : s === "road_run"
                  ? "Long run at an easy, conversational pace."
                  : specific
                    ? "Race-specific long day: include 2–3 long climbs at race effort, and technical descents on tired legs. Run the runnable, power-hike the steep."
                    : "Long day on hilly terrain, Z1–Z2. Run the runnable, power-hike anything steep. Time on feet matters more than pace.";
      return {
        title: `Long ${sportName}`,
        intensity: "Z1–Z2",
        description: body + vertNote + fuel,
        steps: [{ label: "Steady", durationMin: d, intensity: "Z1–Z2", notes: verticalM ? `${verticalM} m D+` : undefined }],
      };
    }
    case "simulation": {
      const legs = ctx.legShares.filter((l) => week.sports.includes(l.sport));
      const total = legs.reduce((a, l) => a + l.share, 0) || 1;
      return {
        title: `Race simulation: ${legs.map((l) => SPORT_LABELS[l.sport]).join(" → ")}`,
        intensity: "Z2 with race-pace blocks",
        description:
          "Do the legs back to back in race order, with quick transitions. Ride or run each leg mostly in Z2 and spend the last third of each at race effort. Rehearse transitions, kit changes and fueling." +
          vertNote +
          fuel,
        steps: legs.map((l) => ({
          label: SPORT_LABELS[l.sport],
          durationMin: round5((d * l.share) / total),
          intensity: "Z2 → race pace",
        })),
      };
    }
    case "back_to_back":
      return {
        title: `Back-to-back ${sportName}`,
        intensity: "Z1–Z2",
        description:
          "Day 2 of the back-to-back: go easy on tired legs. This builds durability for the second half of the race. Power-hike the climbs and keep the descents smooth." +
          vertNote,
        steps: [{ label: "Easy on tired legs", durationMin: d, intensity: "Z1–Z2" }],
      };
    case "vert_intervals": {
      const full = intervalSet(ctx, s);
      const wu = 15;
      // Fit the set into the scheduled duration (keep ≥10 min cool-down, ≥2 reps).
      const reps = Math.max(2, Math.min(full.reps, Math.floor((d - wu - 10) / (full.work + full.rest))));
      const set = { ...full, reps };
      const cd = Math.max(5, d - wu - set.reps * (set.work + set.rest));
      const climbing = MOUNTAIN.includes(s) || s === "bike";
      const title =
        week.phase === "taper"
          ? "Openers"
          : s === "ski_touring"
            ? `Skinning intervals ${set.reps}×${set.work}′`
            : s === "bike"
              ? `Hill intervals ${set.reps}×${set.work}′`
              : climbing || s === "road_run"
                ? `Uphill intervals ${set.reps}×${set.work}′`
                : `Threshold intervals ${set.reps}×${set.work}′`;
      return {
        title,
        intensity: set.zone,
        description: `${set.reps}×${set.work} min ${set.zone}: ${set.cue}. Recover ${set.rest} min easy${foot ? " (walk or jog down)" : ""}.${
          foot && !profile.terrain.maxLocalClimbM && profile.terrain.treadmillIncline ? " A treadmill at 10–15% works well." : ""
        }`,
        steps: [
          { label: "Warm-up", durationMin: wu, intensity: "Z1–Z2" },
          { label: climbing ? "Climb" : "Hard", durationMin: set.work, repeat: set.reps, intensity: set.zone, notes: `${set.rest} min easy recovery between` },
          { label: "Cool-down", durationMin: cd, intensity: "Z1" },
        ],
      };
    }
    case "tempo": {
      const [reps, work] = pick([[3, 10], [2, 15], [3, 12], [2, 20], [3, 15]] as const, ctx.phaseWeek);
      return {
        title: `Tempo ${reps}×${work}′`,
        intensity: "Z3",
        description: `${reps}×${work} min at Z3 (comfortably hard, short sentences only) ${
          !foot ? "at a sustained effort" : s === "road_run" ? "on flat road" : "on rolling runnable terrain"
        }, 3 min easy between.`,
        steps: [
          { label: "Warm-up", durationMin: 15, intensity: "Z1–Z2" },
          { label: "Tempo", durationMin: work, repeat: reps, intensity: "Z3", notes: "3 min easy between" },
          { label: "Cool-down", durationMin: Math.max(5, d - 15 - reps * (work + 3)), intensity: "Z1" },
        ],
      };
    }
    case "downhill":
      if (s === "ski_touring") {
        return {
          title: "Ski descent skills",
          intensity: "Z2",
          description: "Easy skin up, then focus on technical descents: varied snow, short turns, and quick transitions.",
          steps: [{ label: "Skin + descents", durationMin: d, intensity: "Z1–Z2" }],
        };
      }
      return {
        title: "Downhill repeats",
        intensity: "Z2–Z3",
        description:
          "Builds eccentric strength so your quads survive the descents. Climb easy, then 6–8 × 2–3 min fast but controlled descents on technical trail. Short quick steps, eyes 3–5 m ahead, relaxed arms. Walk or jog back up." +
          vertNote +
          lapsNote,
        steps: [
          { label: "Warm-up climb", durationMin: 20, intensity: "Z1–Z2" },
          { label: "Fast descent", durationMin: 3, repeat: 7, intensity: "Z2–Z3", notes: "easy climb back up" },
          { label: "Cool-down", durationMin: Math.max(5, d - 20 - 7 * 6), intensity: "Z1" },
        ],
      };
    case "strides":
      if (foot) {
        return {
          title: "Easy + hill sprints",
          intensity: "Z2 + short bursts",
          description: "Easy aerobic session, then 8×10–15 s steep hill sprints at max effort with a full walk-back recovery. Builds power without fatigue.",
          steps: [
            { label: "Easy", durationMin: Math.max(10, d - 12), intensity: "Z1–Z2" },
            { label: "Hill sprint", durationMin: null, repeat: 8, intensity: "Max", notes: "10–15 s, full walk-back recovery" },
          ],
        };
      }
      return {
        title: `Easy ${sportName} + pickups`,
        intensity: "Z2 + short bursts",
        description: `Easy aerobic ${sportName} with 6×20 s strong pickups${s === "swim" ? " (or 6×25 m fast)" : ""}.`,
        steps: [
          { label: "Easy", durationMin: Math.max(10, d - 8), intensity: "Z1–Z2" },
          { label: "Pickup", durationMin: null, repeat: 6, intensity: "Strong", notes: "20 s, easy recovery" },
        ],
      };
    case "recovery":
      return {
        title: `Recovery ${sportName}`,
        intensity: "Z1",
        description: "Very easy. You should finish feeling better than when you started.",
        steps: [{ label: "Easy", durationMin: d, intensity: "Z1" }],
      };
    case "easy":
    default:
      return {
        title: `Easy ${sportName}`,
        intensity: "Z1–Z2",
        description:
          (s === "ski_touring"
            ? "Easy skin, conversational effort."
            : s === "bike"
              ? "Easy spin, Z2."
              : s === "swim"
                ? "Easy continuous swim with a few technique drills."
                : s === "paddle"
                  ? "Easy steady paddle, focus on technique."
                  : s === "road_run"
                    ? "Easy, conversational run."
                    : foot
                      ? "Easy, conversational effort on hilly terrain."
                      : `Easy, conversational ${sportName}.`) +
          vertNote +
          lapsNote,
        steps: [{ label: "Easy", durationMin: d, intensity: "Z1–Z2" }],
      };
  }
}

function strengthWorkout(ctx: Ctx, date: string): PlannedWorkoutDraft {
  const { phase } = ctx.week;
  const gym = ctx.profile.workouts.strengthAccess === "gym";
  const load = gym ? "" : " Use a backpack or bands for load.";
  const climbs = ctx.profile.activities.some((a) => a.sport === "climbing");
  const content: Record<Phase, { title: string; steps: WorkoutStep[] }> = {
    base: {
      title: "Strength: foundation",
      steps: [
        { label: gym ? "Goblet squat" : "Split squat", durationMin: null, repeat: 3, intensity: "10 reps", notes: "controlled" },
        { label: "Step-ups", durationMin: null, repeat: 3, intensity: "10/leg" },
        { label: gym ? "Romanian deadlift" : "Single-leg RDL", durationMin: null, repeat: 3, intensity: "10 reps" },
        { label: "Calf raises", durationMin: null, repeat: 3, intensity: "15 reps", notes: "slow lowering" },
        { label: "Side plank + dead bug", durationMin: null, repeat: 3, intensity: "30 s / 10 reps" },
      ],
    },
    build: {
      title: "Strength: heavy",
      steps: [
        { label: "Bulgarian split squat", durationMin: null, repeat: 4, intensity: "6–8/leg, heavy" },
        { label: "Weighted step-ups", durationMin: null, repeat: 3, intensity: "8/leg" },
        { label: "Single-leg RDL", durationMin: null, repeat: 3, intensity: "8/leg" },
        { label: "Eccentric calf drops", durationMin: null, repeat: 3, intensity: "12 reps", notes: "off a step, 3 s down" },
        { label: "Copenhagen plank", durationMin: null, repeat: 3, intensity: "20 s/side" },
      ],
    },
    specific: {
      title: "Strength: eccentric & power",
      steps: [
        { label: "Box jumps / squat jumps", durationMin: null, repeat: 4, intensity: "5 reps, explosive" },
        { label: "Slow eccentric step-downs", durationMin: null, repeat: 3, intensity: "8/leg, 4 s down" },
        { label: "Jump lunges", durationMin: null, repeat: 3, intensity: "6/leg" },
        { label: "Single-leg hops", durationMin: null, repeat: 3, intensity: "10/leg" },
        { label: "Core circuit", durationMin: 8, intensity: "steady" },
      ],
    },
    taper: {
      title: "Strength: maintenance",
      steps: [
        { label: "Split squat", durationMin: null, repeat: 2, intensity: "6/leg, moderate" },
        { label: "Step-downs", durationMin: null, repeat: 2, intensity: "6/leg" },
        { label: "Core", durationMin: 5, intensity: "easy" },
      ],
    },
  };
  const c = content[phase];
  return {
    date,
    sport: "strength",
    type: "strength",
    title: c.title,
    durationMin: phase === "taper" ? 25 : 40,
    distanceKm: null,
    verticalM: null,
    intensity: "Strength",
    description: `Do it after an easy session or on its own, never right before a key day.${load} Stop 1–2 reps short of failure.${
      climbs ? " Your climbing already covers upper body and grip, so this one is legs and core only." : ""
    }`,
    steps: c.steps,
    key: false,
  };
}

const MOBILITY: Record<"hips" | "recovery" | "upper", { title: string; minutes: number; steps: WorkoutStep[]; description: string }> = {
  hips: {
    title: "Mobility: hips & ankles",
    minutes: 15,
    description: "Keeps your stride long and your ankles resilient on rough ground. Move slowly and breathe through each position.",
    steps: [
      { label: "90/90 hip switches", durationMin: 2, intensity: "easy" },
      { label: "Couch stretch (hip flexors)", durationMin: 3, intensity: "easy", notes: "90 s per side" },
      { label: "Knee-to-wall ankle rocks", durationMin: 2, intensity: "easy", notes: "15 per side" },
      { label: "Deep squat hold", durationMin: 2, intensity: "easy" },
      { label: "Calf + soleus stretch", durationMin: 3, intensity: "easy" },
      { label: "Glute bridge hold", durationMin: 3, intensity: "easy", notes: "3×30 s" },
    ],
  },
  recovery: {
    title: "Mobility: recovery flow",
    minutes: 20,
    description: "The day after a big session: gentle movement to help your legs recover. No pain, just easy range of motion.",
    steps: [
      { label: "Foam roll quads, calves, glutes", durationMin: 6, intensity: "easy" },
      { label: "Pigeon pose", durationMin: 3, intensity: "easy", notes: "90 s per side" },
      { label: "Hamstring floss", durationMin: 2, intensity: "easy" },
      { label: "Cat–cow + child's pose", durationMin: 3, intensity: "easy" },
      { label: "Legs up the wall + slow breathing", durationMin: 6, intensity: "easy" },
    ],
  },
  upper: {
    title: "Mobility: spine & shoulders",
    minutes: 15,
    description: "For pole use, carrying a pack and climbing. Open the upper back and shoulders.",
    steps: [
      { label: "Thoracic rotations (open book)", durationMin: 3, intensity: "easy", notes: "10 per side" },
      { label: "Thread the needle", durationMin: 2, intensity: "easy" },
      { label: "Shoulder CARs", durationMin: 2, intensity: "easy", notes: "5 slow circles per side" },
      { label: "Doorway pec stretch", durationMin: 3, intensity: "easy" },
      { label: "Wrist & forearm stretches", durationMin: 2, intensity: "easy" },
      { label: "Dead hang or band pull-aparts", durationMin: 3, intensity: "easy" },
    ],
  },
};

function mobilityWorkout(kind: keyof typeof MOBILITY, date: string): PlannedWorkoutDraft {
  const m = MOBILITY[kind];
  return {
    date,
    sport: "mobility",
    type: "mobility",
    title: m.title,
    durationMin: m.minutes,
    distanceKm: null,
    verticalM: null,
    intensity: "Easy",
    description: m.description,
    steps: m.steps,
    key: false,
  };
}

const ACTIVITY_TIPS: Partial<Record<Sport, string>> = {
  climbing: "Your regular climbing session. Keep it moderate the day before a key session, and skip max-effort bouldering before a long day.",
  team_sport: "Your regular game. Lots of sprinting and cutting counts as intensity, so keep the next day easy.",
  swim: "Your regular swim. Great active recovery for the legs.",
  bike: "Your regular ride. Keep it Z1–Z2 unless it's a planned hard day.",
  alpine_ski: "Your regular ski day. Quad-heavy: treat it like a moderate leg day.",
};

function activityWorkout(a: RegularActivity, date: string, taper: boolean): PlannedWorkoutDraft {
  return {
    date,
    sport: a.sport,
    type: "activity",
    title: SPORT_LABELS[a.sport],
    durationMin: a.durationMin,
    distanceKm: null,
    verticalM: null,
    intensity: taper ? "Light" : "Your call",
    description: `${ACTIVITY_TIPS[a.sport] ?? "One of your regular activities. The plan works around it."}${taper ? " Taper: keep it light and short." : ""}`,
    steps: [{ label: SPORT_LABELS[a.sport], durationMin: a.durationMin, intensity: taper ? "Light" : "Moderate" }],
    key: false,
  };
}

// ---------------------------------------------------------------------------
// Sport assignment
// ---------------------------------------------------------------------------

function assignSports(ctx: Ctx, slots: Unassigned[]): Slot[] {
  const { week, primary } = ctx;
  const goalAvail = ctx.legShares.filter((l) => week.sports.includes(l.sport));
  const cross = week.sports.filter((s) => !goalAvail.some((g) => g.sport === s));
  const totalMin = slots.reduce((a, s) => a + s.durationMin, 0);
  const crossTarget = goalAvail.length ? (1 - week.goalSportShare) * totalMin : Infinity;

  // 1. Pick cross-training slots: easy first, then back-to-back, then long; keep quality in goal sports longest.
  const order: WorkoutType[] = ["easy", "recovery", "strides", "back_to_back", "long", "tempo", "downhill", "vert_intervals", "simulation"];
  const ranked = [...slots].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const crossSet = new Set<Unassigned>();
  let crossMin = 0;
  for (const s of ranked) {
    if (crossMin >= crossTarget - 1) break;
    if (s.type === "simulation") continue;
    crossSet.add(s);
    crossMin += s.durationMin;
  }

  // 2. Split the remaining goal-sport minutes across legs by their share of race time.
  const shareSum = goalAvail.reduce((a, l) => a + l.share, 0) || 1;
  const assigned = new Map<Sport, number>(goalAvail.map((g) => [g.sport, 0]));
  const goalMin = totalMin - crossMin;
  const deficit = (s: GoalSport) => (goalAvail.find((g) => g.sport === s)!.share / shareSum) * goalMin - (assigned.get(s) ?? 0);
  const result = new Map<Unassigned, Sport>();
  const lead = goalAvail.some((g) => g.sport === primary) ? primary : [...goalAvail].sort((a, b) => b.share - a.share)[0]?.sport;

  const goalSlots = slots.filter((s) => !crossSet.has(s)).sort((a, b) => b.durationMin - a.durationMin);
  for (const s of goalSlots) {
    let sport: Sport;
    if (!lead) sport = cross[0] ?? "hike";
    else if (s.type === "long" || s.type === "simulation") sport = lead;
    else {
      const candidates = goalAvail
        .map((g) => g.sport)
        .filter((g) => s.type !== "downhill" || FOOT.includes(g))
        .filter((g) => s.type !== "back_to_back" || g === lead || goalAvail.length === 1);
      sport = (candidates.length ? candidates : [lead]).reduce((best, g) => (deficit(g) > deficit(best) ? g : best));
    }
    assigned.set(sport, (assigned.get(sport) ?? 0) + s.durationMin);
    result.set(s, sport);
  }

  // 3. Cross-training slots: long/vertical sessions take the best-transfer sport; easy ones rotate for variety.
  // Nothing else in season (e.g. easing back into running in spring)? Power-hike instead.
  const fallback: Sport = primary === "hike" ? "trail_run" : "hike";
  const options = cross.length ? cross : [fallback];
  let rot = 0;
  for (const s of slots) {
    if (!crossSet.has(s)) continue;
    result.set(s, s.type === "easy" || s.type === "recovery" ? options[rot++ % options.length]! : options[0]!);
  }

  return slots.map((s) => {
    const sport = result.get(s)!;
    // Downhill repeats only make sense on foot.
    const type = s.type === "downhill" && !FOOT.includes(sport) && sport !== "ski_touring" ? "tempo" : s.type;
    return { ...s, type, sport };
  });
}

// ---------------------------------------------------------------------------
// Week assembly
// ---------------------------------------------------------------------------

export function generateWeek(ctx: Ctx): PlannedWorkoutDraft[] {
  const { goal, profile, week } = ctx;
  const av = profile.availability;
  const days = [...av.days].sort((a, b) => a - b);
  const raceWeek = week.phase === "taper" && week.targetLongMin === 0;
  const raceDay = raceWeek ? weekdayOf(goal.eventDate) : null;
  const multisport = ctx.legShares.length > 1;
  const longDay = days.includes(av.longDay) ? av.longDay : days[days.length - 1]!;

  // Regular activities go on their preferred days first; key sessions avoid them where possible.
  const activityPlan: { a: RegularActivity; day: number }[] = [];
  for (const a of profile.activities) {
    const preferred = a.days.slice(0, a.perWeek);
    const extra = spreadDays(
      [0, 1, 2, 3, 4, 5, 6].filter((d) => !preferred.includes(d) && d !== longDay && (d + 1) % 7 !== longDay),
      [longDay, ...preferred],
      a.perWeek - preferred.length,
    );
    for (const d of [...preferred, ...extra]) activityPlan.push({ a, day: d });
  }
  const activityDays = activityPlan.map((p) => p.day);

  const total = week.targetHours * 60;
  const slots: Unassigned[] = [];

  if (raceWeek) {
    // Short sessions, openers ~3 days out, rest the day before.
    const pre = days.filter((d) => raceDay! - d >= 2);
    const opener = pre.find((d) => raceDay! - d === 3) ?? pre[pre.length - 1];
    for (const d of pre) {
      slots.push({ day: d, type: d === opener && profile.workouts.structured ? "vert_intervals" : "easy", durationMin: 0 });
    }
  } else {
    const simulationWeek = multisport && week.phase === "specific" && !week.isRecovery && ctx.phaseWeek % 2 === 1;
    slots.push({ day: longDay, type: simulationWeek ? "simulation" : "long", durationMin: week.targetLongMin });

    const b2bDay = [(longDay + 1) % 7, (longDay + 6) % 7].find((d) => days.includes(d) && d !== longDay);
    const wantB2B =
      av.backToBack &&
      !week.isRecovery &&
      week.phase === "specific" &&
      week.targetLongMin >= 120 &&
      b2bDay !== undefined &&
      week.sessions >= 3;
    if (wantB2B) slots.push({ day: b2bDay!, type: "back_to_back", durationMin: Math.round(week.targetLongMin * 0.5) });

    const taken = slots.map((s) => s.day);
    const free = days.filter((d) => !taken.includes(d));
    const remaining = Math.max(0, week.sessions - slots.length);
    const quality = qualityTypes(ctx, week.sessions).slice(0, Math.max(0, remaining - 1));
    // Quality away from the long day and from regular activities when possible.
    const qPool = free.filter((d) => !activityDays.includes(d));
    const qDays = spreadDays(qPool.length >= quality.length ? qPool : free, [...taken, ...activityDays], quality.length);
    quality.forEach((t, i) => slots.push({ day: qDays[i]!, type: t, durationMin: 0 }));
    const easyDays = spreadDays(
      free.filter((d) => !qDays.includes(d)),
      [...taken, ...qDays],
      remaining - quality.length,
    );
    for (const d of easyDays) slots.push({ day: d, type: week.isRecovery ? "recovery" : "easy", durationMin: 0 });
  }

  // ---- durations ----------------------------------------------------------
  const cap = (s: Unassigned) => (isWeekday(s.day) ? av.maxWeekdayMin : 240);
  const fixedQuality = (t: WorkoutType) =>
    t === "strides" ? 50 : t === "downhill" ? 75 : week.phase === "taper" ? 45 : week.phase === "specific" && t === "vert_intervals" ? 90 : 70;
  for (const s of slots) {
    if (!["long", "back_to_back", "simulation", "easy", "recovery"].includes(s.type)) s.durationMin = Math.min(cap(s), fixedQuality(s.type));
  }
  const flexible = slots.filter((s) => s.type === "easy" || s.type === "recovery");
  const used = slots.reduce((a, s) => a + s.durationMin, 0);
  const each = flexible.length ? (total - used) / flexible.length : 0;
  for (const s of flexible) s.durationMin = Math.max(raceWeek ? 20 : 30, Math.min(cap(s), raceWeek ? Math.min(each, 40) : each));
  for (const s of slots) s.durationMin = round5(s.durationMin);

  const withSports = assignSports(ctx, slots);

  // ---- vertical -----------------------------------------------------------
  const weight = (s: Slot) => VERT_WEIGHT[s.type] * (SPORT_VERT_WEIGHT[s.sport] ?? 0) * s.durationMin;
  const totalWeight = withSports.reduce((a, s) => a + weight(s), 0);

  const workouts: PlannedWorkoutDraft[] = withSports.map((slot) => {
    const v = totalWeight > 0 ? round50((week.targetVerticalM * weight(slot)) / totalWeight) : 0;
    const verticalM = v > 0 ? v : null;
    return {
      date: addDays(week.weekStart, slot.day),
      sport: slot.sport,
      type: slot.type,
      durationMin: slot.durationMin,
      distanceKm: null,
      verticalM,
      key: ["long", "back_to_back", "simulation", "vert_intervals", "downhill", "tempo"].includes(slot.type),
      ...describe(ctx, slot, verticalM),
    };
  });

  const enduranceDays = withSports.map((s) => s.day);
  const hardDays = withSports.filter((s) => s.type !== "easy" && s.type !== "recovery").map((s) => s.day);

  // ---- regular activities -------------------------------------------------
  for (const { a, day } of activityPlan) {
    if (raceDay !== null && day >= raceDay - 1) continue;
    workouts.push(activityWorkout(a, addDays(week.weekStart, day), week.phase === "taper"));
  }

  // ---- strength -----------------------------------------------------------
  let nStrength = profile.workouts.strengthPerWeek;
  if (raceWeek) nStrength = 0;
  else if (week.phase === "taper" || week.isRecovery) nStrength = Math.min(1, nStrength);
  if (nStrength > 0) {
    const notBeforeLong = (d: number) => (d + 1) % 7 !== longDay;
    const easyDays = withSports.filter((s) => ["easy", "recovery", "strides"].includes(s.type)).map((s) => s.day).filter(notBeforeLong);
    const restDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !enduranceDays.includes(d) && notBeforeLong(d));
    // Prefer easy days without a regular activity, then other easy days, then rest days.
    const free = (d: number) => !activityDays.includes(d);
    const tiers = [easyDays.filter(free), easyDays, [...easyDays, ...restDays.filter(free)], [...easyDays, ...restDays]];
    const candidates = tiers.find((t) => t.length >= nStrength) ?? tiers[3]!;
    for (const d of spreadDays(candidates, [longDay], nStrength)) workouts.push(strengthWorkout(ctx, addDays(week.weekStart, d)));
  }

  // ---- mobility -----------------------------------------------------------
  let nMobility = profile.workouts.mobilityPerWeek;
  if (raceWeek) nMobility = Math.min(2, nMobility);
  if (nMobility > 0) {
    const dayAfterLong = (longDay + 1) % 7;
    const lastDay = raceDay !== null ? raceDay - 1 : 6;
    const order = [
      ...(raceWeek ? [] : [dayAfterLong]),
      ...[0, 1, 2, 3, 4, 5, 6].filter((d) => !enduranceDays.includes(d)),
      ...[0, 1, 2, 3, 4, 5, 6].filter((d) => enduranceDays.includes(d) && !hardDays.includes(d)),
      ...hardDays,
    ].filter((d, i, arr) => arr.indexOf(d) === i && d <= lastDay);
    const climbs = profile.activities.some((a) => a.sport === "climbing");
    const rotation: (keyof typeof MOBILITY)[] = climbs ? ["hips", "upper"] : ["hips", "hips", "upper"];
    let r = 0;
    for (const d of order.slice(0, nMobility).sort((a, b) => a - b)) {
      const kind = !raceWeek && d === dayAfterLong ? "recovery" : rotation[r++ % rotation.length]!;
      workouts.push(mobilityWorkout(kind, addDays(week.weekStart, d)));
    }
  }

  // ---- race ---------------------------------------------------------------
  if (raceWeek) {
    const totals = goalTotals(goal);
    const legs = ctx.legShares;
    const legMin = ctx.eventMinutes;
    workouts.push({
      date: goal.eventDate,
      sport: ctx.primary,
      type: "race",
      title: goal.name,
      durationMin: ctx.eventMinutes,
      distanceKm: totals.distanceKm,
      verticalM: totals.elevationGainM || null,
      intensity: "Race",
      key: true,
      description:
        "Race day. Start conservatively: the first climb should feel easy. Eat early and often (60–90 g carbs/h), drink to thirst, and use the descents to recover your breathing, not to attack.",
      steps:
        legs.length > 1
          ? legs.map((l) => ({ label: SPORT_LABELS[l.sport], durationMin: round5(legMin * l.share), intensity: "Race", notes: "fuel, then transition fast" }))
          : [
              { label: "First third", durationMin: null, intensity: "Z2", notes: "hold back, settle in" },
              { label: "Middle third", durationMin: null, intensity: "Z2–Z3", notes: "steady, keep fueling" },
              { label: "Final third", durationMin: null, intensity: "Z3+", notes: "race what's left" },
            ],
    });
  }

  const typeOrder = (t: WorkoutType) => (isEndurance({ type: t }) || t === "race" ? 0 : t === "activity" ? 1 : t === "strength" ? 2 : 3);
  return workouts.sort((a, b) => a.date.localeCompare(b.date) || typeOrder(a.type) - typeOrder(b.type));
}

export function generatePlanWorkouts(
  goal: Goal,
  profile: AthleteProfile,
  skeleton: Skeleton,
  startDate: string,
): PlannedWorkoutDraft[][] {
  const total = skeleton.summary.legs.reduce((a, l) => a + l.minutes, 0) || 1;
  const legShares = skeleton.summary.legs.map((l) => ({ sport: l.sport, share: l.minutes / total }));
  const phaseCounter: Partial<Record<Phase, number>> = {};
  return skeleton.weeks.map((week, i) => {
    const phaseWeek = phaseCounter[week.phase] ?? 0;
    phaseCounter[week.phase] = phaseWeek + 1;
    const workouts = generateWeek({
      goal,
      profile,
      week,
      phaseWeek,
      eventMinutes: skeleton.summary.eventMinutes,
      legShares,
      primary: skeleton.summary.primarySport,
    }).filter((w) => w.date >= startDate && w.date <= goal.eventDate);
    if (i === skeleton.weeks.length - 1) {
      // Race week targets = what is actually scheduled before the race.
      const pre = workouts.filter(isEndurance);
      week.targetHours = Math.round((pre.reduce((a, w) => a + w.durationMin, 0) / 60) * 4) / 4;
      week.targetVerticalM = pre.reduce((a, w) => a + (w.verticalM ?? 0), 0);
    }
    return workouts;
  });
}
