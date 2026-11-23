import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtDate, fmtNumber } from "../lib/format";
import {
  availability,
  connect,
  grantedTypes,
  isNativeApp,
  lastSync,
  openHealthConnectSettings,
  READ_TYPES,
  syncHealth,
} from "../lib/healthConnect";
import { Badge, Button } from "./ui";

interface Latest {
  days: { date: string; steps: number | null; restingHr: number | null; hrv: number | null; vo2max: number | null }[];
  latestWeight: { measuredAt: string; weightKg: number; fatPct: number | null; source: string } | null;
}

const LABELS: Record<string, string> = {
  steps: "steps",
  weight: "weight",
  bodyFat: "body fat",
  restingHeartRate: "resting HR",
  heartRateVariability: "HRV",
  vo2Max: "VO2max",
};

export function HealthConnectCard() {
  const qc = useQueryClient();
  const native = isNativeApp();
  const avail = useQuery({ queryKey: ["hc", "availability"], queryFn: availability, enabled: native });
  const granted = useQuery({ queryKey: ["hc", "granted"], queryFn: grantedTypes, enabled: native && Boolean(avail.data?.available) });
  const latest = useQuery({ queryKey: ["health", "latest"], queryFn: () => api<Latest>("/health/latest") });

  const sync = useMutation({
    mutationFn: async () => {
      if (!granted.data?.length) await connect();
      return syncHealth();
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["hc"] }).then(() => qc.invalidateQueries({ queryKey: ["health"] })),
  });

  const connected = (granted.data?.length ?? 0) > 0;
  const today = latest.data?.days[0];
  const w = latest.data?.latestWeight;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-neutral-900">
      <span className="text-xl leading-none" aria-hidden>
        ❤️
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          Health Connect {connected && <Badge tone="accent">connected</Badge>}
        </div>

        {!native ? (
          <p className="text-xs text-rock">
            Steps, weight & body fat, resting heart rate, HRV and VO2max from your phone. Available in the Android app.
          </p>
        ) : avail.isPending ? (
          <p className="text-xs text-rock">Checking…</p>
        ) : !avail.data?.available ? (
          <p className="text-xs text-rock">
            Health Connect isn't available on this phone{avail.data?.reason ? ` (${avail.data.reason})` : ""}. On Android 13 or
            older, install "Health Connect" from the Play Store.
          </p>
        ) : (
          <>
            <p className="text-xs text-rock">
              Reads {READ_TYPES.map((t) => LABELS[t]).join(", ")} from apps that write to Health Connect (e.g. Renpho, Garmin
              Connect, Google Fit). Syncs when you open the app.
            </p>
            {connected && granted.data!.length < READ_TYPES.length && (
              <p className="text-xs text-rock">
                Not allowed: {READ_TYPES.filter((t) => !granted.data!.includes(t)).map((t) => LABELS[t]).join(", ")}.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={sync.isPending} onClick={() => sync.mutate()}>
                {sync.isPending ? "Syncing…" : connected ? "Sync now" : "Connect Health Connect"}
              </Button>
              {connected && (
                <Button variant="ghost" onClick={() => openHealthConnectSettings()}>
                  Permissions
                </Button>
              )}
            </div>
            {sync.isError && <p className="text-xs text-ember">Sync failed: {sync.error.message}</p>}
            {sync.data && (
              <p className="text-xs text-rock">
                Synced {sync.data.days} days and {sync.data.weighIns} weigh-ins.
              </p>
            )}
            {!sync.data && lastSync() && <p className="text-xs text-rock">Last sync {new Date(lastSync()!).toLocaleString()}.</p>}
          </>
        )}

        {(today || w) && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-black/[0.03] p-2 text-xs dark:bg-white/5">
            {today && (
              <>
                <dt className="text-rock">Steps ({fmtDate(today.date, { day: "numeric", month: "short" })})</dt>
                <dd>{today.steps != null ? fmtNumber(today.steps) : "–"}</dd>
                <dt className="text-rock">Resting HR / HRV</dt>
                <dd>
                  {today.restingHr ?? "–"} bpm / {today.hrv ?? "–"} ms
                </dd>
              </>
            )}
            {w && (
              <>
                <dt className="text-rock">Weight ({fmtDate(w.measuredAt.slice(0, 10), { day: "numeric", month: "short" })})</dt>
                <dd>
                  {fmtNumber(w.weightKg)} kg{w.fatPct != null ? ` · ${fmtNumber(w.fatPct)}% fat` : ""}
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  );
}
