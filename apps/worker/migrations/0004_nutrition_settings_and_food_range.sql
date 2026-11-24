CREATE TABLE `nutrition_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text
);
--> statement-breakpoint
ALTER TABLE `food_entries` ADD `kcal_min` real;--> statement-breakpoint
ALTER TABLE `food_entries` ADD `kcal_max` real;