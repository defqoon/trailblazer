import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVITY_SPORTS,
  athleteProfileSchema,
  buildPlan,
  ENDURANCE_SPORTS,
  GOAL_SPORTS,
  goalSchema,
  goalSports,
  goalTotals,
  nextMonday,
  planRequestSchema,
  SPORT_ICONS,
  SPORT_LABELS,
  WEEKDAY_SHORT,
  type AthleteProfile,
  type CurrentPlanDto,
  type Goal,
  type GoalLeg,
  type GoalSport,
  type RegularActivity,
  type Sport,
  type SportWindow,
} from "@trailblazer/shared";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Connections } from "../components/Connections";
import { LoadChart } from "../components/LoadChart";
import { WorkoutCard } from "../components/WorkoutCard";
import { Badge, Button, Card, ChoiceCards, Chips, CountPicker, DurationInput, Field, inputClass, NumberInput, Toggle } from "../components/ui";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, fmtNumber, PHASE_LABEL, todayIso } from "../lib/format";
import { useStravaStatus, useStravaSummary } from "../lib/strava";

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------

interface Draft {
  goal: Goal;
  profile: AthleteProfile;
  startDate: string;
}

const DRAFT_KEY = "trailblazer.planDraft.v2";
const ALL_YEAR = { from: "01-01", to: "12-31" };
const isAllYear = (w: SportWindow) => w.from === "01-01" && w.to === "12-31";

const DEFAULT_LEG: Record<GoalSport, Omit<GoalLeg, "sport">> = {
  trail_run: { distanceKm: 40, elevationGainM: 2000, elevationLossM: null },
  road_run: { distanceKm: 21.1, elevationGainM: 100, elevationLossM: null },
  hike: { distanceKm: 30, elevationGainM: 1500, elevationLossM: null },
  mountaineering: { distanceKm: 15, elevationGainM: 2000, elevationLossM: null },
  ski_touring: { distanceKm: 20, elevationGainM: 1800, elevationLossM: null },
  bike: { distanceKm: 100, elevationGainM: 1500, elevationLossM: null },
  swim: { distanceKm: 1.5, elevationGainM: 0, elevationLossM: null },
  paddle: { distanceKm: 10, elevationGainM: 0, elevationLossM: null },
};

function defaultDraft(saved: AthleteProfile | null): Draft {
  return {
    goal: {
      name: "",
      eventDate: "",
      legs: [{ sport: "trail_run", ...DEFAULT_LEG.trail_run }],
      targetTimeMin: null,
      technicality: 2,
      priority: "finish",
    },
    profile: saved ?? {
      age: 35,
      sex: "unspecified",
      weightKg: 70,
      experience: "intermediate",
      current: { weeklyHours: 5, sessionsPerWeek: 3, longestSessionMin: 120 },
      availability: { days: [1, 3, 5, 6], longDay: 5, maxWeeklyHours: 10, maxWeekdayMin: 75, backToBack: true },
      sports: [{ sport: "trail_run", ...ALL_YEAR }],
      activities: [],
      workouts: { structured: true, strengthPerWeek: 2, strengthAccess: "gym", mobilityPerWeek: 2 },
      terrain: { maxLocalClimbM: 200, treadmillIncline: false, stairs: false },
      injuries: "",
      dexa: { recent: false, date: null },
      maxHr: null,
      restingHr: null,
    },
    startDate: nextMonday(todayIso()),
  };
}

interface Stored {
  draft: Draft;
  step: number;
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    // Drop drafts from an older shape.
    if (!athleteProfileSchema.safeParse(s.draft.profile).success || !Array.isArray(s.draft.goal?.legs)) return null;
    return s;
  } catch {
    return null;
  }
}
function saveStored(s: Stored | null) {
  try {
    if (s) localStorage.setItem(DRAFT_KEY, JSON.stringify(s));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: the draft just won't persist */
  }
}

