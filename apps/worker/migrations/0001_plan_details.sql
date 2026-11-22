ALTER TABLE `goals` ADD `sport` text DEFAULT 'trail_run' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `elevation_loss_m` real;--> statement-breakpoint
ALTER TABLE `goals` ADD `technicality` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `priority` text DEFAULT 'finish' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_weeks` ADD `sports` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `plan_weeks` ADD `goal_sport_share` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `planned_workouts` ADD `steps` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `planned_workouts` ADD `key` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `request` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `summary` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `engine_version` integer DEFAULT 1 NOT NULL;