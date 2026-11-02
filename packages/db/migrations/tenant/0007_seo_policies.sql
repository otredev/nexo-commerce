CREATE TABLE `store_policies` (
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`published` integer DEFAULT true NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `kind`)
);
--> statement-breakpoint
CREATE TABLE `store_policy_versions` (
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`tenant_id`, `kind`, `version`)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `legal_accepted_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `terms_version` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `privacy_version` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `seo_title` text;--> statement-breakpoint
ALTER TABLE `products` ADD `seo_description` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `seo_title` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `seo_description` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `indexable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `faq` text DEFAULT '[]' NOT NULL;