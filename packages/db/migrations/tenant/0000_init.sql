CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`user_name` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`ip` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_tenant_created_idx` ON `audit_log` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`tenant_id`,`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `business_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`trade_name` text NOT NULL,
	`legal_name` text,
	`tax_id` text,
	`email` text,
	`phone` text,
	`address` text,
	`currency` text DEFAULT 'MXN' NOT NULL,
	`timezone` text DEFAULT 'America/Mexico_City' NOT NULL,
	`locale` text DEFAULT 'es-MX' NOT NULL,
	`prices_include_tax` integer DEFAULT true NOT NULL,
	`receipt_footer` text,
	`logo_key` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'store' NOT NULL,
	`address` text,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `locations_tenant_idx` ON `locations` (`tenant_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `locations_tenant_name_uq` ON `locations` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tax_rates_tenant_idx` ON `tax_rates` (`tenant_id`);