CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`start_time` text NOT NULL,
	`sport` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`moving_time_s` integer NOT NULL,
	`elapsed_time_s` integer NOT NULL,
	`distance_m` real DEFAULT 0 NOT NULL,
	`elevation_gain_m` real DEFAULT 0 NOT NULL,
	`elevation_loss_m` real,
	`avg_hr` real,
	`max_hr` real,
	`kcal` real,
	`load` real,
	`polyline` text,
	`planned_workout_id` integer,
	`raw` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`planned_workout_id`) REFERENCES `planned_workouts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activities_source_ext` ON `activities` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `activities_start` ON `activities` (`start_time`);--> statement-breakpoint
CREATE TABLE `athlete_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `body_measurements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`measured_at` text NOT NULL,
	`weight_kg` real NOT NULL,
	`fat_pct` real,
	`muscle_kg` real,
	`water_pct` real,
	`bmr_kcal` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `body_source_ext` ON `body_measurements` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `body_measured` ON `body_measurements` (`measured_at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_thread` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT 'New chat' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `daily_metrics` (
	`date` text PRIMARY KEY NOT NULL,
	`steps` integer,
	`resting_hr` real,
	`hrv` real,
	`sleep_min` real,
	`vo2max_run` real,
	`vo2max_bike` real,
	`readiness` real,
	`active_kcal` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dexa_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_date` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`r2_key` text NOT NULL,
	`total_fat_pct` real,
	`fat_mass_kg` real,
	`lean_mass_kg` real,
	`bone_mass_kg` real,
	`visceral_fat_g` real,
	`bmd_t_score` real,
	`regions` text,
	`extracted` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`eaten_at` text NOT NULL,
	`meal` text,
	`description` text DEFAULT '' NOT NULL,
	`photo_key` text,
	`items` text,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`confidence` text,
	`user_corrected` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `food_eaten` ON `food_entries` (`eaten_at`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`event_date` text NOT NULL,
	`distance_km` real NOT NULL,
	`elevation_gain_m` real NOT NULL,
	`target_time_min` real,
	`terrain_notes` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `integration_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`last_error` text,
	`last_sync_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plan_weeks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_id` integer NOT NULL,
	`week_start` text NOT NULL,
	`phase` text NOT NULL,
	`is_recovery` integer DEFAULT false NOT NULL,
	`target_hours` real NOT NULL,
	`target_vertical_m` real NOT NULL,
	`target_long_min` real NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_weeks_plan_week` ON `plan_weeks` (`plan_id`,`week_start`);--> statement-breakpoint
CREATE TABLE `planned_workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plan_week_id` integer NOT NULL,
	`date` text NOT NULL,
	`sport` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`duration_min` real NOT NULL,
	`distance_km` real,
	`vertical_m` real,
	`intensity` text,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	FOREIGN KEY (`plan_week_id`) REFERENCES `plan_weeks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planned_workouts_date` ON `planned_workouts` (`date`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goal_id` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`start_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action
);
