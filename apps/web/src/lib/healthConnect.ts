import { Capacitor } from "@capacitor/core";
import { Health, type HealthDataType, type HealthSample } from "@capgo/capacitor-health";
import type { HealthSync } from "@trailblazer/shared";
import { api } from "./api";

/** True only inside the Android app (Capacitor injects its bridge into the page). */
export const isNativeApp = () => Capacitor.isNativePlatform();

export const READ_TYPES: HealthDataType[] = [
  "steps",
  "weight",
  "bodyFat",
  "restingHeartRate",
  "heartRateVariability",
  "vo2Max",
];

const LAST_SYNC_KEY = "trailblazer.healthConnect.lastSync";
const AUTO_SYNC_EVERY_MS = 3 * 60 * 60 * 1000;

export interface SyncResult {
  ok: boolean;
  days: number;
  weighIns: number;
  syncedAt: string;
  skipped: HealthDataType[];
}

export async function availability(): Promise<{ available: boolean; reason?: string }> {
  if (!isNativeApp()) return { available: false, reason: "Only in the Android app" };
  return Health.isAvailable();
}

export async function grantedTypes(): Promise<HealthDataType[]> {
  const status = await Health.checkAuthorization({ read: READ_TYPES });
  return status.readAuthorized;
}

/** Opens the Health Connect permission sheet. */
export async function connect() {
  return Health.requestAuthorization({ read: READ_TYPES, requestHistoryAccess: true });
}

export const openHealthConnectSettings = () => Health.openHealthConnectSettings();

export function lastSync(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY);
  } catch {
    return null;
  }
}
function setLastSync(iso: string) {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso);
  } catch {
    /* storage unavailable: we'll just sync again next time */
  }
}

/** YYYY-MM-DD in the phone's local time zone. */
const localDate = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const round1 = (x: number) => Math.round(x * 10) / 10;

async function samples(dataType: HealthDataType, startDate: string, endDate: string): Promise<HealthSample[]> {
  const { samples } = await Health.readSamples({ dataType, startDate, endDate, limit: 5000, ascending: true });
  return samples;
}

/** Average value per local day. */
function dailyAverage(list: HealthSample[]): Map<string, number> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const s of list) {
    const day = localDate(s.startDate);
    const a = acc.get(day) ?? { sum: 0, n: 0 };
    acc.set(day, { sum: a.sum + s.value, n: a.n + 1 });
  }
  return new Map([...acc].map(([day, a]) => [day, round1(a.sum / a.n)]));
}

/** Read the last `days` days from Health Connect and shape them for the API. */
export async function collect(days: number): Promise<{ payload: HealthSync; skipped: HealthDataType[] }> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  start.setHours(0, 0, 0, 0);
  const startDate = start.toISOString();
  const endDate = end.toISOString();
  const granted = new Set(await grantedTypes());
  const skipped = READ_TYPES.filter((t) => !granted.has(t));

  // Each type is read independently: a denied or empty type must not break the others.
  const safe = async <T>(type: HealthDataType, fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (!granted.has(type)) return fallback;
    try {
      return await fn();
    } catch {
      skipped.push(type);
      return fallback;
    }
  };

  // Steps: Health Connect's aggregate de-duplicates overlapping sources (phone + watch).
  const steps = await safe(
    "steps",
    async () => {
      const { samples } = await Health.queryAggregated({ dataType: "steps", startDate, endDate, bucket: "day", aggregation: "sum" });
      return new Map(samples.map((s) => [localDate(s.startDate), Math.round(s.value)]));
    },
    new Map<string, number>(),
  );
  const restingHr = dailyAverage(await safe("restingHeartRate", () => samples("restingHeartRate", startDate, endDate), []));
  const hrv = dailyAverage(await safe("heartRateVariability", () => samples("heartRateVariability", startDate, endDate), []));
  const vo2 = dailyAverage(await safe("vo2Max", () => samples("vo2Max", startDate, endDate), []));
  const weights = await safe("weight", () => samples("weight", startDate, endDate), []);
  const fats = await safe("bodyFat", () => samples("bodyFat", startDate, endDate), []);

  const dates = new Set([...steps.keys(), ...restingHr.keys(), ...hrv.keys(), ...vo2.keys()]);
  const daysOut = [...dates].sort().map((date) => ({
    date,
    steps: steps.get(date) ?? null,
    restingHr: restingHr.get(date) ?? null,
    hrv: hrv.get(date) ?? null,
    vo2max: vo2.get(date) ?? null,
  }));

  // Smart scales (e.g. Renpho) write weight and body fat as separate records at the same moment.
  const body = weights.map((w) => {
    const t = new Date(w.startDate).getTime();
    const fat = fats.find((f) => Math.abs(new Date(f.startDate).getTime() - t) <= 10 * 60_000);
    return {
      externalId: w.platformId ?? `${w.startDate}:${w.value}`,
      measuredAt: new Date(w.startDate).toISOString(),
      weightKg: round1(w.value),
      fatPct: fat ? round1(fat.value) : null,
    };
  });

  return { payload: { source: "health_connect", days: daysOut, body }, skipped: [...new Set(skipped)] };
}

/** Collect and upload. The first sync reaches back 90 days; later ones just the last week. */
export async function syncHealth(opts: { days?: number } = {}): Promise<SyncResult> {
  const days = opts.days ?? (lastSync() ? 7 : 90);
  const { payload, skipped } = await collect(days);
  const res = await api<Omit<SyncResult, "skipped">>("/health/sync", { method: "POST", body: JSON.stringify(payload) });
  setLastSync(res.syncedAt);
  return { ...res, skipped };
}

/** Quiet background sync when the app opens, at most every few hours, only if already connected. */
export async function autoSync(): Promise<SyncResult | null> {
  if (!isNativeApp()) return null;
  const last = lastSync();
  if (last && Date.now() - new Date(last).getTime() < AUTO_SYNC_EVERY_MS) return null;
  const { available } = await availability();
  if (!available || (await grantedTypes()).length === 0) return null;
  return syncHealth();
}
