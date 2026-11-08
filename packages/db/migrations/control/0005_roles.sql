CREATE TABLE `tenant_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`permissions` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_roles_name_uq` ON `tenant_roles` (`tenant_id`,`name`);--> statement-breakpoint
ALTER TABLE `memberships` ADD `role_id` text;--> statement-breakpoint
CREATE INDEX `memberships_role_idx` ON `memberships` (`tenant_id`,`role_id`);--> statement-breakpoint
ALTER TABLE `platform_operators` ADD `permissions` text DEFAULT '["*"]' NOT NULL;