export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JOBS: Queue<Job>;
  ASSETS: Fetcher;

  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  MODEL_FAST: string;
  MODEL_PLAN: string;
  GEMINI_MODEL?: string;

  // secrets
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  TOKEN_ENC_KEY: string;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
  STRAVA_WEBHOOK_VERIFY_TOKEN?: string;
  /** Only ever set in local .dev.vars. */
  DEV_BYPASS_AUTH?: string;
}

export type Job =
  | { kind: "dexa.extract"; scanId: number }
  | { kind: "strava.activity"; activityId: number; aspect: "create" | "update" | "delete" }
  | { kind: "strava.backfill"; before?: number };

export type AppEnv = { Bindings: Env; Variables: { userEmail: string } };
