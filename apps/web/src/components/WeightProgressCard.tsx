import type { WeightTrendSummary } from "@trailblazer/shared";
import { useRef, useState } from "react";
import { useImportRenphoCsv, useLogWeight } from "../lib/nutrition";
import { Badge, Button, Card, Field, NumberInput } from "./ui";

export function WeightProgressCard({ trend }: { trend: WeightTrendSummary }) {
  const [showForm, setShowForm] = useState(false);
  const [weightKg, setWeightKg] = useState<number | null>(trend.latestWeightKg ?? null);
  const [fatPct, setFatPct] = useState<number | null>(trend.latestFatPct ?? null);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const logWeight = useLogWeight();
  const importCsv = useImportRenphoCsv();

  const statusTone =
    trend.status === "on_track" || trend.status === "steady"
      ? "accent"
      : trend.status === "insufficient_data"
        ? "neutral"
        : "warn";

  const handleSaveWeight = async () => {
    if (!weightKg || weightKg < 20) return;
    await logWeight.mutateAsync({ weightKg, fatPct: fatPct ?? null });
    setShowForm(false);
  };

  const handleCsvFile = async (file: File) => {
    setCsvMsg(null);
    const text = await file.text();
    const res = await importCsv.mutateAsync(text);
    setCsvMsg(`Imported ${res.imported} weigh-in${res.imported === 1 ? "" : "s"} from Renpho CSV.`);
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Weight progress (weekly trend)</h2>
          <p className="text-xs text-rock">
            {trend.avg7dKg != null ? `7-day avg: ${trend.avg7dKg} kg` : "No scale data yet"}
            {trend.latestFatPct != null ? ` · ${trend.latestFatPct}% fat` : ""}
            {trend.daysSinceLastWeighIn != null
              ? ` · last weigh-in ${trend.daysSinceLastWeighIn === 0 ? "today" : `${trend.daysSinceLastWeighIn}d ago`}`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {trend.weighInDue && <Badge tone="warn">weekly check due</Badge>}
          {trend.weeklyRateKg != null && (
            <Badge tone={statusTone}>
              {trend.weeklyRateKg > 0 ? "+" : ""}
              {trend.weeklyRateKg.toFixed(2)} kg/wk
            </Badge>
          )}
        </div>
      </div>

      <p className="text-xs text-rock">{trend.message}</p>

      {showForm && (
        <div className="grid gap-2 rounded-xl bg-black/[0.03] p-3 sm:grid-cols-3 dark:bg-white/[0.04]">
          <Field label="Weight">
            <NumberInput value={weightKg} onChange={setWeightKg} suffix="kg" />
          </Field>
          <Field label="Body fat (optional)">
            <NumberInput value={fatPct} onChange={setFatPct} suffix="%" allowEmpty />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={handleSaveWeight} disabled={logWeight.isPending || !weightKg} className="w-full">
              {logWeight.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {csvMsg && <p className="text-xs text-moss dark:text-emerald-300">{csvMsg}</p>}
      {(logWeight.isError || importCsv.isError) && (
        <p className="text-xs text-ember">{(logWeight.error ?? importCsv.error)?.message}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "Log weigh-in"}
        </Button>
        <Button
          variant="ghost"
          className="min-h-9 px-3 text-xs"
          disabled={importCsv.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {importCsv.isPending ? "Importing…" : "Import Renpho CSV"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCsvFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </Card>
  );
}
