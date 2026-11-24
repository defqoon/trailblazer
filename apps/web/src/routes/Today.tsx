import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Badge, Button, Card } from "../components/ui";
import { api } from "../lib/api";
import { localIsoDate, useNutritionDay } from "../lib/nutrition";

export function TodayPage() {
  const today = localIsoDate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("/me") });
  const dayQuery = useNutritionDay(today);
  const day = dayQuery.data;

  const usedPct =
    day && day.targets.adjustedKcal > 0
      ? Math.min(100, Math.round((day.totals.kcal / day.targets.adjustedKcal) * 100))
      : 0;

  return (
    <section className="space-y-4 pt-2">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Today</h1>
        {me.data && <span className="text-xs text-rock">{me.data.email}</span>}
      </div>

      {me.isError && (
        <Card className="text-sm text-ember">
          Couldn't reach the API. Are you signed in through Cloudflare Access?
        </Card>
      )}

      {day && (
        <>
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-rock">Calorie budget</p>
                <p className="text-2xl font-bold text-pine dark:text-emerald-200">
                  {day.remainingKcal >= 0
                    ? `${Math.round(day.remainingKcal)} kcal left`
                    : `${Math.abs(Math.round(day.remainingKcal))} kcal over`}
                </p>
              </div>
              <Link to="/food">
                <Button className="min-h-9 px-3 text-xs">Log meal</Button>
              </Link>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className={`h-full rounded-full ${
                  day.remainingKcal < 0 ? "bg-ember" : day.alertTriggered ? "bg-amber-500" : "bg-pine dark:bg-emerald-400"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-rock">
              <span>
                Goal {day.targets.baseKcal} + Workouts {day.targets.workoutCreditKcal} − Food {day.totals.kcal}
              </span>
              <span>
                P {Math.round(day.totals.proteinG)}/{day.targets.macros.proteinG}g · C {Math.round(day.totals.carbsG)}/
                {day.targets.macros.carbsG}g · F {Math.round(day.totals.fatG)}/{day.targets.macros.fatG}g
              </span>
            </div>

            {day.recommendations[0] && (
              <div className="rounded-xl bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.04]">
                <span className="font-semibold">{day.recommendations[0].title}: </span>
                <span className="text-rock">{day.recommendations[0].body}</span>
              </div>
            )}
          </Card>

          {day.weightTrend.weighInDue && (
            <Card className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  Weekly weigh-in check <Badge tone="warn">due</Badge>
                </div>
                <p className="text-xs text-rock">
                  Step on your Renpho scale or log a quick weigh-in so your weekly trend stays up to date.
                </p>
              </div>
              <Link to="/food">
                <Button variant="secondary" className="min-h-9 shrink-0 px-3 text-xs">
                  Log
                </Button>
              </Link>
            </Card>
          )}

          {day.plannedToday.length > 0 && (
            <Card className="space-y-2">
              <h2 className="text-sm font-semibold">Planned today</h2>
              <ul className="space-y-1.5 text-xs">
                {day.plannedToday.map((w) => (
                  <li key={w.id} className="flex items-center justify-between">
                    <span className="font-medium">{w.title}</span>
                    <span className="text-rock">
                      {Math.round(w.durationMin)} min · {w.status}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
