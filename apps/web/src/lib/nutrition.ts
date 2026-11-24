import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  FoodClarificationTurn,
  FoodEntryCreate,
  FoodEntryDto,
  FoodEntryUpdate,
  FoodEstimateResponseDto,
  ManualWeight,
  MealType,
  NutritionDayDto,
  NutritionSettings,
} from "@trailblazer/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Local YYYY-MM-DD date string. */
export function localIsoDate(d = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function shiftIsoDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function useNutritionDay(date: string) {
  return useQuery({
    queryKey: ["nutrition", "day", date],
    queryFn: () => api<NutritionDayDto>(`/nutrition/day?date=${encodeURIComponent(date)}`),
  });
}

export function useSaveNutritionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: NutritionSettings) =>
      api<{ settings: NutritionSettings }>("/nutrition/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nutrition"] }),
  });
}

/** Compress a food photo client-side (max 1024px, JPEG ~0.82) so mobile uploads are fast. */
export async function compressFoodPhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) return file;
    return new File([blob], "meal.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export interface EstimateFoodParams {
  description: string;
  meal?: MealType;
  photo?: File | null;
  photoKey?: string | null;
  clarifications?: FoodClarificationTurn[];
}

export function useEstimateFood() {
  return useMutation({
    mutationFn: async (params: EstimateFoodParams): Promise<FoodEstimateResponseDto> => {
      const payload = {
        description: params.description,
        meal: params.meal,
        photoKey: params.photoKey ?? null,
        clarifications: params.clarifications ?? [],
      };
      if (params.photo) {
        const compressed = await compressFoodPhoto(params.photo);
        const form = new FormData();
        form.append("payload", JSON.stringify(payload));
        form.append("photo", compressed);
        const res = await fetch("/api/food/estimate", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        if (!res.ok) throw new ApiError(res.status, await res.text());
        return res.json() as Promise<FoodEstimateResponseDto>;
      }
      return api<FoodEstimateResponseDto>("/food/estimate", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
  });
}

export function useSaveFoodEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (entry: FoodEntryCreate) =>
      api<{ entry: FoodEntryDto }>("/food/entries", {
        method: "POST",
        body: JSON.stringify(entry),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nutrition"] }),
  });
}

export function useUpdateFoodEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: FoodEntryUpdate }) =>
      api<{ entry: FoodEntryDto }>(`/food/entries/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nutrition"] }),
  });
}

export function useDeleteFoodEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ ok: boolean }>(`/food/entries/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nutrition"] }),
  });
}

export function useLogWeight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ManualWeight) =>
      api<{ ok: boolean; measuredAt: string }>("/health/weight", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useImportRenphoCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) =>
      api<{ ok: boolean; imported: number }>("/health/weight/import-csv", {
        method: "POST",
        body: JSON.stringify({ csv }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nutrition"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

type SpeechRecognitionCtor = new () => {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

/** Browser/WebView speech-to-text helper with graceful fallback. */
export function useSpeechDictation(onTranscript: (text: string) => void) {
  const ctor: SpeechRecognitionCtor | undefined =
    typeof window !== "undefined"
      ? ((window as unknown as Record<string, SpeechRecognitionCtor>).SpeechRecognition ??
        (window as unknown as Record<string, SpeechRecognitionCtor>).webkitSpeechRecognition)
      : undefined;

  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<InstanceType<SpeechRecognitionCtor> | null>(null);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (!ctor) return;
    if (listening) {
      stop();
      return;
    }
    setError(null);
    try {
      const rec = new ctor();
      rec.lang = navigator.language || "en-US";
      rec.continuous = false;
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const chunks: string[] = [];
        for (let i = 0; i < ev.results.length; i++) {
          const t = ev.results[i]?.[0]?.transcript?.trim();
          if (t) chunks.push(t);
        }
        if (chunks.length) onTranscript(chunks.join(" "));
      };
      rec.onerror = (ev) => {
        setError(ev.error === "not-allowed" ? "Microphone permission denied" : `Voice error: ${ev.error}`);
        setListening(false);
      };
      rec.onend = () => {
        recRef.current = null;
        setListening(false);
      };
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setError("Voice dictation unavailable here — you can use your keyboard mic.");
      setListening(false);
    }
  }, [ctor, listening, onTranscript, stop]);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported: Boolean(ctor), listening, error, toggle };
}
