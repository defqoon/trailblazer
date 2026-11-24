import { env } from "cloudflare:workers";
import type { NutritionDayDto } from "@trailblazer/shared";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { estimateFoodWithAi } from "../src/lib/foodAi";

const devEnv = { ...env, DEV_BYPASS_AUTH: "true" };
const call = (path: string, init?: RequestInit) =>
  app.request(`/api${path}`, { headers: { "content-type": "application/json" }, ...init }, devEnv);

describe("nutrition & food routes", () => {
  it("saves nutrition settings, logs food entries, and computes daily budget with workouts", async () => {
    const saveSettings = await call("/nutrition/settings", {
      method: "PUT",
      body: JSON.stringify({
        mode: "auto",
        weightGoal: "lose",
        dexaBmrKcal: 1800,
        activityLevel: "sedentary",
        workoutEatBackPct: 100,
        calorieAlertEnabled: true,
        calorieAlertPct: 85,
      }),
    });
    expect(saveSettings.status).toBe(200);

    // Insert a workout for 2026-11-24 (500 kcal)
    await env.DB.prepare(
      `INSERT INTO activities (source, external_id, start_time, sport, name, moving_time_s, elapsed_time_s, kcal)
       VALUES ('strava', 'act-nutr-1', '2026-11-24T07:30:00.000Z', 'trail_run', 'Morning trail', 3000, 3100, 500)`,
    ).run();

    // Base = 1800 * 1.2 - 450 = 1710; +500 workout = 2210 adjusted
    const createMeal = await call("/food/entries", {
      method: "POST",
      body: JSON.stringify({
        eatenAt: "2026-11-24T08:45:00.000Z",
        meal: "breakfast",
        description: "100g oatmeal with soy milk, yogurt, honey, protein powder",
        items: [{ name: "Oatmeal bowl", grams: 400, kcal: 650, proteinG: 42, carbsG: 82, fatG: 14 }],
        kcal: 650,
        kcalMin: 590,
        kcalMax: 710,
        proteinG: 42,
        carbsG: 82,
        fatG: 14,
        confidence: "medium",
      }),
    });
    expect(createMeal.status).toBe(201);
    const { entry } = (await createMeal.json()) as { entry: { id: number; kcal: number } };
    expect(entry.kcal).toBe(650);

    const dayRes = await call("/nutrition/day?date=2026-11-24");
    expect(dayRes.status).toBe(200);
    const day = (await dayRes.json()) as NutritionDayDto;
    expect(day.targets.baseKcal).toBe(1710);
    expect(day.targets.workoutKcal).toBe(500);
    expect(day.targets.adjustedKcal).toBe(2210);
    expect(day.totals.kcal).toBe(650);
    expect(day.remainingKcal).toBe(1560);
    expect(day.alertTriggered).toBe(false);

    // Edit the meal up to 2000 kcal -> triggers approaching-limit alert (>= 85% of 2210)
    const patchRes = await call(`/food/entries/${entry.id}`, {
      method: "PATCH",
      body: JSON.stringify({ kcal: 2000 }),
    });
    expect(patchRes.status).toBe(200);

    const day2 = (await (await call("/nutrition/day?date=2026-11-24")).json()) as NutritionDayDto;
    expect(day2.remainingKcal).toBe(210);
    expect(day2.alertTriggered).toBe(true);
    expect(day2.entries[0]?.userCorrected).toBe(true);

    // Delete entry
    const delRes = await call(`/food/entries/${entry.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
  });

  it("imports Renpho CSV weigh-ins without duplicates and supports manual weigh-ins", async () => {
    const csv = [
      "Time of Measurement,Weight(kg),BMI,Body Fat(%),Muscle Mass(kg),BMR(kcal)",
      "2026-11-10 07:30:00Z,76.8,23.5,18.4,59.1,1760",
      "2026-11-17 07:30:00Z,76.3,23.3,18.1,59.2,1755",
    ].join("\n");

    const r1 = await call("/health/weight/import-csv", { method: "POST", body: JSON.stringify({ csv }) });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, imported: 2 });

    // Re-importing the same CSV must not duplicate rows
    const r2 = await call("/health/weight/import-csv", { method: "POST", body: JSON.stringify({ csv }) });
    expect(r2.status).toBe(200);

    const manual = await call("/health/weight", {
      method: "POST",
      body: JSON.stringify({ measuredAt: "2026-11-24T07:30:00Z", weightKg: 75.9, fatPct: 17.8 }),
    });
    expect(manual.status).toBe(201);

    const count = await env.DB.prepare("select count(*) as n from body_measurements where source in ('renpho_csv', 'manual')").first<{ n: number }>();
    expect(count?.n).toBe(3);
  });

  it("triggers follow-up questions when AI estimate range exceeds 200 kcal and narrows on clarification", async () => {
    const mockWide: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      items: [
                        { name: "Oatmeal", grams: 100, kcal: 370, kcalMin: 350, kcalMax: 390, proteinG: 13, carbsG: 66, fatG: 7 },
                        { name: "Soy milk + yogurt + honey + protein", grams: 350, kcal: 330, kcalMin: 200, kcalMax: 460, proteinG: 30, carbsG: 32, fatG: 8 },
                      ],
                      totalKcal: 700,
                      kcalMin: 550,
                      kcalMax: 850,
                      proteinG: 43,
                      carbsG: 98,
                      fatG: 15,
                      confidence: "low",
                      needsClarification: true,
                      followUpQuestions: [
                        { id: "q1", question: "How much yogurt and what type?", suggestions: ["100g plain", "200g Greek", "150g sweetened"] },
                        { id: "q2", question: "How many scoops of protein powder?", suggestions: ["1 scoop (30g)", "1.5 scoops", "2 scoops"] },
                      ],
                      notes: "Wide range mainly due to yogurt type/amount and protein scoop count.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const wideRes = await estimateFoodWithAi(
      { GEMINI_API_KEY: "test-key", GEMINI_MODEL: "gemini-2.5-flash" },
      { description: "100g oatmeal, soy milk, yogurt, a bit of honey and protein powder", uncertaintyThresholdKcal: 200 },
      mockWide,
    );
    expect(wideRes.provider).toBe("gemini");
    expect(wideRes.estimate.kcalDelta).toBe(300);
    expect(wideRes.estimate.needsClarification).toBe(true);
    expect(wideRes.estimate.followUpQuestions).toHaveLength(2);
  });
});
