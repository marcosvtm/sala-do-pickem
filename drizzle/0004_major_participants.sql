CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`recovery_hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `participants_recovery_hash_unique` ON `participants` (`recovery_hash`);--> statement-breakpoint
ALTER TABLE `cards` ADD `participant_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `stage_participant` ON `cards` (`stage`,`participant_id`);