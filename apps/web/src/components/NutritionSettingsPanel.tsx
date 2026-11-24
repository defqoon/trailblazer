import type { ActivityLevel, NutritionSettings, TrainingFocusSetting, WeightGoal } from "@trailblazer/shared";
import { useEffect, useState } from "react";
import {
  notificationPermission,
  requestNotificationPermission,
  syncWeeklyWeighInReminder,
} from "../lib/notifications";
import { useSaveNutritionSettings } from "../lib/nutrition";
import { Badge, Button, Card, Field, inputClass, NumberInput } from "./ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function NutritionSettingsPanel({
  settings,
  bmrLabel,
  bmrKcal,
  onSaved,
}: {
  settings: NutritionSettings;
  bmrLabel: string;
  bmrKcal: number;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<NutritionSettings>(settings);
  const [perm, setPerm] = useState<"granted" | "denied" | "prompt" | "unsupported">("prompt");
  const save = useSaveNutritionSettings();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    notificationPermission().then(setPerm);
  }, []);

  const update = <K extends keyof NutritionSettings>(key: K, val: NutritionSettings[K]) =>
    setDraft((prev) => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    const res = await save.mutateAsync(draft);
    await syncWeeklyWeighInReminder(res.settings);
    onSaved?.();
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Nutrition targets & alerts</h2>
          <p className="text-xs text-rock">
            Current BMR: {bmrKcal} kcal ({bmrLabel})
          </p>
        </div>
        <Badge tone="accent">{draft.mode === "auto" ? "Auto-calculated" : "Manual target"}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={draft.mode === "auto" ? "primary" : "secondary"}
          onClick={() => update("mode", "auto")}
        >
          Auto (DEXA + Plan)
        </Button>
        <Button
          variant={draft.mode === "manual" ? "primary" : "secondary"}
          onClick={() => update("mode", "manual")}
        >
          Manual daily kcal
        </Button>
      </div>

      {draft.mode === "manual" ? (
        <Field label="Base daily calorie target" hint="Workouts logged today are still added on top.">
          <NumberInput
            value={draft.manualKcal ?? 2000}
            onChange={(v) => update("manualKcal", v)}
            suffix="kcal"
            integer
          />
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Weight goal">
            <select
              className={inputClass}
              value={draft.weightGoal}
              onChange={(e) => update("weightGoal", e.target.value as WeightGoal)}
            >
              <option value="lose_slow">Lose slowly (−250 kcal/day)</option>
              <option value="lose">Lose weight (−450 kcal/day)</option>
              <option value="maintain">Maintain weight (0)</option>
              <option value="gain">Gain muscle (+250 kcal/day)</option>
            </select>
          </Field>

          <Field label="Training focus" hint="Shapes protein vs carb macro split.">
            <select
              className={inputClass}
              value={draft.trainingFocus}
              onChange={(e) => update("trainingFocus", e.target.value as TrainingFocusSetting)}
            >
              <option value="auto">Auto (from active plan)</option>
              <option value="endurance">Endurance / long-distance running</option>
              <option value="strength">Strength / muscle gain</option>
              <option value="hybrid">Hybrid (endurance + strength)</option>
            </select>
          </Field>

          <Field label="DEXA scan RMR / BMR" hint="Enter directly from your DEXA report if you have it.">
            <NumberInput
              value={draft.dexaBmrKcal}
              onChange={(v) => update("dexaBmrKcal", v)}
              suffix="kcal"
              allowEmpty
              integer
            />
          </Field>

          <Field label="DEXA lean mass (optional)" hint="Used for Katch-McArdle BMR if RMR is blank.">
            <NumberInput
              value={draft.dexaLeanMassKg}
              onChange={(v) => update("dexaLeanMassKg", v)}
              suffix="kg"
              allowEmpty
            />
          </Field>

          <Field label="Non-workout daily activity" hint="Baseline movement outside logged workouts.">
            <select
              className={inputClass}
              value={draft.activityLevel}
              onChange={(e) => update("activityLevel", e.target.value as ActivityLevel)}
            >
              <option value="sedentary">Desk / sedentary (1.2× BMR)</option>
              <option value="light">Lightly active (1.3× BMR)</option>
              <option value="moderate">On your feet all day (1.4× BMR)</option>
            </select>
          </Field>

          <Field label="Workout calories added back" hint="Default 75% (watches tend to slightly overestimate burn).">
            <NumberInput
              value={draft.workoutEatBackPct}
              onChange={(v) => update("workoutEatBackPct", Math.min(100, Math.max(0, v ?? 75)))}
              suffix="%"
              integer
            />
          </Field>
        </div>
      )}

      <div className="space-y-3 border-t border-black/10 pt-3 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Alerts & reminders</h3>
          {perm !== "granted" && perm !== "unsupported" && (
            <Button
              variant="secondary"
              className="min-h-8 px-3 text-xs"
              onClick={async () => {
                const ok = await requestNotificationPermission();
                setPerm(ok ? "granted" : "denied");
              }}
            >
              Enable notifications
            </Button>
          )}
          {perm === "granted" && <Badge tone="accent">notifications on</Badge>}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Snacking / limit alert at" hint="Notify once per day when you cross this % of budget.">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.calorieAlertEnabled}
                onChange={(e) => update("calorieAlertEnabled", e.target.checked)}
                className="h-4 w-4 accent-pine"
              />
              <div className="flex-1">
                <NumberInput
                  value={draft.calorieAlertPct}
                  onChange={(v) => update("calorieAlertPct", Math.min(100, Math.max(50, v ?? 85)))}
                  suffix="%"
                  integer
                />
              </div>
            </div>
          </Field>

          <Field label="Follow-up question threshold" hint="Ask clarifying questions if estimate range exceeds this.">
            <NumberInput
              value={draft.uncertaintyThresholdKcal}
              onChange={(v) => update("uncertaintyThresholdKcal", Math.min(1000, Math.max(50, v ?? 200)))}
              suffix="kcal"
              integer
            />
          </Field>

          <Field label="Weekly weigh-in reminder" hint="Gentle once-a-week nudge to keep your trend accurate.">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.weighInReminderEnabled}
                onChange={(e) => update("weighInReminderEnabled", e.target.checked)}
                className="h-4 w-4 accent-pine"
              />
              <select
                className={inputClass}
                value={draft.weighInReminderDay}
                onChange={(e) => update("weighInReminderDay", Number(e.target.value))}
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="time"
                className={inputClass}
                value={draft.weighInReminderTime}
                onChange={(e) => update("weighInReminderTime", e.target.value)}
              />
            </div>
          </Field>
        </div>
      </div>

      {save.isError && <p className="text-xs text-ember">{save.error.message}</p>}

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save targets"}
        </Button>
      </div>
    </Card>
  );
}
