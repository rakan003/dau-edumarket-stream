CREATE TABLE `dau_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`client_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`input_json` text NOT NULL,
	`total_cents` integer NOT NULL,
	`consumer_id` text,
	`link_id` text,
	`url` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `dau_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dau_session_request` ON `dau_checkouts` (`session_id`,`client_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `dau_session_fingerprint` ON `dau_checkouts` (`session_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `dau_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text,
	`stage` text DEFAULT 'new' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dau_locks` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dau_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
