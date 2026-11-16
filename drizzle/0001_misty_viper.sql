CREATE TABLE `dau_request_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`checkout_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `dau_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkout_id`) REFERENCES `dau_checkouts`(`id`) ON UPDATE no action ON DELETE no action
);
