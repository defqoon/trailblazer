import { Hono } from "hono";
import type { AppEnv, Env, Job } from "./env";
import { requireAccess } from "./lib/access";
import { foodRoutes } from "./routes/food";
import { healthRoutes } from "./routes/health";
import { nutritionRoutes } from "./routes/nutrition";
import { planRoutes } from "./routes/plan";
import { stravaRoutes } from "./routes/strava";

export const app = new Hono<AppEnv>().basePath("/api");

// Public endpoints (must be excluded from the Access policy as a bypass path):
// Strava webhook verification + delivery will be mounted here in milestone 2.

app.use("*", requireAccess());

app.get("/me", (c) => c.json({ email: c.get("userEmail") }));
app.get("/health", async (c) => {
  const row = await c.env.DB.prepare("select 1 as ok").first<{ ok: number }>();
  return c.json({ ok: row?.ok === 1 });
});

app.route("/", planRoutes);
app.route("/", stravaRoutes);
app.route("/", healthRoutes);
app.route("/", foodRoutes);
app.route("/", nutritionRoutes);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController, _env: Env, _ctx: ExecutionContext) {
    switch (controller.cron) {
      case "0 * * * *": // Garmin pull (milestone 6)
      case "15 */6 * * *": // Renpho pull (milestone 6)
      case "0 3 * * *": // plan adaptation (milestone 8)
        console.log("cron not yet implemented", controller.cron);
        break;
    }
  },

  async queue(batch: MessageBatch<Job>, _env: Env) {
    for (const msg of batch.messages) {
      console.log("job not yet implemented", msg.body.kind);
      msg.ack();
    }
  },
} satisfies ExportedHandler<Env, Job>;
