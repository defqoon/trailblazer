import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, goalTotals, isEndurance, SPORT_ICONS, SPORT_LABELS, type CurrentPlanDto, type WorkoutStatus } from "@trailblazer/shared";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LoadChart } from "../components/LoadChart";
import { Badge, Button, Card } from "../components/ui";
import { WorkoutCard } from "../components/WorkoutCard";
import { api } from "../lib/api";
import { fmtDate, fmtDuration, fmtNumber, PHASE_LABEL, todayIso } from "../lib/format";

export function PlanPage() {
  const q = useQuery({ queryKey: ["plan", "current"], queryFn: () => api<CurrentPlanDto>("/plan/current") });
  if (q.isPending) return <p className="pt-4 text-sm text-rock">Loading your plan…</p>;
  if (q.isError) return <p className="pt-4 text-sm text-ember">Couldn't load your plan: {q.error.message}</p>;
  if (!q.data.plan || !q.data.goal) return <NoPlan />;
  return <PlanView data={q.data} />;
}

function NoPlan() {
  return (
    <section className="space-y-4 pt-6 text-center">
      <div className="text-5xl" aria-hidden>
        ⛰️
      </div>
      <h1 className="text-2xl font-semibold">No training plan yet</h1>
      <p className="mx-auto max-w-sm text-sm text-rock">
        Tell us about your goal: sport, distance, climbing and date. We'll build a week-by-week plan around your schedule, your
        seasons and the other sports you do.
      </p>
      <Link to="/plan/new" className="inline-flex min-h-11 items-center rounded-xl bg-pine px-5 text-sm font-medium text-white dark:bg-emerald-300 dark:text-neutral-950">
        Create my plan
      </Link>
    </section>
  );
}

function PlanView({ data }: { data: CurrentPlanDto }) {
  const goal = data.goal!;
  const summary = data.plan!.summary;
  const weeks = data.weeks;
  const today = todayIso();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const currentIndex = (() => {
    const i = weeks.findIndex((w) => today >= w.weekStart && today < addDays(w.weekStart, 7));
    if (i >= 0) return i;
    return weeks.length && today < weeks[0]!.weekStart ? 0 : weeks.length - 1;
  })();
  const [selected, setSelected] = useState(currentIndex);
  const week = weeks[selected]!;

  const daysToGo = Math.ceil((new Date(`${goal.eventDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  const endurance = week.workouts.filter(isEndurance);
  const totals = goalTotals(goal);
  const multi = goal.legs.length > 1;
  const plannedMin = endurance.reduce((a, w) => a + w.durationMin, 0);
  const plannedVert = endurance.reduce((a, w) => a + (w.verticalM ?? 0), 0);
  const doneMin = endurance.filter((w) => w.status === "done").reduce((a, w) => a + w.durationMin, 0);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: WorkoutStatus }) =>
      api(`/workouts/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", "current"] }),
  });

  const archive = useMutation({
    mutationFn: () => api("/plan/current", { method: "DELETE" }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["plan"] });
      navigate("/plan/new");
    },
  });

  return (
    <section className="space-y-4 pt-2">
      <Card className="space-y-1">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-rock">
              <span aria-hidden>{goal.legs.map((l) => SPORT_ICONS[l.sport]).join(" ")}</span> {fmtDate(goal.eventDate, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}
            </div>
            <h1 className="text-xl font-semibold">{goal.name}</h1>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold">{Math.max(0, daysToGo)}</div>
            <div className="text-xs text-rock">days to go</div>
          </div>
        </div>
        <p className="text-sm text-rock">
          {fmtNumber(totals.distanceKm)} km · {fmtNumber(totals.elevationGainM)} m D+ · {goal.targetTimeMin ? "target" : "est."}{" "}
          {fmtDuration(summary.eventMinutes)}
        </p>
        {multi && (
          <p className="text-xs text-rock">
            Multisport: {goal.legs.map((l) => `${SPORT_LABELS[l.sport]} ${fmtNumber(l.distanceKm)} km`).join(" → ")}
          </p>
        )}
      </Card>

      {summary.warnings.length > 0 && (
        <details className="rounded-2xl border border-ember/30 bg-ember/5 p-3 text-sm">
          <summary className="cursor-pointer font-medium">⚠️ {summary.warnings.length} note{summary.warnings.length > 1 ? "s" : ""} about this plan</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      <Card>
        <LoadChart weeks={weeks} currentIndex={currentIndex} selectedIndex={selected} onSelect={setSelected} />
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" aria-label="Previous week" disabled={selected === 0} onClick={() => setSelected(selected - 1)}>
          ‹
        </Button>
        <div className="text-center">
          <div className="font-semibold">
            Week {selected + 1} of {weeks.length}
            {selected === currentIndex && <span className="text-rock"> · this week</span>}
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-rock">
            {fmtDate(week.weekStart, { day: "numeric", month: "short" })} – {fmtDate(addDays(week.weekStart, 6), { day: "numeric", month: "short" })}
            <Badge>{PHASE_LABEL[week.phase]}</Badge>
            {week.isRecovery && <Badge tone="accent">recovery</Badge>}
          </div>
        </div>
        <Button variant="secondary" aria-label="Next week" disabled={selected === weeks.length - 1} onClick={() => setSelected(selected + 1)}>
          ›
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Time", value: fmtDuration(plannedMin), sub: doneMin ? `${fmtDuration(doneMin)} done` : `target ${fmtNumber(week.targetHours)} h` },
          { label: "Vertical", value: `${fmtNumber(plannedVert)} m`, sub: `target ${fmtNumber(week.targetVerticalM)} m` },
          { label: "Long day", value: week.targetLongMin ? fmtDuration(week.targetLongMin) : "–", sub: week.sports.map((s) => SPORT_ICONS[s]).join(" ") },
        ].map((t) => (
          <Card key={t.label} className="p-3">
            <div className="text-xs text-rock">{t.label}</div>
            <div className="font-semibold">{t.value}</div>
            <div className="text-xs text-rock">{t.sub}</div>
          </Card>
        ))}
      </div>

      {week.notes.length > 0 && (
        <ul className="space-y-1 text-sm text-rock">
          {week.notes.map((n) => (
            <li key={n}>💡 {n}</li>
          ))}
        </ul>
      )}

      <ol className="space-y-3">
        {Array.from({ length: 7 }, (_, d) => addDays(week.weekStart, d)).map((date) => {
          const ws = week.workouts.filter((w) => w.date === date);
          return (
            <li key={date} className="space-y-1.5">
              <div className={`text-xs font-medium uppercase tracking-wide ${date === today ? "text-pine dark:text-emerald-300" : "text-rock"}`}>
                {fmtDate(date)} {date === today && "· today"}
              </div>
              {ws.length ? (
                ws.map((w) => (
                  <WorkoutCard
                    key={w.id}
                    workout={w}
                    busy={setStatus.isPending}
                    onStatus={(status) => setStatus.mutate({ id: w.id, status })}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-black/10 px-3 py-2 text-sm text-rock dark:border-white/10">Rest</div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="border-t border-black/10 pt-4 dark:border-white/10">
        <Button
          variant="danger"
          className="w-full"
          disabled={archive.isPending}
          onClick={() => {
            if (confirm("Archive this plan and set up a new one? Your profile is kept so the wizard is pre-filled.")) archive.mutate();
          }}
        >
          Start a new plan
        </Button>
      </div>
    </section>
  );
}
