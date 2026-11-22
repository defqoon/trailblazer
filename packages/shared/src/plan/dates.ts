/** Date helpers on ISO `YYYY-MM-DD` strings, all in UTC so there are no DST surprises. */

const DAY_MS = 86_400_000;

export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const toIso = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));

export const diffDays = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);

/** 0 = Monday … 6 = Sunday */
export const weekdayOf = (iso: string) => (toDate(iso).getUTCDay() + 6) % 7;

export const mondayOf = (iso: string) => addDays(iso, -weekdayOf(iso));

export const nextMonday = (iso: string) => (weekdayOf(iso) === 0 ? iso : addDays(mondayOf(iso), 7));

/** Is the MM-DD of `iso` inside the inclusive [from, to] range, wrapping over new year? */
export function inSeason(iso: string, from: string, to: string): boolean {
  const md = iso.slice(5);
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
