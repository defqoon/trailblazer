import { SPORT_ICONS, SPORT_LABELS, type PlannedWorkoutDraft, type WorkoutDto, type WorkoutStatus } from "@trailblazer/shared";
import { useState } from "react";
import { fmtDate, fmtDuration, fmtNumber } from "../lib/format";
import { Badge, Button } from "./ui";

type W = PlannedWorkoutDraft | WorkoutDto;

export function WorkoutCard({
  workout: w,
  showDate = false,
  onStatus,
  busy = false,
}: {
  workout: W;
  showDate?: boolean;
  onStatus?: (s: WorkoutStatus) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = "status" in w ? w.status : "planned";
  const done = status === "done";
  const skipped = status === "skipped";

  return (
    <div
      className={`rounded-2xl border bg-white transition dark:bg-neutral-900 ${
        w.type === "race" ? "border-ember/50" : "border-black/10 dark:border-white/10"
      } ${skipped ? "opacity-50" : ""}`}
    >
      <button type="button" className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="mt-0.5 text-xl leading-none" aria-label={SPORT_LABELS[w.sport]}>
          {done ? "✅" : SPORT_ICONS[w.sport]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`font-medium ${skipped ? "line-through" : ""}`}>{w.title}</span>
            {w.key && w.type !== "race" && <Badge tone="accent">key</Badge>}
            {w.type === "race" && <Badge tone="warn">race day</Badge>}
          </span>
          <span className="mt-0.5 block text-xs text-rock">
            {showDate && `${fmtDate(w.date)} · `}
            {fmtDuration(w.durationMin)}
            {w.verticalM ? ` · ${fmtNumber(w.verticalM)} m D+` : ""}
            {w.distanceKm ? ` · ${fmtNumber(w.distanceKm)} km` : ""}
            {w.intensity ? ` · ${w.intensity}` : ""}
          </span>
        </span>
        <span className="text-rock" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 pt-3 pb-3 dark:border-white/5">
          <p className="text-sm leading-relaxed">{w.description}</p>
          <ol className="space-y-1.5">
            {w.steps.map((s, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg bg-black/[0.03] px-2.5 py-1.5 text-sm dark:bg-white/5">
                <span>
                  {s.repeat ? <span className="font-semibold">{s.repeat}× </span> : null}
                  {s.label}
                  {s.notes && <span className="block text-xs text-rock">{s.notes}</span>}
                </span>
                <span className="shrink-0 text-xs text-rock">
                  {s.durationMin ? fmtDuration(s.durationMin) : ""} {s.intensity}
                </span>
              </li>
            ))}
          </ol>
          {onStatus && (
            <div className="flex gap-2">
              <Button variant={done ? "primary" : "secondary"} className="flex-1" disabled={busy} onClick={() => onStatus(done ? "planned" : "done")}>
                {done ? "Done ✓" : "Mark done"}
              </Button>
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => onStatus(skipped ? "planned" : "skipped")}>
                {skipped ? "Undo skip" : "Skip"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
