import { describe, expect, it } from "vitest";
import { buildPlan } from ".";
import type { AthleteProfile, PlanRequest } from "../schemas";
import { addDays, inSeason, mondayOf, weekdayOf } from "./dates";
import { triathlonRequest, trailRequest, winterSkierProfile } from "./fixtures";
import { buildSkeleton, estimateEventMinutes } from "./periodization";
import { isEndurance as endurance } from "./workouts";

describe("dates", () => {
  it("handles weekdays and seasons", () => {
    expect(weekdayOf("2026-11-23")).toBe(0); // Monday
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(inSeason("2027-01-15", "12-01", "03-31")).toBe(true);
    expect(inSeason("2027-06-15", "12-01", "03-31")).toBe(false);
    expect(inSeason("2027-06-15", "04-01", "11-30")).toBe(true);
  });
});

describe("estimateEventMinutes", () => {
  it("gives a plausible 40 km / 3500 m trail time", () => {
    const min = estimateEventMinutes(trailRequest.goal, "intermediate");
    expect(min).toBeGreaterThan(6 * 60);
    expect(min).toBeLessThan(10 * 60);
  });
  it("respects a target time", () => {
    expect(estimateEventMinutes({ ...trailRequest.goal, targetTimeMin: 420 }, "beginner")).toBe(420);
  });
});

describe("skeleton", () => {
  const sk = buildSkeleton(trailRequest.goal, trailRequest.profile, trailRequest.startDate);

  it("covers every week up to race week, phases in order", () => {
    expect(sk.weeks[0]!.weekStart).toBe("2026-11-23");
    expect(sk.weeks.at(-1)!.weekStart).toBe(mondayOf(trailRequest.goal.eventDate));
    const order = ["base", "build", "specific", "taper"];
    const seen = sk.weeks.map((w) => order.indexOf(w.phase));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(sk.summary.phases.reduce((a, p) => a + p.weeks, 0)).toBe(sk.weeks.length);
  });

  it("ramps load gradually and never exceeds the weekly cap", () => {
    let prev: number | null = null;
    for (const w of sk.weeks) {
      expect(w.targetHours).toBeLessThanOrEqual(winterSkierProfile.availability.maxWeeklyHours);
      if (w.isRecovery || w.phase === "taper") continue;
      if (prev !== null) expect(w.targetHours).toBeLessThanOrEqual(prev * 1.1 + 0.25);
      prev = w.targetHours;
    }
  });

  it("schedules lighter recovery weeks", () => {
    const rec = sk.weeks.filter((w) => w.isRecovery);
    expect(rec.length).toBeGreaterThan(3);
    for (const r of rec) expect(r.targetHours).toBeLessThan(sk.weeks[r.index - 1]!.targetHours);
  });

  it("peaks vertical in the specific phase", () => {
    const peak = sk.weeks.find((w) => w.targetVerticalM === sk.summary.peakVerticalM)!;
    expect(peak.phase).toBe("specific");
    expect(sk.summary.peakVerticalM).toBeGreaterThanOrEqual(3000);
  });

  it("rejects events too close", () => {
    expect(() => buildSkeleton({ ...trailRequest.goal, eventDate: "2026-12-05" }, winterSkierProfile, "2026-11-23")).toThrow();
  });
});

