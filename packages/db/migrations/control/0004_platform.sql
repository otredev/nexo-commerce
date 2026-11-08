CREATE TABLE `platform_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text,
	`operator_name` text NOT NULL,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`tenant_id` text,
	`summary` text,
	`detail` text,
	`ip` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `platform_audit_created_idx` ON `platform_audit` (`created_at`);--> statement-breakpoint
CREATE INDEX `platform_audit_tenant_idx` ON `platform_audit` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `platform_audit_operator_idx` ON `platform_audit` (`operator_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `platform_operators` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_operators_email_uq` ON `platform_operators` (`email`);--> statement-breakpoint
CREATE TABLE `platform_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`user_agent` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `platform_operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `platform_sessions_operator_idx` ON `platform_sessions` (`operator_id`);--> statement-breakpoint
CREATE TABLE `support_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`ticket_id` text NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`internal` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `support_messages_ticket_idx` ON `support_messages` (`ticket_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`tenant_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_by_name` text NOT NULL,
	`created_by_email` text NOT NULL,
	`subject` text NOT NULL,
	`category` text DEFAULT 'question' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`allow_access` integer DEFAULT false NOT NULL,
	`assigned_to` text,
	`last_message_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_to`) REFERENCES `platform_operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_tickets_number_uq` ON `support_tickets` (`number`);--> statement-breakpoint
CREATE INDEX `support_tickets_tenant_idx` ON `support_tickets` (`tenant_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `support_tickets_status_idx` ON `support_tickets` (`status`,`last_message_at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `operator_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `operator_name` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ticket_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;