/** Make sure every goal sport has a season row (all year by default). */
function withGoalSportRows(profile: AthleteProfile, goal: Goal): AthleteProfile {
  const missing = goalSports(goal).filter((s) => !profile.sports.some((w) => w.sport === s));
  return missing.length ? { ...profile, sports: [...profile.sports, ...missing.map((sport) => ({ sport, ...ALL_YEAR }))] } : profile;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

type StepProps = {
  draft: Draft;
  setGoal: (p: Partial<Goal>) => void;
  setProfile: (p: Partial<AthleteProfile>) => void;
  setDraft: (d: Draft) => void;
};

interface Step {
  id: string;
  title: string;
  subtitle: string;
  render: (p: StepProps) => ReactNode;
  /** Returns an error message when the step can't be left yet. */
  validate?: (d: Draft) => string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MonthDay({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [mm, dd] = value.split("-");
  const days = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
  return (
    <div className="flex gap-1" aria-label={label}>
      <select className={`${inputClass} px-2`} value={mm} onChange={(e) => onChange(`${e.target.value}-${dd}`)} aria-label={`${label} month`}>
        {MONTHS.map((m, i) => (
          <option key={m} value={String(i + 1).padStart(2, "0")}>
            {m}
          </option>
        ))}
      </select>
      <select className={`${inputClass} w-20 px-2`} value={dd} onChange={(e) => onChange(`${mm}-${e.target.value}`)} aria-label={`${label} day`}>
        {days.map((d) => (
          <option key={d} value={d}>
            {Number(d)}
          </option>
        ))}
      </select>
    </div>
  );
}

function DayPicker({ value, onToggle, disabled = [] }: { value: number[]; onToggle: (d: number) => void; disabled?: number[] }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAY_SHORT.map((label, d) => (
        <button
          key={label}
          type="button"
          aria-pressed={value.includes(d)}
          disabled={disabled.includes(d)}
          onClick={() => onToggle(d)}
          className={`min-h-11 rounded-xl text-sm font-medium disabled:opacity-25 ${
            value.includes(d) ? "bg-pine text-white dark:bg-emerald-300 dark:text-neutral-950" : "bg-black/5 text-rock dark:bg-white/10"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---- 1. Sports -------------------------------------------------------------

function SportStep({ draft, setGoal }: StepProps) {
  const selected = goalSports(draft.goal);
  const toggle = (s: GoalSport) => {
    if (selected.includes(s)) {
      if (selected.length === 1) return;
      setGoal({ legs: draft.goal.legs.filter((l) => l.sport !== s) });
    } else {
      setGoal({ legs: [...draft.goal.legs, { sport: s, ...DEFAULT_LEG[s] }] });
    }
  };
  const descriptions: Record<GoalSport, string> = {
    trail_run: "Mountain & trail races, skyrunning, ultras",
    road_run: "5K to marathon on roads",
    hike: "Big mountain days, fastpacking, hut-to-hut",
    mountaineering: "Alpine objectives, summits, glacier days",
    ski_touring: "Skimo races, big ski traverses",
    bike: "Gran fondos, gravel, MTB marathons",
    swim: "Open water, triathlon swim leg",
    paddle: "Kayak, canoe, SUP, adventure-race legs",
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2" role="group" aria-label="Event sports">
        {GOAL_SPORTS.map((s) => {
          const on = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s)}
              className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition ${
                on
                  ? "border-pine bg-pine/5 ring-2 ring-pine/20 dark:border-emerald-300 dark:bg-emerald-300/10"
                  : "border-black/10 bg-white hover:border-black/25 dark:border-white/10 dark:bg-neutral-900"
              }`}
            >
              <span className="text-xl leading-none" aria-hidden>
                {SPORT_ICONS[s]}
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{SPORT_LABELS[s]}</span>
                <span className="mt-0.5 block text-xs text-rock">{descriptions[s]}</span>
              </span>
              <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-xs ${on ? "border-pine bg-pine text-white dark:border-emerald-300 dark:bg-emerald-300 dark:text-neutral-950" : "border-black/25 dark:border-white/25"}`} aria-hidden>
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {selected.length > 1 && (
        <Card className="border-pine/30 bg-pine/5 text-sm dark:bg-emerald-300/10">
          <Badge tone="accent">Multisport</Badge>{" "}
          {selected.map((s) => SPORT_LABELS[s]).join(" → ")}. You'll set the distance and climbing for each leg (and their order) next.
        </Card>
      )}
    </div>
  );
}

// ---- 2. Event --------------------------------------------------------------

function EventStep({ draft, setGoal }: StepProps) {
  const g = draft.goal;
  const multi = g.legs.length > 1;
  const setLeg = (i: number, patch: Partial<GoalLeg>) => setGoal({ legs: g.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const move = (i: number, dir: -1 | 1) => {
    const legs = [...g.legs];
    const j = i + dir;
    if (j < 0 || j >= legs.length) return;
    [legs[i], legs[j]] = [legs[j]!, legs[i]!];
    setGoal({ legs });
  };
  const technical = g.legs.some((l) => ["trail_run", "hike", "mountaineering", "ski_touring"].includes(l.sport));
  const totals = goalTotals(g);

  return (
    <div className="space-y-4">
      <Field label="Event name">
        <input className={inputClass} value={g.name} placeholder="e.g. Mountain 40K" onChange={(e) => setGoal({ name: e.target.value })} />
      </Field>
      <Field label="Event date">
        <input type="date" className={inputClass} value={g.eventDate} min={draft.startDate} onChange={(e) => setGoal({ eventDate: e.target.value })} />
      </Field>

      {g.legs.map((leg, i) => {
        const climbs = leg.sport !== "swim" && leg.sport !== "paddle";
        return (
          <Card key={leg.sport} className="space-y-3">
            {multi && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-pine text-xs text-white dark:bg-emerald-300 dark:text-neutral-950">{i + 1}</span>
                  <span aria-hidden>{SPORT_ICONS[leg.sport]}</span> {SPORT_LABELS[leg.sport]}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" aria-label={`Move ${SPORT_LABELS[leg.sport]} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ↑
                  </Button>
                  <Button variant="ghost" aria-label={`Move ${SPORT_LABELS[leg.sport]} later`} disabled={i === g.legs.length - 1} onClick={() => move(i, 1)}>
                    ↓
                  </Button>
                </div>
              </div>
            )}
            <div className={`grid gap-3 ${climbs ? "grid-cols-2" : "grid-cols-1"}`}>
              <Field label="Distance">
                <NumberInput value={leg.distanceKm} onChange={(v) => setLeg(i, { distanceKm: v ?? 0 })} suffix="km" />
              </Field>
              {climbs && (
                <Field label="Elevation gain">
                  <NumberInput value={leg.elevationGainM} onChange={(v) => setLeg(i, { elevationGainM: v ?? 0 })} suffix="m D+" integer />
                </Field>
              )}
            </div>
            {climbs && (
              <Field label="Elevation loss" hint="Leave empty if it's the same as the gain.">
                <NumberInput value={leg.elevationLossM} allowEmpty onChange={(v) => setLeg(i, { elevationLossM: v })} suffix="m D−" integer />
              </Field>
            )}
          </Card>
        );
      })}
      {multi && (
        <p className="text-xs text-rock">
          Total: {fmtNumber(totals.distanceKm)} km · {fmtNumber(totals.elevationGainM)} m D+
        </p>
      )}

      {technical && (
        <Field label="Terrain">
          <ChoiceCards<1 | 2 | 3>
            value={g.technicality}
            onChange={(technicality) => setGoal({ technicality })}
            columns={3}
            options={[
              { value: 1, label: "Smooth", description: "Wide trails, fire roads" },
              { value: 2, label: "Technical", description: "Rocky, rooty singletrack" },
              { value: 3, label: "Alpine", description: "Scree, scrambling, off-trail" },
            ]}
          />
        </Field>
      )}
      <Field label="Goal">
        <ChoiceCards<"finish" | "perform">
          value={g.priority}
          onChange={(priority) => setGoal({ priority, targetTimeMin: priority === "finish" ? null : (g.targetTimeMin ?? 480) })}
          columns={2}
          options={[
            { value: "finish", label: "Finish strong", description: "Enjoy it, cross the line feeling good" },
            { value: "perform", label: "Target time", description: "I'm racing a specific time" },
          ]}
        />
      </Field>
      {g.priority === "perform" && (
        <Field label="Target finish time">
          <DurationInput value={g.targetTimeMin} onChange={(targetTimeMin) => setGoal({ targetTimeMin })} />
        </Field>
      )}
    </div>
  );
}

