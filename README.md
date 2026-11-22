# Trailblazer

Personal trail / mountain training platform: plan generation for vertical-heavy goals,
multi-sport (ski touring) load credit, Strava / Garmin / Renpho sync, DEXA parsing,
photo-based food logging, nutrition targets, trends, and a Claude-powered coach.

Single-user. Runs entirely on Cloudflare (Workers + D1 + R2 + Queues + Cron), behind Cloudflare Access.

## Layout

| Path | What |
| --- | --- |
| `apps/worker` | Hono API, cron + queue handlers, D1 schema (`src/db/schema.ts`), migrations |
| `apps/web` | React PWA (Vite, Tailwind, TanStack Query) — built to `apps/web/dist` and served as Worker static assets |
| `packages/shared` | zod schemas + types shared by both |
| `wrangler.toml` | single Worker config at the repo root |

## Local development

Requires Node 22+ and **npm 11** (`npx npm@11 install`; npm 10 crashes resolving this tree).

```sh
npx -y npm@11 install
cp .dev.vars.example .dev.vars        # sets DEV_BYPASS_AUTH=true; fill TOKEN_ENC_KEY (openssl rand -base64 32)
npm run db:migrate:local
npm run dev                           # builds the web app, runs wrangler dev on http://localhost:8787
# frontend hot reload: `npx wrangler dev` in one terminal + `npm run dev:web` in another (proxies /api)
npm test                              # shared engine tests + worker tests inside workerd with a local D1
```

## Secrets

Never put secrets in `wrangler.toml` or Terraform (Terraform state is plaintext).

| Secret | Local | Production |
| --- | --- | --- |
| `TOKEN_ENC_KEY` | `.dev.vars` | `npx wrangler secret put TOKEN_ENC_KEY` |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | `.dev.vars` | `npx wrangler secret put …` |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` (any random string) | `.dev.vars` | `npx wrangler secret put …` |
| `ANTHROPIC_API_KEY` | `.dev.vars` | `npx wrangler secret put …` |

In the Strava API settings, set **Authorization Callback Domain** to `localhost` while developing, then to your app hostname.

## Database migrations

[drizzle-kit](https://orm.drizzle.team/docs/kit-overview) plays the Alembic role. `apps/worker/src/db/schema.ts` is the model, the migrations
are generated SQL files in `apps/worker/migrations/`, and Wrangler applies them and records which ones ran in D1's `d1_migrations` table.

| Alembic | Here |
| --- | --- |
| `alembic revision --autogenerate -m "x"` | `npm run db:generate -- --name x` |
| `alembic upgrade head` | `npm run db:migrate:local` / `npm run db:migrate:remote` |
| `alembic current` / `history` | `npm run db:status` / `npm run db:status:remote` |
| `alembic check` | `npm run db:check` + CI drift check (fails if schema.ts changed without a migration) |
| `alembic downgrade` | None. Write a new forward migration, or restore with D1 Time Travel (`wrangler d1 time-travel restore`) |

Rules:
- Always review the generated SQL before committing.
- Prefer additive changes. A new `NOT NULL` column needs a `DEFAULT`.
- Avoid changes that make drizzle rebuild a table. D1 ignores `PRAGMA foreign_keys=OFF`, so a rebuild can cascade-delete child rows.

`npm run deploy` and CI apply pending migrations before deploying the Worker.

## Infrastructure (Terraform)

`infra/terraform` manages the Cloudflare resources:
- D1, R2, and the job queue with its dead-letter queue
- the Access application and policy (only your email)
- a bypass app for the Strava webhook path
- the Worker's custom domain

State is local for now (`infra/terraform/terraform.tfstate`, gitignored). Move it to a remote backend later.
Wrangler deploys the Worker code, its bindings, cron triggers and queue consumer from `wrangler.toml`.

API token permissions:
- Account: D1 Edit, Workers R2 Storage Edit, Queues Edit, Workers Scripts Edit, Access: Apps and Policies Edit, Zero Trust Read
- Zone: Workers Routes Edit, Zone Read, DNS Edit

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars      # account_id, zone_name, hostname, allowed_emails
export CLOUDFLARE_API_TOKEN=...
terraform init && terraform apply
cd ../.. && npm run infra:sync                     # writes D1 id + Access AUD/team domain into wrangler.toml
npx wrangler secret put TOKEN_ENC_KEY              # + the other secrets above
npm run deploy                                     # migrations + wrangler deploy
# then set attach_custom_domain = true in terraform.tfvars and `terraform apply` again
```

Continuous deployment: in the GitHub repo settings, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`,
commit the synced `wrangler.toml`, then set the repository **variable** `DEPLOY_ENABLED=true`. From then on, every push to
`main` that passes the checks applies migrations and deploys. Until that variable is set, CI only runs the checks.

The Worker also verifies the `Cf-Access-Jwt-Assertion` JWT (signature, issuer, audience) on every `/api` request. `workers.dev`
and preview URLs are disabled, so the only way in is through Access. `DEV_BYPASS_AUTH` must only ever be set in `.dev.vars`.

## Training plan engine

`packages/shared/src/plan` is deterministic. It runs in the browser for the instant wizard preview and in the Worker for the saved plan.

- **`periodization.ts`** works back from race day: base → build → specific → taper.
  - Load/recovery runs 3:1 (2:1 for beginners or age 50+), and the ramp is capped at 6–10% per week.
  - Weekly targets are in **hours, vertical metres and long-day duration**, not pace.
  - Peak load comes from the estimated event duration (ITRA-style effort-km) and your weekly cap.
- **Seasons:** each sport has a month-day window.
  - When the goal sport is out of season, its volume moves to the available sport with the best carry-over, e.g. ski touring.
  - When the goal sport returns, it comes back gradually at 50→70→85% over three weeks.
- **`workouts.ts`** lays out each week on your training days. Every session has steps, zones and vertical targets. The session types are:
  - long day, and back-to-backs in the specific phase
  - uphill intervals, tempo, downhill repeats and hill sprints
  - phase-specific strength
  - race-week openers

## Roadmap

1. ✅ Scaffold: monorepo, D1 schema, R2/Queues/Cron bindings, Access JWT check, PWA shell, CI, Terraform
2. Strava OAuth + webhook + 12-month backfill
3. ✅ Plan wizard, periodization + workout engine, Plan view (LLM refinement of workouts comes with the coach)
4. Chat coach (tool use, plan-change diffs)
5. Food logging (photo/text) + nutrition targets
6. Renpho, DEXA, Garmin integrations (+ file-import fallbacks)
7. Trends dashboards
8. Adaptation cron, Garmin workout push
