import {
  DEFAULT_NUTRITION_SETTINGS,
  foodEntryCreateSchema,
  foodEntryUpdateSchema,
  foodEstimateRequestSchema,
  nutritionSettingsSchema,
  type FoodEntryDto,
  type FoodEstimateResponseDto,
  type FoodItem,
  type MealType,
} from "@trailblazer/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { foodEntries, nutritionSettings } from "../db/schema";
import type { AppEnv } from "../env";
import { getDb } from "../lib/db";
import { AiNotConfiguredError, estimateFoodWithAi } from "../lib/foodAi";
import { parseBody } from "../lib/validate";

export const foodRoutes = new Hono<AppEnv>();

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function toDto(row: typeof foodEntries.$inferSelect): FoodEntryDto {
  return {
    id: row.id,
    eatenAt: row.eatenAt,
    meal: (row.meal as MealType | null) ?? null,
    description: row.description,
    photoKey: row.photoKey ?? null,
    items: Array.isArray(row.items) ? (row.items as FoodItem[]) : [],
    kcal: row.kcal,
    kcalMin: row.kcalMin ?? null,
    kcalMax: row.kcalMax ?? null,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    confidence: (row.confidence as "low" | "medium" | "high" | null) ?? null,
    userCorrected: Boolean(row.userCorrected),
    createdAt: row.createdAt,
  };
}

async function loadUncertaintyThreshold(d1: D1Database): Promise<number> {
  const row = await getDb(d1).select().from(nutritionSettings).where(eq(nutritionSettings.id, 1)).get();
  if (!row) return DEFAULT_NUTRITION_SETTINGS.uncertaintyThresholdKcal;
  const parsed = nutritionSettingsSchema.safeParse(row.data);
  return parsed.success ? parsed.data.uncertaintyThresholdKcal : DEFAULT_NUTRITION_SETTINGS.uncertaintyThresholdKcal;
}

/**
 * Estimate calories & macros from text and/or a photo, with iterative clarification
 * when the calorie range exceeds the configured threshold (default 200 kcal).
 */
foodRoutes.post("/food/estimate", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  let rawPayload: unknown = {};
  let imageBase64: string | null = null;
  let imageMediaType: "image/jpeg" | "image/png" | "image/webp" | null = null;
  let photoKey: string | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const payloadStr = form.get("payload");
    if (typeof payloadStr === "string" && payloadStr.trim()) {
      try {
        rawPayload = JSON.parse(payloadStr);
      } catch {
        return c.json({ error: "Invalid JSON in payload field" }, 400);
      }
    }
    const photo = form.get("photo");
    if (photo && typeof photo !== "string") {
      const file = photo as File;
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        return c.json({ error: "Unsupported image type. Use JPEG, PNG, or WebP." }, 400);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return c.json({ error: "Image too large (max 5 MB)." }, 400);
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
      const today = new Date().toISOString().slice(0, 10);
      photoKey = `food/${today}/${crypto.randomUUID()}.${ext}`;
      await c.env.UPLOADS.put(photoKey, bytes, { httpMetadata: { contentType: file.type } });
      imageBase64 = bytesToBase64(bytes);
      imageMediaType = file.type as "image/jpeg" | "image/png" | "image/webp";
    }
  } else {
    try {
      rawPayload = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }
  }

  const parsed = foodEstimateRequestSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return c.json({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }
  const req = parsed.data;

  // If refining a previous photo estimate, re-read the photo from R2
  if (!photoKey && req.photoKey && req.photoKey.startsWith("food/")) {
    const obj = await c.env.UPLOADS.get(req.photoKey);
    if (obj) {
      const mime = obj.httpMetadata?.contentType ?? "image/jpeg";
      if (ALLOWED_IMAGE_TYPES.has(mime)) {
        const bytes = new Uint8Array(await obj.arrayBuffer());
        imageBase64 = bytesToBase64(bytes);
        imageMediaType = mime as "image/jpeg" | "image/png" | "image/webp";
        photoKey = req.photoKey;
      }
    }
  }

  if (!req.description.trim() && !imageBase64) {
    return c.json({ error: "Provide a meal description, a photo, or both." }, 400);
  }

  const threshold = await loadUncertaintyThreshold(c.env.DB);
  try {
    const result = await estimateFoodWithAi(c.env, {
      description: req.description,
      meal: req.meal,
      imageBase64,
      imageMediaType,
      clarifications: req.clarifications,
      uncertaintyThresholdKcal: threshold,
    });
    return c.json({
      photoKey,
      provider: result.provider,
      model: result.model,
      estimate: result.estimate,
    } satisfies FoodEstimateResponseDto);
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return c.json({ error: err.message }, 503);
    }
    return c.json({ error: err instanceof Error ? err.message : "Food estimation failed" }, 502);
  }
});

