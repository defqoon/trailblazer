import type { AthleteProfile, Goal, PlanRequest } from "../schemas";

export const trailGoal: Goal = {
  name: "Mountain 40K",
  eventDate: "2027-07-10",
  legs: [{ sport: "trail_run", distanceKm: 40, elevationGainM: 3500, elevationLossM: null }],
  targetTimeMin: null,
  technicality: 2,
  priority: "finish",
};

export const winterSkierProfile: AthleteProfile = {
  age: 35,
  sex: "male",
  weightKg: 72,
  experience: "intermediate",
  current: { weeklyHours: 6, sessionsPerWeek: 4, longestSessionMin: 150 },
  availability: { days: [1, 2, 3, 5, 6], longDay: 5, maxWeeklyHours: 12, maxWeekdayMin: 90, backToBack: true },
  sports: [
    { sport: "trail_run", from: "04-01", to: "11-30" },
    { sport: "ski_touring", from: "12-01", to: "03-31" },
  ],
  activities: [{ sport: "climbing", perWeek: 2, days: [0, 3], durationMin: 120 }],
  workouts: { structured: true, strengthPerWeek: 2, strengthAccess: "gym", mobilityPerWeek: 3 },
  terrain: { maxLocalClimbM: 300, treadmillIncline: true, stairs: false },
  injuries: "",
  dexa: { recent: false, date: null },
  maxHr: 188,
  restingHr: 48,
};

export const trailRequest: PlanRequest = { goal: trailGoal, profile: winterSkierProfile, startDate: "2026-11-23" };

export const triathlonRequest: PlanRequest = {
  goal: {
    name: "Mountain triathlon",
    eventDate: "2027-08-21",
    legs: [
      { sport: "swim", distanceKm: 1.5, elevationGainM: 0, elevationLossM: null },
      { sport: "bike", distanceKm: 60, elevationGainM: 1200, elevationLossM: null },
      { sport: "trail_run", distanceKm: 15, elevationGainM: 800, elevationLossM: null },
    ],
    targetTimeMin: null,
    technicality: 1,
    priority: "finish",
  },
  profile: {
    ...winterSkierProfile,
    sports: [{ sport: "swim", from: "01-01", to: "12-31" }],
    activities: [],
  },
  startDate: "2027-03-01",
};
