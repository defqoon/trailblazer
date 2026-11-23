import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { NavLink, Outlet } from "react-router";
import { isNativeApp } from "../lib/healthConnect";

const tabs = [
  { to: "/", label: "Today", icon: "☀" },
  { to: "/plan", label: "Plan", icon: "▤" },
  { to: "/food", label: "Food", icon: "◍" },
  { to: "/chat", label: "Coach", icon: "✦" },
  { to: "/trends", label: "Trends", icon: "↗" },
];

export function Layout() {
  const qc = useQueryClient();
  // In the Android app: quietly sync Health Connect when the app opens (at most every few hours).
  useEffect(() => {
    if (!isNativeApp()) return;
    import("../lib/healthConnect")
      .then((m) => m.autoSync())
      .then((r) => r && qc.invalidateQueries({ queryKey: ["health"] }))
      .catch((e) => console.warn("Health Connect auto-sync failed", e));
  }, [qc]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-lg font-semibold tracking-tight text-pine dark:text-emerald-200">
          Trailblazer
        </span>
        <NavLink to="/settings" className="text-sm text-rock" aria-label="Settings">
          Settings
        </NavLink>
      </header>
      <main className="flex-1 px-4 pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-sand/95 backdrop-blur dark:border-white/10 dark:bg-neutral-950/95">
        <ul className="mx-auto grid max-w-2xl grid-cols-5 pb-[env(safe-area-inset-bottom)]">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.to === "/"}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 py-2 text-xs ${
                    isActive ? "text-pine font-semibold dark:text-emerald-200" : "text-rock"
                  }`
                }
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