describe("full plan", () => {
  const plan = buildPlan(trailRequest);
  const all = plan.workouts.flat();

  it("never schedules running in the ski-only winter", () => {
    const winterRuns = all.filter(
      (w) => w.sport === "trail_run" && w.type !== "race" && inSeason(w.date, "12-01", "03-31"),
    );
    expect(winterRuns).toEqual([]);
    expect(all.some((w) => w.sport === "ski_touring" && w.type === "long")).toBe(true);
  });

  it("eases running back in after winter", () => {
    const firstBack = plan.weeks.find((w) => w.weekStart >= "2027-03-29")!;
    const ws = plan.workouts[firstBack.index]!.filter(endurance);
    const runMin = ws.filter((w) => w.sport === "trail_run").reduce((a, w) => a + w.durationMin, 0);
    const total = ws.reduce((a, w) => a + w.durationMin, 0);
    expect(runMin / total).toBeLessThanOrEqual(0.6);
  });

  it("puts long sessions on the long day and back-to-backs in the specific phase only", () => {
    for (const w of all.filter((w) => w.type === "long")) expect(weekdayOf(w.date)).toBe(5);
    for (const w of all.filter((w) => w.type === "back_to_back")) {
      const week = plan.weeks.find((wk) => wk.weekStart === mondayOf(w.date))!;
      expect(week.phase).toBe("specific");
    }
  });

  it("matches weekly hour targets (within 10%)", () => {
    for (const week of plan.weeks.slice(1, -1)) {
      const min = plan.workouts[week.index]!.filter(endurance).reduce((a, w) => a + w.durationMin, 0);
      expect(Math.abs(min / 60 - week.targetHours) / week.targetHours).toBeLessThan(0.1);
    }
  });

  it("only uses available training days for endurance work", () => {
    for (const w of all.filter(endurance)) expect(winterSkierProfile.availability.days).toContain(weekdayOf(w.date));
  });

  it("ends with the race and nothing after it", () => {
    const last = all.at(-1)!;
    expect(last.type).toBe("race");
    expect(last.date).toBe(trailRequest.goal.eventDate);
    expect(all.filter((w) => w.date > trailRequest.goal.eventDate)).toEqual([]);
    const dayBefore = addDays(trailRequest.goal.eventDate, -1);
    // Only gentle mobility the day before the race.
    expect(all.filter((w) => w.date === dayBefore && w.type !== "mobility")).toEqual([]);
  });

  it("has detailed steps for every session", () => {
    for (const w of all) {
      expect(w.description.length).toBeGreaterThan(20);
      expect(w.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("other profiles", () => {
  it("builds a short road plan for a 3-day beginner with no structured work", () => {
    const profile: AthleteProfile = {
      ...winterSkierProfile,
      experience: "beginner",
      sports: [],
      availability: { days: [1, 3, 6], longDay: 6, maxWeeklyHours: 5, maxWeekdayMin: 60, backToBack: false },
      activities: [],
      workouts: { structured: false, strengthPerWeek: 1, strengthAccess: "none", mobilityPerWeek: 0 },
    };
    const req: PlanRequest = {
      goal: {
        ...trailRequest.goal,
        legs: [{ sport: "road_run", distanceKm: 10, elevationGainM: 50, elevationLossM: null }],
        eventDate: "2027-02-20",
      },
      profile,
      startDate: "2026-11-23",
    };
    const plan = buildPlan(req);
    const all = plan.workouts.flat();
    expect(all.filter((w) => ["vert_intervals", "tempo", "downhill"].includes(w.type) && w.date < "2027-02-15")).toEqual([]);
    expect(all.every((w) => w.sport === "road_run" || w.sport === "strength")).toBe(true);
    expect(plan.summary.peakVerticalM).toBeLessThan(500);
  });
});

describe("regular activities, mobility and frequency", () => {
  const plan = buildPlan(trailRequest);
  const all = plan.workouts.flat();

  it("keeps climbing on its chosen days every normal week", () => {
    for (const [i, week] of plan.weeks.entries()) {
      if (week.phase === "taper") continue;
      const climbs = plan.workouts[i]!.filter((w) => w.type === "activity" && w.sport === "climbing");
      expect(climbs.map((w) => weekdayOf(w.date))).toEqual([0, 3]);
    }
  });

  it("keeps hard sessions off climbing days when there's room", () => {
    const hard = all.filter((w) => ["vert_intervals", "tempo", "downhill"].includes(w.type) && w.date < "2027-06-28");
    for (const w of hard) expect([0, 3]).not.toContain(weekdayOf(w.date));
  });

  it("schedules mobility, starting the day after the long day", () => {
    const week = plan.workouts[5]!;
    const mob = week.filter((w) => w.type === "mobility");
    expect(mob).toHaveLength(3);
    expect(mob.find((w) => weekdayOf(w.date) === 6)?.title).toMatch(/recovery/i);
  });

  it("ramps training frequency up from the current number of sessions", () => {
    const sessions = (i: number) => new Set(plan.workouts[i]!.filter(endurance).map((w) => w.date)).size;
    expect(sessions(0)).toBe(4);
    expect(sessions(2)).toBe(5);
  });
});

describe("multisport", () => {
  const plan = buildPlan(triathlonRequest);
  const all = plan.workouts.flat();

  it("trains every leg roughly in proportion to race time", () => {
    const minutes = (s: string) => all.filter((w) => endurance(w) && w.sport === s).reduce((a, w) => a + w.durationMin, 0);
    expect(minutes("swim")).toBeGreaterThan(0);
    expect(minutes("bike")).toBeGreaterThan(minutes("swim"));
    expect(minutes("trail_run")).toBeGreaterThan(0);
    expect(plan.summary.primarySport).toBe("bike");
  });

  it("adds race simulations in the specific phase", () => {
    const sims = all.filter((w) => w.type === "simulation");
    expect(sims.length).toBeGreaterThan(0);
    expect(sims[0]!.steps.map((s) => s.label)).toEqual(["Swimming", "Cycling", "Trail running"]);
  });

  it("never prescribes downhill repeats on a bike or in water", () => {
    expect(all.filter((w) => w.type === "downhill" && !["trail_run", "hike", "mountaineering", "road_run", "ski_touring"].includes(w.sport))).toEqual([]);
  });

  it("splits the race into legs", () => {
    const race = all.at(-1)!;
    expect(race.type).toBe("race");
    expect(race.steps).toHaveLength(3);
    expect(race.distanceKm).toBeCloseTo(76.5);
  });
});