// ---- 4. Current training ---------------------------------------------------

function CurrentStep({ draft, setProfile }: StepProps) {
  const c = draft.profile.current;
  const set = (patch: Partial<typeof c>) => setProfile({ current: { ...c, ...patch } });
  const goalSet = goalSports(draft.goal) as Sport[];
  const trainSports = draft.profile.sports.map((w) => w.sport);
  const strava = useStravaStatus();
  const connected = Boolean(strava.data?.connected);
  const [wantSummary, setWantSummary] = useState(false);
  const summary = useStravaSummary(connected && wantSummary);

  const toggleSport = (s: Sport) => {
    if (goalSet.includes(s)) return;
    const sports = trainSports.includes(s)
      ? draft.profile.sports.filter((w) => w.sport !== s)
      : [...draft.profile.sports, { sport: s, ...ALL_YEAR }];
    setProfile({ sports });
  };

  const applySummary = () => {
    const s = summary.data;
    if (!s) return;
    const add = s.sports.filter((x) => !trainSports.includes(x)).map((sport) => ({ sport, ...ALL_YEAR }));
    const acts: RegularActivity[] = [...draft.profile.activities];
    for (const r of s.regular) {
      if (!(ACTIVITY_SPORTS as readonly string[]).includes(r.sport) || acts.some((a) => a.sport === r.sport)) continue;
      acts.push({ sport: r.sport, perWeek: Math.min(7, r.perWeek), days: [], durationMin: Math.max(15, r.avgMin) });
    }
    setProfile({
      current: { weeklyHours: s.weeklyHours, sessionsPerWeek: s.sessionsPerWeek, longestSessionMin: s.longestSessionMin },
      sports: [...draft.profile.sports, ...add],
      activities: acts,
      maxHr: draft.profile.maxHr ?? s.maxHrObserved,
    });
  };

  return (
    <div className="space-y-5">
      {connected ? (
        <Card className="space-y-2 text-sm">
          {!wantSummary ? (
            <Button variant="secondary" onClick={() => setWantSummary(true)}>
              🟧 Fill in from Strava
            </Button>
          ) : summary.isPending ? (
            <p className="text-rock">Reading your last 90 days of activities…</p>
          ) : summary.isError ? (
            <p className="text-ember">{summary.error.message}</p>
          ) : (
            <>
              <p>
                Last {summary.data.windowDays / 7} weeks on Strava: <strong>{fmtNumber(summary.data.weeklyHours)} h</strong> and{" "}
                <strong>{summary.data.sessionsPerWeek} sessions</strong> per week, longest {fmtDuration(summary.data.longestSessionMin)}.
                {summary.data.regular.length > 0 &&
                  ` Also ${summary.data.regular.map((r) => `${SPORT_LABELS[r.sport].toLowerCase()} ${r.perWeek}×/week`).join(", ")}.`}
              </p>
              <Button variant="secondary" onClick={applySummary}>
                Use these values
              </Button>
            </>
          )}
        </Card>
      ) : (
        <p className="text-xs text-rock">Tip: connect Strava (Settings, or the Health step) and these values can be filled in for you.</p>
      )}

      <Field label="Training sessions per week" hint="On average over the last 4–6 weeks, all sports.">
        <CountPicker ariaLabel="Sessions per week" value={Math.min(c.sessionsPerWeek, 10)} max={10} onChange={(sessionsPerWeek) => set({ sessionsPerWeek })} />
      </Field>
      <Field label="Hours per week" hint="Endurance training only.">
        <NumberInput value={c.weeklyHours} onChange={(v) => set({ weeklyHours: v ?? 0 })} suffix="h" />
      </Field>
      <Field label="Longest session in the last month">
        <DurationInput value={c.longestSessionMin} onChange={(v) => set({ longestSessionMin: v ?? 0 })} />
      </Field>
      <Field label="Sports you can train with" hint="The plan uses these for cross-training. You'll set seasons for each next.">
        <Chips<Sport>
          values={trainSports}
          locked={goalSet}
          onToggle={toggleSport}
          options={ENDURANCE_SPORTS.map((s) => ({ value: s, label: SPORT_LABELS[s], icon: SPORT_ICONS[s] }))}
        />
      </Field>
    </div>
  );
}

