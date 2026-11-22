import type { Sport } from "@trailblazer/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: { firstname: string | null } | null;
}

export interface TrainingSummary {
  windowDays: number;
  activityCount: number;
  weeklyHours: number;
  sessionsPerWeek: number;
  longestSessionMin: number;
  sports: Sport[];
  regular: { sport: Sport; perWeek: number; avgMin: number }[];
  maxHrObserved: number | null;
}

export const useStravaStatus = () => useQuery({ queryKey: ["strava", "status"], queryFn: () => api<StravaStatus>("/strava/status") });

/** Fetches recent activities from Strava (stores them) and returns a summary. Cached for the session. */
export const useStravaSummary = (enabled: boolean) =>
  useQuery({
    queryKey: ["strava", "summary"],
    queryFn: () => api<TrainingSummary>("/strava/summary"),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });

export const connectStrava = (returnPath: string) => {
  window.location.href = `/api/strava/connect?return=${encodeURIComponent(returnPath)}`;
};

export const useDisconnectStrava = (onDone: () => void) =>
  useMutation({ mutationFn: () => api("/strava/disconnect", { method: "POST" }), onSuccess: onDone });