/** Serve a stored food photo from R2 (protected by Access middleware). */
foodRoutes.get("/food/photo/:date/:file", async (c) => {
  const key = `food/${c.req.param("date")}/${c.req.param("file")}`;
  if (key.includes("..")) return c.json({ error: "invalid key" }, 400);
  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.json({ error: "not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
});

foodRoutes.post("/food/entries", async (c) => {
  const body = await parseBody(c, foodEntryCreateSchema);
  if (!body.ok) return body.res;
  const d = body.data;
  const eatenAt = d.eatenAt ?? (d.date ? `${d.date}T12:00:00.000Z` : new Date().toISOString());

  const [created] = await getDb(c.env.DB)
    .insert(foodEntries)
    .values({
      eatenAt,
      meal: d.meal ?? null,
      description: d.description,
      photoKey: d.photoKey ?? null,
      items: d.items,
      kcal: Math.round(d.kcal),
      kcalMin: d.kcalMin != null ? Math.round(d.kcalMin) : null,
      kcalMax: d.kcalMax != null ? Math.round(d.kcalMax) : null,
      proteinG: Math.round(d.proteinG * 10) / 10,
      carbsG: Math.round(d.carbsG * 10) / 10,
      fatG: Math.round(d.fatG * 10) / 10,
      confidence: d.confidence ?? null,
      userCorrected: d.userCorrected,
    })
    .returning();

  if (!created) return c.json({ error: "Failed to save meal" }, 500);
  return c.json({ entry: toDto(created) }, 201);
});

foodRoutes.patch("/food/entries/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid entry id" }, 400);

  const body = await parseBody(c, foodEntryUpdateSchema);
  if (!body.ok) return body.res;
  const d = body.data;

  const db = getDb(c.env.DB);
  const existing = await db.select().from(foodEntries).where(eq(foodEntries.id, id)).get();
  if (!existing) return c.json({ error: "Entry not found" }, 404);

  const [updated] = await db
    .update(foodEntries)
    .set({
      ...(d.eatenAt !== undefined ? { eatenAt: d.eatenAt } : {}),
      ...(d.meal !== undefined ? { meal: d.meal } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.items !== undefined ? { items: d.items } : {}),
      ...(d.kcal !== undefined ? { kcal: Math.round(d.kcal) } : {}),
      ...(d.kcalMin !== undefined ? { kcalMin: d.kcalMin != null ? Math.round(d.kcalMin) : null } : {}),
      ...(d.kcalMax !== undefined ? { kcalMax: d.kcalMax != null ? Math.round(d.kcalMax) : null } : {}),
      ...(d.proteinG !== undefined ? { proteinG: Math.round(d.proteinG * 10) / 10 } : {}),
      ...(d.carbsG !== undefined ? { carbsG: Math.round(d.carbsG * 10) / 10 } : {}),
      ...(d.fatG !== undefined ? { fatG: Math.round(d.fatG * 10) / 10 } : {}),
      userCorrected: true,
    })
    .where(eq(foodEntries.id, id))
    .returning();

  if (!updated) return c.json({ error: "Failed to update meal" }, 500);
  return c.json({ entry: toDto(updated) });
});

foodRoutes.delete("/food/entries/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Invalid entry id" }, 400);

  const db = getDb(c.env.DB);
  const existing = await db.select().from(foodEntries).where(eq(foodEntries.id, id)).get();
  if (!existing) return c.json({ error: "Entry not found" }, 404);

  await db.delete(foodEntries).where(eq(foodEntries.id, id));
  if (existing.photoKey?.startsWith("food/")) {
    await c.env.UPLOADS.delete(existing.photoKey).catch(() => {});
  }
  return c.json({ ok: true });
});
