export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

export const fmtNumber = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(n);

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);
}

/** Today's date in the viewer's local time zone, as YYYY-MM-DD. */
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export const PHASE_LABEL = { base: "Base", build: "Build", specific: "Specific", taper: "Taper" } as const;
