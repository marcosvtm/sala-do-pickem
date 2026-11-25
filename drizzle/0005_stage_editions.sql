CREATE TABLE `stage_editions` (
	`stage` text PRIMARY KEY NOT NULL,
	`attempted` integer NOT NULL,
	`activated_at` integer,
	`detail` text,
	`edition` text,
	`replay` text
);
