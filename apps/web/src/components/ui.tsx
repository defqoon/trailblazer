import { useEffect, useState, type ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900 ${className}`}>
      {children}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" };
export function Button({ variant = "primary", className = "", ...props }: BtnProps) {
  const styles = {
    primary: "bg-pine text-white hover:bg-pine/90 dark:bg-emerald-300 dark:text-neutral-950",
    secondary: "border border-black/15 bg-white hover:bg-black/5 dark:border-white/15 dark:bg-neutral-900 dark:hover:bg-white/5",
    ghost: "text-rock hover:bg-black/5 dark:hover:bg-white/5",
    danger: "border border-ember/40 text-ember hover:bg-ember/10",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition disabled:opacity-40 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-rock">{hint}</span>}
      {error && <span className="block text-xs text-ember">{error}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-xl border border-black/15 bg-white px-3 text-base outline-none focus:border-pine focus:ring-2 focus:ring-pine/20 dark:border-white/15 dark:bg-neutral-900 dark:focus:border-emerald-300";

/**
 * Numeric input that keeps what you type as text (so clearing the field or typing "35"
 * over "0" works naturally) and reports a parsed number upward.
 */
export function NumberInput({
  value,
  onChange,
  suffix,
  min,
  max,
  step,
  allowEmpty = false,
  integer = false,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
  integer?: boolean;
  ariaLabel?: string;
}) {
  const parse = (t: string): number | null => {
    const trimmed = t.trim().replace(",", ".");
    if (trimmed === "") return allowEmpty ? null : 0;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : NaN;
  };
  const [text, setText] = useState(value == null ? "" : String(value));
  // Follow external changes (e.g. prefill from Strava) without fighting the user's typing.
  useEffect(() => {
    if (parse(text) !== value) setText(value == null ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        aria-label={ariaLabel}
        className={`${inputClass} ${suffix ? "pr-16" : ""}`}
        value={text}
        data-min={min}
        data-max={max}
        data-step={step}
        onChange={(e) => {
          const raw = e.target.value;
          if (!/^\d*([.,]\d*)?$/.test(raw.trim())) return; // digits and one decimal separator only
          setText(raw);
          const n = parse(raw);
          if (n === null || !Number.isNaN(n)) onChange(n === null ? null : integer ? Math.round(n) : n);
        }}
        onBlur={() => setText(value == null ? "" : String(value))}
      />
      {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-rock">{suffix}</span>}
    </div>
  );
}

/** Hours + minutes input backed by total minutes. */
export function DurationInput({ value, onChange }: { value: number | null; onChange: (min: number | null) => void }) {
  const h = value == null ? null : Math.floor(value / 60);
  const m = value == null ? null : value % 60;
  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <NumberInput integer ariaLabel="hours" value={h} suffix="h" onChange={(v) => onChange((v ?? 0) * 60 + (m ?? 0))} />
      </div>
      <div className="flex-1">
        <NumberInput integer ariaLabel="minutes" value={m} suffix="min" onChange={(v) => onChange((h ?? 0) * 60 + Math.min(59, v ?? 0))} />
      </div>
    </div>
  );
}

/** Multi-select chips. */
export function Chips<T extends string | number>({
  values,
  onToggle,
  options,
  locked = [],
}: {
  values: T[];
  onToggle: (v: T) => void;
  options: { value: T; label: string; icon?: string }[];
  locked?: T[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = values.includes(o.value);
        const isLocked = locked.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            disabled={isLocked}
            onClick={() => onToggle(o.value)}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition ${
              on
                ? "border-pine bg-pine/10 font-medium text-pine dark:border-emerald-300 dark:bg-emerald-300/15 dark:text-emerald-200"
                : "border-black/15 bg-white text-neutral-700 dark:border-white/15 dark:bg-neutral-900 dark:text-neutral-200"
            } ${isLocked ? "cursor-default" : ""}`}
          >
            {o.icon && <span aria-hidden>{o.icon}</span>}
            {o.label}
            {isLocked && <span className="text-xs opacity-70">· goal</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Small integer picker (e.g. 0–7 per week). */
export function CountPicker({ value, onChange, min = 0, max = 7, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; max?: number; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          onClick={() => onChange(n)}
          className={`min-h-11 min-w-11 rounded-xl text-sm font-medium ${
            n === value ? "bg-pine text-white dark:bg-emerald-300 dark:text-neutral-950" : "bg-black/5 text-rock dark:bg-white/10"
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function ChoiceCards<T extends string | number>({
  value,
  onChange,
  options,
  columns = 1,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string; icon?: string }[];
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" }[columns];
  return (
    <div role="radiogroup" className={`grid gap-2 ${cols}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`flex min-h-11 items-start gap-3 rounded-xl border p-3 text-left transition ${
              active
                ? "border-pine bg-pine/5 ring-2 ring-pine/20 dark:border-emerald-300 dark:bg-emerald-300/10"
                : "border-black/10 bg-white hover:border-black/25 dark:border-white/10 dark:bg-neutral-900"
            }`}
          >
            {o.icon && <span className="text-xl leading-none" aria-hidden>{o.icon}</span>}
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              {o.description && <span className="mt-0.5 block text-xs text-rock">{o.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full min-h-11 items-center justify-between gap-4 rounded-xl border border-black/10 bg-white p-3 text-left dark:border-white/10 dark:bg-neutral-900"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-rock">{description}</span>}
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-pine dark:bg-emerald-300" : "bg-black/20 dark:bg-white/20"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-black/5 p-1 dark:bg-white/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-lg px-3 text-xs font-medium transition ${o.value === value ? "bg-white shadow-sm dark:bg-neutral-800" : "text-rock"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "warn" }) {
  const t = {
    neutral: "bg-black/5 text-neutral-700 dark:bg-white/10 dark:text-neutral-200",
    accent: "bg-pine/10 text-pine dark:bg-emerald-300/15 dark:text-emerald-200",
    warn: "bg-ember/10 text-ember",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}
