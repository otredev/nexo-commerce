CREATE TABLE `customer_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`address` text,
	`password_hash` text NOT NULL,
	`created_ip` text,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_accounts_email_uq` ON `customer_accounts` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `customer_accounts_customer_idx` ON `customer_accounts` (`tenant_id`,`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_password_resets` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_password_resets_account_idx` ON `customer_password_resets` (`tenant_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customer_sessions_account_idx` ON `customer_sessions` (`tenant_id`,`account_id`);--> statement-breakpoint
ALTER TABLE `orders` ADD `account_id` text;--> statement-breakpoint
CREATE INDEX `orders_account_idx` ON `orders` (`tenant_id`,`account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `store_settings` ADD `account_required` integer DEFAULT true NOT NULL;