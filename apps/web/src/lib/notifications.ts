import { Capacitor } from "@capacitor/core";
import type { NutritionSettings } from "@trailblazer/shared";

interface LocalNotificationsPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(opts: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule?: { at?: Date; on?: { weekday: number; hour: number; minute: number }; repeats?: boolean };
    }>;
  }): Promise<void>;
  cancel(opts: { notifications: Array<{ id: number }> }): Promise<void>;
}

const CALORIE_ALERT_ID = 4101;
const WEIGH_IN_REMINDER_ID = 4102;
const ALERT_SENT_PREFIX = "trailblazer.calorieAlert.";

function plugin(): LocalNotificationsPlugin | null {
  if (!Capacitor.isNativePlatform()) return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: { LocalNotifications?: LocalNotificationsPlugin } } })
    .Capacitor?.Plugins;
  return plugins?.LocalNotifications ?? null;
}

export async function notificationPermission(): Promise<"granted" | "denied" | "prompt" | "unsupported"> {
  const p = plugin();
  if (p) {
    try {
      const res = await p.checkPermissions();
      return res.display === "granted" ? "granted" : res.display === "denied" ? "denied" : "prompt";
    } catch {
      return "unsupported";
    }
  }
  if (typeof Notification !== "undefined") {
    return Notification.permission === "default" ? "prompt" : Notification.permission;
  }
  return "unsupported";
}

export async function requestNotificationPermission(): Promise<boolean> {
  const p = plugin();
  if (p) {
    try {
      const res = await p.requestPermissions();
      return res.display === "granted";
    } catch {
      return false;
    }
  }
  if (typeof Notification !== "undefined") {
    const res = await Notification.requestPermission();
    return res === "granted";
  }
  return false;
}

/**
 * Fire a once-per-day notification when approaching or exceeding today's calorie budget.
 * Uses native Android LocalNotifications in Capacitor, or Web Notification API if granted.
 */
export async function maybeNotifyCalorieLimit(params: {
  date: string;
  remainingKcal: number;
  alertTriggered: boolean;
  enabled: boolean;
}): Promise<void> {
  if (!params.enabled || !params.alertTriggered) return;
  const key = `${ALERT_SENT_PREFIX}${params.date}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return;
  }

  const title =
    params.remainingKcal < 0
      ? "Daily calorie budget reached"
      : `${Math.round(params.remainingKcal)} kcal left for today`;
  const body =
    params.remainingKcal < 0
      ? "You're slightly over today's target — keep evening snacks light and reset tomorrow."
      : "You're close to today's calorie target. Good moment to pause snacking or pick something light.";

  const p = plugin();
  if (p) {
    try {
      const perm = await p.checkPermissions();
      if (perm.display !== "granted") return;
      await p.schedule({
        notifications: [{ id: CALORIE_ALERT_ID, title, body, schedule: { at: new Date(Date.now() + 1000) } }],
      });
      localStorage.setItem(key, "1");
    } catch {
      /* ignore native scheduling errors */
    }
    return;
  }

  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body });
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
  }
}

/**
 * Schedule or cancel the gentle weekly weigh-in reminder on Android.
 * Capacitor weekday uses 1 = Sunday … 7 = Saturday; our schema uses 0 = Monday … 6 = Sunday.
 */
export async function syncWeeklyWeighInReminder(settings: NutritionSettings): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    await p.cancel({ notifications: [{ id: WEIGH_IN_REMINDER_ID }] });
    if (!settings.weighInReminderEnabled) return;
    const perm = await p.checkPermissions();
    if (perm.display !== "granted") return;

    const [hourStr, minStr] = settings.weighInReminderTime.split(":");
    const hour = Number(hourStr) || 8;
    const minute = Number(minStr) || 30;
    // Map 0=Mon..5=Sat,6=Sun -> Capacitor 1=Sun,2=Mon..7=Sat
    const capWeekday = settings.weighInReminderDay === 6 ? 1 : settings.weighInReminderDay + 2;

    await p.schedule({
      notifications: [
        {
          id: WEIGH_IN_REMINDER_ID,
          title: "Weekly weigh-in check",
          body: "Quick morning weigh-in to keep your weekly trend accurate — no daily stress.",
          schedule: { on: { weekday: capWeekday, hour, minute }, repeats: true },
        },
      ],
    });
  } catch {
    /* ignore native scheduling errors */
  }
}
