CREATE TABLE `stripe_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `cf_id` text;--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `ssl_status` text;--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `verification` text;--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `last_error` text;--> statement-breakpoint
ALTER TABLE `tenant_domains` ADD `checked_at` text;--> statement-breakpoint
CREATE INDEX `tenant_domains_tenant_idx` ON `tenant_domains` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `tenants` ADD `plan_status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `plan_period_end` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripe_account_id` text;--> statement-breakpoint
ALTER TABLE `tenants` ADD `stripe_charges_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `tenants` ADD `suspended_reason` text;--> statement-breakpoint
CREATE INDEX `tenants_stripe_customer_idx` ON `tenants` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `tenants_stripe_account_idx` ON `tenants` (`stripe_account_id`);