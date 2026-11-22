import { buildPlan, type CurrentPlanDto } from "@trailblazer/shared";
import { trailRequest } from "@trailblazer/shared/testing";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";

const devEnv = { ...env, DEV_BYPASS_AUTH: "true" };
const call = (path: string, init?: RequestInit) =>
  app.request(`/api${path}`, { headers: { "content-type": "application/json" }, ...init }, devEnv);

describe("plan API", () => {
  it("returns no plan initially", async () => {
    const res = await call("/plan/current");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CurrentPlanDto;
    expect(body.plan).toBeNull();
  });

  it("rejects invalid input", async () => {
    const res = await call("/plan", { method: "POST", body: JSON.stringify({ goal: {} }) });
    expect(res.status).toBe(400);
  });

  it("creates, reads, updates and archives a plan", async () => {
    const created = await call("/plan", { method: "POST", body: JSON.stringify(trailRequest) });
    expect(created.status).toBe(201);

    const res = await call("/plan/current");
    const body = (await res.json()) as CurrentPlanDto;
    const expected = buildPlan(trailRequest);
    expect(body.goal?.name).toBe(trailRequest.goal.name);
    expect(body.weeks).toHaveLength(expected.weeks.length);
    expect(body.weeks.flatMap((w) => w.workouts)).toHaveLength(expected.workouts.flat().length);
    expect(body.profile?.age).toBe(trailRequest.profile.age);

    const firstWeek = body.weeks[0]!;
    expect(firstWeek.notes).toEqual(expected.weeks[0]!.notes);
    expect(Array.isArray(firstWeek.sports)).toBe(true);
    const wo = firstWeek.workouts[0]!;
    expect(wo.steps.length).toBeGreaterThan(0);
    expect(typeof wo.key).toBe("boolean");

    const patched = await call(`/workouts/${wo.id}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) });
    expect(patched.status).toBe(200);
    const after = (await (await call("/plan/current")).json()) as CurrentPlanDto;
    expect(after.weeks[0]!.workouts[0]!.status).toBe("done");

    expect((await call("/plan/current", { method: "DELETE" })).status).toBe(200);
    const gone = (await (await call("/plan/current")).json()) as CurrentPlanDto;
    expect(gone.plan).toBeNull();
    expect(gone.profile).not.toBeNull(); // profile kept for prefilling the next plan
  });
});
