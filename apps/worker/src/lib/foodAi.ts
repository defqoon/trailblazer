import {
  foodEstimateSchema,
  type FoodClarificationTurn,
  type FoodEstimate,
  type MealType,
} from "@trailblazer/shared";
import type { Env } from "../env";

export interface EstimateFoodInput {
  description: string;
  meal?: MealType;
  imageBase64?: string | null;
  imageMediaType?: "image/jpeg" | "image/png" | "image/webp" | null;
  clarifications?: FoodClarificationTurn[];
  uncertaintyThresholdKcal: number;
}

export interface EstimateFoodResult {
  provider: "gemini";
  model: string;
  estimate: FoodEstimate;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not configured. Add it in .dev.vars or via `wrangler secret put GEMINI_API_KEY`.");
  }
}

function buildSystemPrompt(thresholdKcal: number): string {
  return `You are a practical sports nutritionist estimating calories and macros for an athlete's meal from text and/or a photo.
Return a realistic itemized breakdown with honest uncertainty bounds:
- Estimate each ingredient's grams, kcal (midpoint), kcalMin (plausible low), kcalMax (plausible high), proteinG, carbsG, fatG.
- Sum them into totalKcal, kcalMin, kcalMax, proteinG, carbsG, fatG, and kcalDelta = kcalMax - kcalMin.
- Be honest about uncertainty when portion sizes, cooking oil/butter, sauces, milk type, yogurt fat %, or scoop counts aren't specified.
- If kcalDelta > ${thresholdKcal}, set needsClarification = true and ask 1 to 3 short, high-impact followUpQuestions (each with 2 to 4 concise quick-tap suggestions like "150 ml", "250 ml", "plain Greek", "sweetened"). Focus only on the ingredients driving the widest calorie spread.
- If the user has already answered clarification questions, incorporate their answers to narrow kcalMin..kcalMax; only ask another question if kcalDelta is still > ${thresholdKcal}.
- Keep notes concise (1–2 sentences) and supportive, never preachy.`;
}

function buildUserText(input: EstimateFoodInput): string {
  const parts: string[] = [];
  if (input.meal) parts.push(`Meal type: ${input.meal}`);
  if (input.description.trim()) {
    parts.push(`Meal description: ${input.description.trim()}`);
  } else if (input.imageBase64) {
    parts.push("Meal description: (none provided — estimate from the attached photo)");
  }
  if (input.clarifications?.length) {
    parts.push("User answers to previous follow-up questions:");
    for (const turn of input.clarifications) {
      parts.push(`- Q: ${turn.question}\n  A: ${turn.answer}`);
    }
  }
  return parts.join("\n\n");
}

