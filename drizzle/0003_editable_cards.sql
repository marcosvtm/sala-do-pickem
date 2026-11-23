ALTER TABLE `cards` ADD `edit_hash` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `removed_at` integer;