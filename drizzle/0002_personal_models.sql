CREATE TABLE `personal_models` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`nick` text NOT NULL,
	`nick_key` text NOT NULL,
	`submitted` integer NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_nick_settings` ON `personal_models` (`stage`,`nick_key`,`settings`);