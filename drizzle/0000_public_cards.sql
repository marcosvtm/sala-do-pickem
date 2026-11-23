CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`nick` text NOT NULL,
	`nick_key` text NOT NULL,
	`submitted` integer NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_nick` ON `cards` (`stage`,`nick_key`);--> statement-breakpoint
CREATE TABLE `stage_results` (
	`stage` text PRIMARY KEY NOT NULL,
	`locks` text NOT NULL,
	`checked` integer NOT NULL,
	`attempted` integer NOT NULL
);
