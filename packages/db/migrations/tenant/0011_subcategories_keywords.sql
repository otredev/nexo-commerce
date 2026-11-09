DROP INDEX `categories_tenant_name_uq`;--> statement-breakpoint
ALTER TABLE `categories` ADD `parent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_tenant_parent_name_uq` ON `categories` (`tenant_id`,coalesce(`parent_id`, ''),`name`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`tenant_id`,`parent_id`);--> statement-breakpoint
ALTER TABLE `products` ADD `keywords` text DEFAULT '[]' NOT NULL;