import {
  MEAL_TYPES,
  type FoodClarificationTurn,
  type FoodEstimateResponseDto,
  type MealType,
} from "@trailblazer/shared";
import { useEffect, useRef, useState } from "react";
import { NutritionSettingsPanel } from "../components/NutritionSettingsPanel";
import { Badge, Button, Card, inputClass, NumberInput } from "../components/ui";
import { WeightProgressCard } from "../components/WeightProgressCard";
import { maybeNotifyCalorieLimit, syncWeeklyWeighInReminder } from "../lib/notifications";
import {
  localIsoDate,
  shiftIsoDate,
  useDeleteFoodEntry,
  useEstimateFood,
  useNutritionDay,
  useSaveFoodEntry,
  useSpeechDictation,
} from "../lib/nutrition";

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  during_activity: "Fueling",
};

function defaultMealForHour(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}

function MacroBar({
  label,
  value,
  target,
  colorClass,
}: {
  label: string;
  value: number;
  target: number;
  colorClass: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-rock">
          <strong className="text-neutral-900 dark:text-neutral-100">{Math.round(value)}g</strong> / {target}g
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div className={`h-full rounded-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function FoodPage() {
  const today = localIsoDate();
  const [date, setDate] = useState(today);
  const [showSettings, setShowSettings] = useState(false);

  // Composer state
  const [meal, setMeal] = useState<MealType>(defaultMealForHour);
  const [description, setDescription] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [draftEstimate, setDraftEstimate] = useState<FoodEstimateResponseDto | null>(null);
  const [clarifications, setClarifications] = useState<FoodClarificationTurn[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [editedKcal, setEditedKcal] = useState<number | null>(null);
  const [editedProtein, setEditedProtein] = useState<number | null>(null);
  const [editedCarbs, setEditedCarbs] = useState<number | null>(null);
  const [editedFat, setEditedFat] = useState<number | null>(null);
  const [userCorrected, setUserCorrected] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const dayQuery = useNutritionDay(date);
  const estimateMut = useEstimateFood();
  const saveEntry = useSaveFoodEntry();
  const deleteEntry = useDeleteFoodEntry();

  const dictation = useSpeechDictation((transcript) => {
    setDescription((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
  });

  const day = dayQuery.data;

  // Trigger native/web calorie alert once per day if viewing today and threshold crossed
  useEffect(() => {
    if (!day || date !== today) return;
    maybeNotifyCalorieLimit({
      date: day.date,
      remainingKcal: day.remainingKcal,
      alertTriggered: day.alertTriggered,
      enabled: day.settings.calorieAlertEnabled,
    });
    syncWeeklyWeighInReminder(day.settings);
  }, [day, date, today]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const applyEstimateResult = (res: FoodEstimateResponseDto) => {
    setDraftEstimate(res);
    setEditedKcal(res.estimate.totalKcal);
    setEditedProtein(res.estimate.proteinG);
    setEditedCarbs(res.estimate.carbsG);
    setEditedFat(res.estimate.fatG);
    setUserCorrected(false);
    setAnswers({});
  };

  const handlePhotoChange = (file: File | null) => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(file ? URL.createObjectURL(file) : null);
  };

  const handleEstimate = async () => {
    if (!description.trim() && !photoFile) return;
    setClarifications([]);
    const res = await estimateMut.mutateAsync({
      description,
      meal,
      photo: photoFile,
    });
    applyEstimateResult(res);
  };

  const handleRefine = async () => {
    if (!draftEstimate) return;
    const newTurns: FoodClarificationTurn[] = draftEstimate.estimate.followUpQuestions
      .map((q) => ({ question: q.question, answer: (answers[q.id] ?? "").trim() }))
      .filter((t) => t.answer.length > 0);
    if (newTurns.length === 0) return;

    const merged = [...clarifications, ...newTurns];
    setClarifications(merged);
    const res = await estimateMut.mutateAsync({
      description,
      meal,
      photoKey: draftEstimate.photoKey,
      clarifications: merged,
    });
    applyEstimateResult(res);
  };

  const resetComposer = () => {
    setDescription("");
    handlePhotoChange(null);
    setDraftEstimate(null);
    setClarifications([]);
    setAnswers({});
    setEditedKcal(null);
    setEditedProtein(null);
    setEditedCarbs(null);
    setEditedFat(null);
    setUserCorrected(false);
    estimateMut.reset();
  };

  const handleSaveMeal = async () => {
    if (!draftEstimate) return;
    const est = draftEstimate.estimate;
    const eatenAt = date === today ? new Date().toISOString() : `${date}T12:00:00.000Z`;
    await saveEntry.mutateAsync({
      eatenAt,
      meal,
      description: description.trim() || est.items.map((i) => i.name).join(", ") || "Logged meal",
      photoKey: draftEstimate.photoKey,
      items: est.items,
      kcal: editedKcal ?? est.totalKcal,
      kcalMin: est.kcalMin,
      kcalMax: est.kcalMax,
      proteinG: editedProtein ?? est.proteinG,
      carbsG: editedCarbs ?? est.carbsG,
      fatG: editedFat ?? est.fatG,
      confidence: est.confidence,
      userCorrected,
    });
    resetComposer();
  };

  const usedPct =
    day && day.targets.adjustedKcal > 0
      ? Math.min(100, Math.round((day.totals.kcal / day.targets.adjustedKcal) * 100))
      : 0;

  return (
    <section className="space-y-4 pt-2 pb-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Food</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="min-h-9 px-2.5 text-xs" onClick={() => setDate((d) => shiftIsoDate(d, -1))}>
            ←
          </Button>
          <span className="min-w-24 text-center text-xs font-medium text-rock">
            {date === today ? "Today" : date}
          </span>
          <Button
            variant="ghost"
            className="min-h-9 px-2.5 text-xs"
            disabled={date >= today}
            onClick={() => setDate((d) => shiftIsoDate(d, 1))}
          >
            →
          </Button>
          <Button
            variant="secondary"
            className="ml-1 min-h-9 px-3 text-xs"
            onClick={() => setShowSettings((s) => !s)}
          >
            {showSettings ? "Done" : "Targets"}
          </Button>
        </div>
      </div>

      {dayQuery.isPending && <Card className="text-sm text-rock">Loading today's nutrition…</Card>}
      {dayQuery.isError && <Card className="text-sm text-ember">Could not load nutrition: {dayQuery.error.message}</Card>}

      {day && (
        <>
          {showSettings && (
            <NutritionSettingsPanel
              settings={day.settings}
              bmrLabel={day.targets.bmr.label}
              bmrKcal={day.targets.bmr.bmrKcal}
              onSaved={() => setShowSettings(false)}
            />
          )}

          {/* Daily Calorie Budget Card */}
          <Card className="space-y-3">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-rock">Remaining today</p>
                <p
                  className={`text-3xl font-bold tracking-tight ${
                    day.remainingKcal < 0
                      ? "text-ember"
                      : day.alertTriggered
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-pine dark:text-emerald-200"
                  }`}
                >
                  {day.remainingKcal >= 0
                    ? `${Math.round(day.remainingKcal)} kcal`
                    : `${Math.abs(Math.round(day.remainingKcal))} kcal over`}
                </p>
              </div>
              <div className="text-right text-xs text-rock">
                <Badge tone="accent">{day.targets.trainingFocus}</Badge>
                <p className="mt-1">{usedPct}% of {day.targets.adjustedKcal} kcal</p>
              </div>
            </div>

            <div className="h-2.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div
                className={`h-full rounded-full transition-all ${
                  day.remainingKcal < 0
                    ? "bg-ember"
                    : day.alertTriggered
                      ? "bg-amber-500"
                      : "bg-pine dark:bg-emerald-400"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-xl bg-black/[0.03] p-2.5 text-center text-xs dark:bg-white/[0.04]">
              <div>
                <div className="text-rock">Morning goal</div>
                <div className="font-semibold">{day.targets.baseKcal}</div>
              </div>
              <div>
                <div className="text-rock">+ Workouts</div>
                <div className="font-semibold text-moss dark:text-emerald-300">+{day.targets.workoutCreditKcal}</div>
              </div>
              <div>
                <div className="text-rock">− Food</div>
                <div className="font-semibold">−{day.totals.kcal}</div>
              </div>
            </div>

            {day.targets.heavyDayGuardApplied && (
              <p className="text-xs text-rock">
                Heavy training day guard active: deficit softened to −250 kcal to protect recovery.
              </p>
            )}

            {/* Macros */}
            <div className="grid gap-2.5 pt-1 sm:grid-cols-3">
              <MacroBar
                label="Protein"
                value={day.totals.proteinG}
                target={day.targets.macros.proteinG}
                colorClass="bg-pine dark:bg-emerald-400"
              />
              <MacroBar
                label="Carbs"
                value={day.totals.carbsG}
                target={day.targets.macros.carbsG}
                colorClass="bg-sky-600 dark:bg-sky-400"
              />
              <MacroBar
                label="Fat"
                value={day.totals.fatG}
                target={day.targets.macros.fatG}
                colorClass="bg-amber-500"
              />
            </div>

            {/* Recommendations */}
            {day.recommendations.length > 0 && (
              <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
                {day.recommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className={`rounded-xl px-3 py-2 text-xs ${
                      rec.tone === "warn"
                        ? "bg-ember/10 text-ember"
                        : rec.tone === "success"
                          ? "bg-moss/10 text-pine dark:text-emerald-200"
                          : "bg-black/[0.03] text-neutral-800 dark:bg-white/[0.05] dark:text-neutral-200"
                    }`}
                  >
                    <div className="font-semibold">{rec.title}</div>
                    <div className="opacity-90">{rec.body}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Meal Composer */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Log a meal</h2>
              {draftEstimate && (
                <Button variant="ghost" className="min-h-8 px-2 text-xs" onClick={resetComposer}>
                  Clear
                </Button>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {MEAL_TYPES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMeal(m)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    meal === m
                      ? "bg-pine text-white dark:bg-emerald-300 dark:text-neutral-950"
                      : "bg-black/5 text-rock hover:bg-black/10 dark:bg-white/10"
                  }`}
                >
                  {MEAL_LABELS[m]}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              className={`${inputClass} py-2.5 text-sm`}
              placeholder='Describe or dictate what you ate, e.g. "100g oatmeal with soy milk, yogurt, a bit of honey and protein powder"'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {photoPreview && (
              <div className="relative inline-block">
                <img src={photoPreview} alt="Meal preview" className="h-28 w-28 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => handlePhotoChange(null)}
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white"
                  aria-label="Remove photo"
                >
                  ×
                </button>
              </div>
            )}

            {dictation.error && <p className="text-xs text-ember">{dictation.error}</p>}

            <div className="flex flex-wrap items-center gap-2">
              {dictation.supported && (
                <Button
                  variant={dictation.listening ? "danger" : "secondary"}
                  className="min-h-10 px-3 text-xs"
                  onClick={dictation.toggle}
                >
                  {dictation.listening ? "⏹ Stop dictating" : "🎙️ Dictate"}
                </Button>
              )}
              <Button
                variant="secondary"
                className="min-h-10 px-3 text-xs"
                onClick={() => photoInputRef.current?.click()}
              >
                📷 {photoFile ? "Change photo" : "Add photo"}
              </Button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) handlePhotoChange(f);
                  e.target.value = "";
                }}
              />
              <Button
                className="ml-auto min-h-10 px-4 text-xs"
                disabled={estimateMut.isPending || (!description.trim() && !photoFile)}
                onClick={handleEstimate}
              >
                {estimateMut.isPending ? "Estimating…" : "Estimate calories"}
              </Button>
            </div>

            {estimateMut.isError && <p className="text-xs text-ember">{estimateMut.error.message}</p>}

            {/* Estimate result + optional clarification loop */}
            {draftEstimate && (
              <div className="space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">
                      ~{editedKcal ?? draftEstimate.estimate.totalKcal} kcal
                    </div>
                    <div className="text-xs text-rock">
                      Range: {draftEstimate.estimate.kcalMin}–{draftEstimate.estimate.kcalMax} kcal (±
                      {Math.round(draftEstimate.estimate.kcalDelta / 2)} kcal)
                    </div>
                  </div>
                  <Badge
                    tone={
                      draftEstimate.estimate.confidence === "high"
                        ? "accent"
                        : draftEstimate.estimate.confidence === "low"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {draftEstimate.estimate.confidence} confidence
                  </Badge>
                </div>

                {draftEstimate.estimate.items.length > 0 && (
                  <ul className="divide-y divide-black/5 text-xs dark:divide-white/5">
                    {draftEstimate.estimate.items.map((item, i) => (
                      <li key={`${item.name}-${i}`} className="flex items-center justify-between py-1">
                        <span>
                          {item.name} <span className="text-rock">({item.grams}g)</span>
                        </span>
                        <span className="font-medium">
                          {item.kcal} kcal · P {item.proteinG}g · C {item.carbsG}g · F {item.fatG}g
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {draftEstimate.estimate.notes && (
                  <p className="text-xs text-rock">{draftEstimate.estimate.notes}</p>
                )}

                {/* Follow-up questions when range > threshold (default 200 kcal) */}
                {draftEstimate.estimate.needsClarification && draftEstimate.estimate.followUpQuestions.length > 0 && (
                  <div className="space-y-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      Range is wide ({draftEstimate.estimate.kcalDelta} kcal spread) — quick follow-up to narrow it down:
                    </div>
                    {draftEstimate.estimate.followUpQuestions.map((q) => (
                      <div key={q.id} className="space-y-1.5">
                        <p className="text-xs font-medium">{q.question}</p>
                        {q.suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {q.suggestions.map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: s }))}
                                className={`rounded-full px-2.5 py-1 text-xs transition ${
                                  answers[q.id] === s
                                    ? "bg-pine text-white dark:bg-emerald-300 dark:text-neutral-950"
                                    : "bg-white text-neutral-800 hover:bg-black/5 dark:bg-neutral-900 dark:text-neutral-200"
                                }`}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                        <input
                          type="text"
                          className={`${inputClass} min-h-9 text-xs`}
                          placeholder="Or type your answer…"
                          value={answers[q.id] ?? ""}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        className="min-h-9 px-3 text-xs"
                        disabled={
                          estimateMut.isPending ||
                          Object.values(answers).every((v) => !v.trim())
                        }
                        onClick={handleRefine}
                      >
                        {estimateMut.isPending ? "Refining…" : "Refine estimate"}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Quick manual tweak before saving */}
                <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                  <div className="space-y-1">
                    <span className="text-[11px] text-rock">Calories</span>
                    <NumberInput
                      value={editedKcal}
                      onChange={(v) => {
                        setEditedKcal(v);
                        setUserCorrected(true);
                      }}
                      suffix="kcal"
                      integer
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-rock">Protein</span>
                    <NumberInput
                      value={editedProtein}
                      onChange={(v) => {
                        setEditedProtein(v);
                        setUserCorrected(true);
                      }}
                      suffix="g"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-rock">Carbs</span>
                    <NumberInput
                      value={editedCarbs}
                      onChange={(v) => {
                        setEditedCarbs(v);
                        setUserCorrected(true);
                      }}
                      suffix="g"
                    />
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] text-rock">Fat</span>
                    <NumberInput
                      value={editedFat}
                      onChange={(v) => {
                        setEditedFat(v);
                        setUserCorrected(true);
                      }}
                      suffix="g"
                    />
                  </div>
                </div>

                {saveEntry.isError && <p className="text-xs text-ember">{saveEntry.error.message}</p>}

                <div className="flex justify-end gap-2">
                  <Button
                    variant={draftEstimate.estimate.needsClarification ? "secondary" : "primary"}
                    disabled={saveEntry.isPending}
                    onClick={handleSaveMeal}
                  >
                    {saveEntry.isPending
                      ? "Saving…"
                      : draftEstimate.estimate.needsClarification
                        ? "Log rough estimate anyway"
                        : "Save meal"}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Today's Meals */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                {date === today ? "Today's meals" : `Meals on ${date}`} ({day.entries.length})
              </h2>
              {day.workouts.length > 0 && (
                <span className="text-xs text-moss dark:text-emerald-300">
                  {day.workouts.length} workout{day.workouts.length === 1 ? "" : "s"} (+{day.targets.workoutCreditKcal} kcal)
                </span>
              )}
            </div>

            {day.entries.length === 0 ? (
              <p className="text-xs text-rock">No meals logged yet for this day.</p>
            ) : (
              <ul className="divide-y divide-black/10 dark:divide-white/10">
                {day.entries.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 py-2.5">
                    {entry.photoKey && (
                      <img
                        src={`/api/food/photo/${entry.photoKey.replace(/^food\//, "")}`}
                        alt=""
                        className="h-14 w-14 shrink-0 rounded-lg object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        {entry.meal && <Badge>{MEAL_LABELS[entry.meal]}</Badge>}
                        <span className="text-sm font-semibold">{Math.round(entry.kcal)} kcal</span>
                        {entry.kcalMin != null && entry.kcalMax != null && (
                          <span className="text-[11px] text-rock">
                            ({Math.round(entry.kcalMin)}–{Math.round(entry.kcalMax)})
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-neutral-700 dark:text-neutral-300">{entry.description}</p>
                      <p className="text-[11px] text-rock">
                        P {entry.proteinG}g · C {entry.carbsG}g · F {entry.fatG}g
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      className="min-h-8 px-2 text-xs text-rock hover:text-ember"
                      disabled={deleteEntry.isPending}
                      onClick={() => deleteEntry.mutate(entry.id)}
                      aria-label="Delete meal"
                    >
                      ✕
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Weight Progress Card */}
          <WeightProgressCard trend={day.weightTrend} />
        </>
      )}
    </section>
  );
}