function normalizeEstimate(raw: unknown, thresholdKcal: number): FoodEstimate {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rawItems = Array.isArray(obj.items) ? obj.items : [];
  const items = rawItems
    .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === "object"))
    .map((i) => ({
      name: String(i.name ?? "Item").trim() || "Item",
      grams: Math.max(0, Math.round(Number(i.grams) || 0)),
      kcal: Math.max(0, Math.round(Number(i.kcal) || 0)),
      kcalMin: i.kcalMin != null ? Math.max(0, Math.round(Number(i.kcalMin) || 0)) : undefined,
      kcalMax: i.kcalMax != null ? Math.max(0, Math.round(Number(i.kcalMax) || 0)) : undefined,
      proteinG: Math.max(0, Math.round((Number(i.proteinG) || 0) * 10) / 10),
      carbsG: Math.max(0, Math.round((Number(i.carbsG) || 0) * 10) / 10),
      fatG: Math.max(0, Math.round((Number(i.fatG) || 0) * 10) / 10),
    }));

  const sumKcal = items.reduce((s, i) => s + i.kcal, 0);
  const totalKcal = Math.max(0, Math.round(Number(obj.totalKcal) || sumKcal));
  const rawMin = Number(obj.kcalMin);
  const rawMax = Number(obj.kcalMax);
  const kcalMin = Number.isFinite(rawMin) && rawMin >= 0 ? Math.min(Math.round(rawMin), totalKcal) : Math.max(0, totalKcal - 50);
  const kcalMax = Number.isFinite(rawMax) && rawMax >= totalKcal ? Math.round(rawMax) : totalKcal + 50;
  const kcalDelta = Math.max(0, kcalMax - kcalMin);

  const proteinG = Math.max(
    0,
    Math.round((Number(obj.proteinG) || items.reduce((s, i) => s + i.proteinG, 0)) * 10) / 10,
  );
  const carbsG = Math.max(
    0,
    Math.round((Number(obj.carbsG) || items.reduce((s, i) => s + i.carbsG, 0)) * 10) / 10,
  );
  const fatG = Math.max(
    0,
    Math.round((Number(obj.fatG) || items.reduce((s, i) => s + i.fatG, 0)) * 10) / 10,
  );

  const rawQuestions = Array.isArray(obj.followUpQuestions) ? obj.followUpQuestions : [];
  const followUpQuestions = rawQuestions
    .filter((q): q is Record<string, unknown> => Boolean(q && typeof q === "object" && q.question))
    .slice(0, 3)
    .map((q, idx) => ({
      id: String(q.id || `q${idx + 1}`),
      question: String(q.question).trim(),
      suggestions: Array.isArray(q.suggestions)
        ? q.suggestions.map((s) => String(s).trim()).filter(Boolean).slice(0, 4)
        : [],
    }));

  const confidenceRaw = String(obj.confidence ?? "medium");
  const confidence =
    confidenceRaw === "low" || confidenceRaw === "medium" || confidenceRaw === "high"
      ? confidenceRaw
      : kcalDelta > thresholdKcal
        ? "low"
        : kcalDelta > 100
          ? "medium"
          : "high";

  const needsClarification = kcalDelta > thresholdKcal && followUpQuestions.length > 0;

  return foodEstimateSchema.parse({
    items,
    totalKcal,
    kcalMin,
    kcalMax,
    kcalDelta,
    proteinG,
    carbsG,
    fatG,
    confidence,
    needsClarification,
    followUpQuestions: needsClarification ? followUpQuestions : [],
    notes: typeof obj.notes === "string" ? obj.notes.trim() : "",
  });
}

const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["items", "totalKcal", "kcalMin", "kcalMax", "proteinG", "carbsG", "fatG", "confidence", "needsClarification", "followUpQuestions", "notes"],
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "grams", "kcal", "kcalMin", "kcalMax", "proteinG", "carbsG", "fatG"],
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          kcal: { type: "NUMBER" },
          kcalMin: { type: "NUMBER" },
          kcalMax: { type: "NUMBER" },
          proteinG: { type: "NUMBER" },
          carbsG: { type: "NUMBER" },
          fatG: { type: "NUMBER" },
        },
      },
    },
    totalKcal: { type: "NUMBER" },
    kcalMin: { type: "NUMBER" },
    kcalMax: { type: "NUMBER" },
    proteinG: { type: "NUMBER" },
    carbsG: { type: "NUMBER" },
    fatG: { type: "NUMBER" },
    confidence: { type: "STRING", enum: ["low", "medium", "high"] },
    needsClarification: { type: "BOOLEAN" },
    followUpQuestions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "question", "suggestions"],
        properties: {
          id: { type: "STRING" },
          question: { type: "STRING" },
          suggestions: { type: "ARRAY", items: { type: "STRING" } },
        },
      },
    },
    notes: { type: "STRING" },
  },
};

async function callGemini(
  apiKey: string,
  model: string,
  input: EstimateFoodInput,
  fetchFn: typeof fetch,
): Promise<EstimateFoodResult> {
  const parts: Array<Record<string, unknown>> = [{ text: buildUserText(input) }];
  if (input.imageBase64 && input.imageMediaType) {
    parts.push({
      inline_data: {
        mime_type: input.imageMediaType,
        data: input.imageBase64,
      },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: buildSystemPrompt(input.uncertaintyThresholdKcal) }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: GEMINI_RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) throw new Error("Gemini returned an empty response");
  const parsed = JSON.parse(jsonText);
  return {
    provider: "gemini",
    model,
    estimate: normalizeEstimate(parsed, input.uncertaintyThresholdKcal),
  };
}

export async function estimateFoodWithAi(
  env: Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL">,
  input: EstimateFoodInput,
  fetchFn: typeof fetch = fetch,
): Promise<EstimateFoodResult> {
  if (!env.GEMINI_API_KEY) throw new AiNotConfiguredError();
  return callGemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-2.5-flash", input, fetchFn);
}
