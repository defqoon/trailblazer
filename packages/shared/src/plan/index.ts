export * from "./dates";
export * from "./periodization";
export * from "./workouts";

import type { PlanRequest } from "../schemas";
import { buildSkeleton } from "./periodization";
import { generatePlanWorkouts } from "./workouts";

/** Full deterministic plan: skeleton + workouts per week. */
export function buildPlan(req: PlanRequest) {
  const skeleton = buildSkeleton(req.goal, req.profile, req.startDate);
  const workouts = generatePlanWorkouts(req.goal, req.profile, skeleton, req.startDate);
  return { ...skeleton, workouts };
}