// ---- 5. Week ---------------------------------------------------------------

function WeekStep({ draft, setProfile }: StepProps) {
  const a = draft.profile.availability;
  const set = (patch: Partial<typeof a>) => setProfile({ availability: { ...a, ...patch } });
  const toggleDay = (d: number) => {
    const days = a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d].sort();
    set({ days, longDay: days.includes(a.longDay) ? a.longDay : (days[days.length - 1] ?? a.longDay) });
  };
  return (
    <div className="space-y-5">
      <Field label={`Training days (${a.days.length} per week)`} hint="Days you can fit an endurance session. The plan builds up to using all of them.">
        <DayPicker value={a.days} onToggle={toggleDay} />
      </Field>
      <Field label="Long day" hint="Your big weekly session, usually a weekend day with time for the mountains.">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_SHORT.map((label, d) => (
            <button
              key={label}
              type="button"
              disabled={!a.days.includes(d)}
              aria-pressed={a.longDay === d}
              onClick={() => set({ longDay: d })}
              className={`min-h-11 rounded-xl text-sm font-medium disabled:opacity-25 ${a.longDay === d ? "bg-ember text-white" : "bg-black/5 text-rock dark:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Maximum hours per week" hint="At the peak of the plan. Be realistic: consistency beats big weeks.">
        <NumberInput value={a.maxWeeklyHours} onChange={(v) => set({ maxWeeklyHours: v ?? 0 })} suffix="h" />
      </Field>
      <Field label="Longest session you can fit on a weekday">
        <DurationInput value={a.maxWeekdayMin} onChange={(v) => set({ maxWeekdayMin: v ?? 0 })} />
      </Field>
      <Toggle
        label="Back-to-back long days"
        description="Long day plus a medium day right after it. Key preparation for long mountain events."
        checked={a.backToBack}
        onChange={(backToBack) => set({ backToBack })}
      />
    </div>
  );
}

// ---- 6. Seasons & regular activities --------------------------------------

function SeasonsStep({ draft, setProfile }: StepProps) {
  const goalSet = goalSports(draft.goal) as Sport[];
  const rows = draft.profile.sports;
  const setRow = (i: number, patch: Partial<SportWindow>) => setProfile({ sports: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const acts = draft.profile.activities;
  const setAct = (i: number, patch: Partial<RegularActivity>) => setProfile({ activities: acts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const unusedActs = ACTIVITY_SPORTS.filter((s) => !acts.some((a) => a.sport === s));

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">When is each sport possible?</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              setProfile({
                sports: [
                  ...rows
                    .filter((r) => r.sport !== "ski_touring")
                    .map((r) => (["trail_run", "road_run", "hike", "mountaineering", "bike"].includes(r.sport) ? { ...r, from: "04-01", to: "11-30" } : r)),
                  { sport: "ski_touring", from: "12-01", to: "03-31" },
                ],
              })
            }
          >
            🎿 Winter = ski touring only
          </Button>
          <Button variant="secondary" onClick={() => setProfile({ sports: rows.map((r) => ({ ...r, ...ALL_YEAR })) })}>
            Everything all year
          </Button>
        </div>
        {rows.map((r, i) => (
          <Card key={r.sport} className="space-y-3">
            <div className="flex items-center gap-2 font-medium">
              <span aria-hidden>{SPORT_ICONS[r.sport]}</span>
              {SPORT_LABELS[r.sport]}
              {goalSet.includes(r.sport) && <Badge tone="accent">goal</Badge>}
            </div>
            <Toggle label="Possible all year" checked={isAllYear(r)} onChange={(v) => setRow(i, v ? ALL_YEAR : { from: "04-01", to: "11-30" })} />
            {!isAllYear(r) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="From">
                  <MonthDay label="From" value={r.from} onChange={(v) => setRow(i, { from: v })} />
                </Field>
                <Field label="To">
                  <MonthDay label="To" value={r.to} onChange={(v) => setRow(i, { to: v })} />
                </Field>
              </div>
            )}
          </Card>
        ))}
        <p className="text-xs text-rock">
          When a goal sport is out of season, the plan moves its aerobic and vertical work to the others. When it comes back, it's
          eased in over 3 weeks. Add or remove sports in the previous step.
        </p>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Regular activities</h2>
          <p className="text-xs text-rock">Things you'll keep doing every week, like climbing. The plan schedules around them.</p>
        </div>
        {acts.map((a, i) => (
          <Card key={`${a.sport}-${i}`} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <select className={`${inputClass} max-w-56`} value={a.sport} onChange={(e) => setAct(i, { sport: e.target.value as Sport })}>
                {[a.sport, ...unusedActs].map((s) => (
                  <option key={s} value={s}>
                    {SPORT_ICONS[s]} {SPORT_LABELS[s]}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={() => setProfile({ activities: acts.filter((_, j) => j !== i) })}>
                Remove
              </Button>
            </div>
            <Field label="Times per week">
              <CountPicker ariaLabel="Times per week" min={1} max={7} value={a.perWeek} onChange={(perWeek) => setAct(i, { perWeek, days: a.days.slice(0, perWeek) })} />
            </Field>
            <Field label="Usual days" hint={a.days.length < a.perWeek ? `Pick up to ${a.perWeek}. The plan places the rest.` : undefined}>
              <DayPicker
                value={a.days}
                onToggle={(d) => {
                  const days = a.days.includes(d) ? a.days.filter((x) => x !== d) : a.days.length < a.perWeek ? [...a.days, d].sort() : a.days;
                  setAct(i, { days });
                }}
              />
            </Field>
            <Field label="Typical duration">
              <DurationInput value={a.durationMin} onChange={(v) => setAct(i, { durationMin: Math.max(15, v ?? 15) })} />
            </Field>
          </Card>
        ))}
        <div className="flex flex-wrap gap-2">
          {!acts.some((a) => a.sport === "climbing") && (
            <Button variant="secondary" onClick={() => setProfile({ activities: [...acts, { sport: "climbing", perWeek: 2, days: [], durationMin: 120 }] })}>
              🧗 Climbing 2×/week
            </Button>
          )}
          {unusedActs.length > 0 && acts.length < 8 && (
            <Button variant="secondary" onClick={() => setProfile({ activities: [...acts, { sport: unusedActs[0]!, perWeek: 1, days: [], durationMin: 60 }] })}>
              + Add an activity
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

// ---- 7. Workouts -----------------------------------------------------------

function WorkoutsStep({ draft, setProfile }: StepProps) {
  const w = draft.profile.workouts;
  const t = draft.profile.terrain;
  const setW = (patch: Partial<typeof w>) => setProfile({ workouts: { ...w, ...patch } });
  const setT = (patch: Partial<typeof t>) => setProfile({ terrain: { ...t, ...patch } });
  return (
    <div className="space-y-5">
      <Toggle
        label="Structured workouts"
        description="Uphill intervals, tempo and downhill repeats. Turn this off for easy sessions only."
        checked={w.structured}
        onChange={(structured) => setW({ structured })}
      />
      <Field label="Strength sessions per week" hint="Strength is the best injury insurance for steep descents. 20–40 min each.">
        <CountPicker ariaLabel="Strength sessions per week" max={3} value={w.strengthPerWeek} onChange={(strengthPerWeek) => setW({ strengthPerWeek })} />
      </Field>
      <Field label="Equipment">
        <ChoiceCards<AthleteProfile["workouts"]["strengthAccess"]>
          value={w.strengthAccess}
          onChange={(strengthAccess) => setW({ strengthAccess })}
          columns={3}
          options={[
            { value: "none", label: "Bodyweight" },
            { value: "home", label: "Home kit" },
            { value: "gym", label: "Gym" },
          ]}
        />
      </Field>
      <Field label="Mobility sessions per week" hint="15–20 min routines: hips & ankles, a recovery flow after long days, spine & shoulders.">
        <CountPicker ariaLabel="Mobility sessions per week" max={7} value={w.mobilityPerWeek} onChange={(mobilityPerWeek) => setW({ mobilityPerWeek })} />
      </Field>
      <Field label="Biggest climb you can reach on a weekday" hint="One continuous climb near home or work. Used to suggest hill laps.">
        <NumberInput value={t.maxLocalClimbM} onChange={(v) => setT({ maxLocalClimbM: v ?? 0 })} suffix="m" integer />
      </Field>
      <Toggle label="Treadmill with incline (12%+)" checked={t.treadmillIncline} onChange={(treadmillIncline) => setT({ treadmillIncline })} />
      <Toggle label="Stairs / stair machine" checked={t.stairs} onChange={(stairs) => setT({ stairs })} />
    </div>
  );
}

// ---- 8. Health -------------------------------------------------------------

function HealthStep({ draft, setProfile }: StepProps) {
  const p = draft.profile;
  const strava = useStravaStatus();
  const summary = useStravaSummary(Boolean(strava.data?.connected));
  const observed = summary.data?.maxHrObserved ?? null;

  return (
    <div className="space-y-5">
      <Field label="Weight" hint="Used for nutrition targets. Once your scale is connected, it updates automatically.">
        <NumberInput value={p.weightKg} onChange={(v) => setProfile({ weightKg: v ?? 0 })} suffix="kg" />
      </Field>

      <div className="space-y-2">
        <Toggle
          label="I have a recent DEXA scan"
          description="From the last 12 months. Lean mass makes energy and protein targets much more accurate."
          checked={p.dexa.recent}
          onChange={(recent) => setProfile({ dexa: { recent, date: recent ? p.dexa.date : null } })}
        />
        {p.dexa.recent && (
          <Field label="Scan date" hint="You'll be able to upload the report in the Body section (coming soon) and it'll be read automatically.">
            <input type="date" className={inputClass} max={todayIso()} value={p.dexa.date ?? ""} onChange={(e) => setProfile({ dexa: { recent: true, date: e.target.value || null } })} />
          </Field>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Heart rate</h2>
        <p className="text-xs text-rock">Connect your accounts so heart-rate zones come from real data: during activities (Strava) and at rest (Garmin).</p>
        <Connections returnPath="/plan/new" />
        {observed && p.maxHr !== observed && (
          <Card className="flex items-center justify-between gap-3 text-sm">
            <span>
              Highest heart rate in your Strava activities: <strong>{observed} bpm</strong>
            </span>
            <Button variant="secondary" onClick={() => setProfile({ maxHr: observed })}>
              Use it
            </Button>
          </Card>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max heart rate">
            <NumberInput value={p.maxHr} allowEmpty integer onChange={(maxHr) => setProfile({ maxHr })} suffix="bpm" />
          </Field>
          <Field label="Resting heart rate" hint="Measure it lying down, first thing in the morning.">
            <NumberInput value={p.restingHr} allowEmpty integer onChange={(restingHr) => setProfile({ restingHr })} suffix="bpm" />
          </Field>
        </div>
      </div>

      <Field label="Injuries or niggles" hint="Past or current, e.g. Achilles tendinopathy 2024, left knee on long descents.">
        <textarea className={`${inputClass} min-h-24 py-2`} value={p.injuries} onChange={(e) => setProfile({ injuries: e.target.value })} />
      </Field>
    </div>
  );
}

// ---- 9. Review -------------------------------------------------------------

function ReviewStep({ draft, setDraft }: StepProps) {
  const preview = useMemo(() => {
    const req = planRequestSchema.safeParse(draft);
    if (!req.success) return { error: `${req.error.issues[0]?.path.join(" › ")}: ${req.error.issues[0]?.message}` } as const;
    try {
      return { plan: buildPlan(req.data) } as const;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Could not build the plan." } as const;
    }
  }, [draft]);
  const [weekIdx, setWeekIdx] = useState<number | null>(null);

  if ("error" in preview) return <Card className="text-sm text-ember">{preview.error}</Card>;
  const { plan } = preview;
  const s = plan.summary;
  const sampleIdx = weekIdx ?? plan.weeks.findIndex((w) => w.phase === "specific" && !w.isRecovery);
  const idx = sampleIdx >= 0 ? sampleIdx : 0;
  const sampleWeek = plan.weeks[idx]!;

  return (
    <div className="space-y-4">
      <Field label="Plan starts on" hint="Defaults to next Monday.">
        <input type="date" className={inputClass} value={draft.startDate} min={todayIso()} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Weeks", value: String(s.totalWeeks) },
          { label: draft.goal.targetTimeMin ? "Target time" : "Est. finish", value: fmtDuration(s.eventMinutes) },
          { label: "Peak week", value: `${fmtNumber(s.peakHours)} h` },
          { label: "Peak vertical", value: `${fmtNumber(s.peakVerticalM)} m` },
        ].map((t) => (
          <Card key={t.label} className="p-3">
            <div className="text-xs text-rock">{t.label}</div>
            <div className="text-lg font-semibold">{t.value}</div>
          </Card>
        ))}
      </div>

      {s.warnings.map((w) => (
        <Card key={w} className="border-ember/30 bg-ember/5 text-sm">
          ⚠️ {w}
        </Card>
      ))}

      <Card>
        <LoadChart weeks={plan.weeks} selectedIndex={idx} onSelect={setWeekIdx} />
        <p className="mt-2 text-xs text-rock">
          {s.phases.map((p) => `${PHASE_LABEL[p.phase]} ${p.weeks} wk`).join(" → ")}. Tap a week to preview it.
        </p>
      </Card>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          Week {idx + 1} · {fmtDate(sampleWeek.weekStart, { day: "numeric", month: "short" })} · {PHASE_LABEL[sampleWeek.phase]}
          {sampleWeek.isRecovery ? " (recovery)" : ""}
        </h3>
        {sampleWeek.notes.map((n) => (
          <p key={n} className="text-xs text-rock">
            {n}
          </p>
        ))}
        {(plan.workouts[idx] ?? []).map((w, i) => (
          <WorkoutCard key={i} workout={w} showDate />
        ))}
      </div>
    </div>
  );
}

// ---- step list -------------------------------------------------------------

const STEPS: Step[] = [
  {
    id: "sport",
    title: "What are you training for?",
    subtitle: "Pick one sport, or several for a multisport event.",
    render: (p) => <SportStep {...p} />,
  },
  {
    id: "event",
    title: "Your event",
    subtitle: "Distance, climbing and date drive the whole plan.",
    validate: (d) => {
      if (!d.goal.name.trim()) return "Give your event a name.";
      if (!d.goal.eventDate) return "Pick the event date.";
      if (d.goal.eventDate <= d.startDate) return "The event must be after the plan start date.";
      if (d.goal.legs.some((l) => !l.distanceKm)) return "Enter a distance for each leg.";
      const r = goalSchema.safeParse(d.goal);
      return r.success ? null : (r.error.issues[0]?.message ?? "Check the event details.");
    },
    render: (p) => <EventStep {...p} />,
  },
  {
    id: "you",
    title: "About you",
    subtitle: "Used for recovery cadence and heart-rate zones.",
    render: ({ draft, setProfile }) => {
      const p = draft.profile;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Age">
              <NumberInput value={p.age} onChange={(v) => setProfile({ age: v ?? 0 })} integer />
            </Field>
            <Field label="Sex">
              <select className={inputClass} value={p.sex} onChange={(e) => setProfile({ sex: e.target.value as AthleteProfile["sex"] })}>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="unspecified">Prefer not to say</option>
              </select>
            </Field>
          </div>
          <Field label="Experience with this kind of event">
            <ChoiceCards<AthleteProfile["experience"]>
              value={p.experience}
              onChange={(experience) => setProfile({ experience })}
              options={[
                { value: "beginner", label: "New to it", description: "First event of this size, or under a year of regular training" },
                { value: "intermediate", label: "Some experience", description: "Done a few similar events, train most weeks" },
                { value: "advanced", label: "Experienced", description: "Years of consistent training, raced this distance before" },
              ]}
            />
          </Field>
        </div>
      );
    },
    validate: (d) => (d.profile.age < 14 || d.profile.age > 90 ? "Enter an age between 14 and 90." : null),
  },
  {
    id: "current",
    title: "Your current training",
    subtitle: "Where you're starting from. The plan builds up from here.",
    render: (p) => <CurrentStep {...p} />,
  },
  {
    id: "week",
    title: "Your week",
    subtitle: "When can you train, and for how long?",
    validate: (d) => {
      const a = d.profile.availability;
      if (a.days.length < 2) return "Pick at least 2 training days.";
      if (!a.days.includes(a.longDay)) return "Your long day must be one of your training days.";
      if (a.maxWeeklyHours < 2) return "Allow at least 2 hours per week.";
      return null;
    },
    render: (p) => <WeekStep {...p} />,
  },
  {
    id: "seasons",
    title: "Seasons & regular activities",
    subtitle: "Winter only allows skiing? You climb twice a week? The plan adapts.",
    validate: (d) => {
      for (const w of d.profile.sports) if (w.from === w.to) return `${SPORT_LABELS[w.sport]}: the season can't start and end on the same day.`;
      return null;
    },
    render: (p) => <SeasonsStep {...p} />,
  },
  {
    id: "workouts",
    title: "Workouts & terrain",
    subtitle: "What kind of training can you do?",
    render: (p) => <WorkoutsStep {...p} />,
  },
  {
    id: "health",
    title: "Health",
    subtitle: "Weight, body composition and heart rate.",
    validate: (d) => {
      if (d.profile.weightKg < 30 || d.profile.weightKg > 250) return "Enter your weight in kg.";
      if (d.profile.dexa.recent && !d.profile.dexa.date) return "Add the date of your DEXA scan.";
      if (d.profile.maxHr !== null && (d.profile.maxHr < 120 || d.profile.maxHr > 230)) return "Max heart rate should be between 120 and 230.";
      if (d.profile.restingHr !== null && (d.profile.restingHr < 30 || d.profile.restingHr > 100)) return "Resting heart rate should be between 30 and 100.";
      return null;
    },
    render: (p) => <HealthStep {...p} />,
  },
  {
    id: "review",
    title: "Your plan",
    subtitle: "Check the shape of the plan, then create it.",
    validate: (d) => {
      const r = planRequestSchema.safeParse(d);
      if (!r.success) return `${r.error.issues[0]?.path.join(" › ")}: ${r.error.issues[0]?.message}`;
      return null;
    },
    render: (p) => <ReviewStep {...p} />,
  },
];

// ---------------------------------------------------------------------------
// Wizard shell
// ---------------------------------------------------------------------------

export function PlanWizardPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const current = useQuery({ queryKey: ["plan", "current"], queryFn: () => api<CurrentPlanDto>("/plan/current") });
  const [state, setState] = useState<Stored | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stravaResult = params.get("strava");

  useEffect(() => {
    if (state || current.isPending) return;
    const stored = loadStored();
    const saved = current.data?.profile ?? null;
    setState(stored ?? { draft: defaultDraft(saved && athleteProfileSchema.safeParse(saved).success ? saved : null), step: 0 });
  }, [current.isPending, current.data, state]);

  useEffect(() => {
    if (stravaResult) qc.invalidateQueries({ queryKey: ["strava"] });
  }, [stravaResult, qc]);

  const update = (next: Stored) => {
    setState(next);
    saveStored(next);
  };

  const create = useMutation({
    mutationFn: (d: Draft) => api<{ id: number }>("/plan", { method: "POST", body: JSON.stringify(planRequestSchema.parse(d)) }),
    onSuccess: async () => {
      saveStored(null);
      await qc.invalidateQueries({ queryKey: ["plan"] });
      navigate("/plan");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Something went wrong."),
  });

  if (!state) return <p className="pt-4 text-sm text-rock">Loading…</p>;

  const { draft, step } = state;
  const s = STEPS[step]!;
  const isLast = step === STEPS.length - 1;
  const setDraft = (d: Draft) => {
    update({ draft: d, step });
    setError(null);
  };
  const props: StepProps = {
    draft,
    setDraft,
    setGoal: (patch) => {
      const goal = { ...draft.goal, ...patch };
      setDraft({ ...draft, goal, profile: withGoalSportRows(draft.profile, goal) });
    },
    setProfile: (patch) => setDraft({ ...draft, profile: { ...draft.profile, ...patch } }),
  };
  const goTo = (n: number) => {
    update({ draft, step: n });
    setError(null);
    if (stravaResult) setParams({}, { replace: true });
    window.scrollTo({ top: 0 });
  };

  const next = () => {
    const err = s.validate?.(draft) ?? null;
    if (err) return setError(err);
    if (isLast) create.mutate(draft);
    else goTo(step + 1);
  };

  return (
    <section className="space-y-5 pt-2 pb-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-rock">
          <button type="button" className="min-h-9" onClick={() => (step === 0 ? navigate("/plan") : goTo(step - 1))}>
            ← {step === 0 ? "Cancel" : "Back"}
          </button>
          <span>
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          <div className="h-full rounded-full bg-pine transition-all dark:bg-emerald-300" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
      </div>

      {stravaResult && (
        <Card className={`text-sm ${stravaResult === "connected" ? "" : "border-ember/30 bg-ember/5"}`}>
          {stravaResult === "connected"
            ? "✅ Strava connected."
            : stravaResult === "missing_scope"
              ? "Strava was connected without access to your activities. Connect again and keep “View data about your activities” ticked."
              : "Strava connection was cancelled."}
        </Card>
      )}

      <header>
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="mt-1 text-sm text-rock">{s.subtitle}</p>
      </header>

      {s.render(props)}

      {error && (
        <p className="text-sm text-ember" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-20 pt-2">
        <Button className="w-full shadow-lg" onClick={next} disabled={create.isPending}>
          {isLast ? (create.isPending ? "Creating…" : "Create my plan") : "Continue"}
        </Button>
      </div>
    </section>
  );
}
