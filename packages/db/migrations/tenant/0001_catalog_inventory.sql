CREATE TABLE `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `brands_tenant_name_uq` ON `brands` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_tenant_name_uq` ON `categories` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category_id` text,
	`brand_id` text,
	`tax_rate_id` text,
	`unit` text DEFAULT 'unit' NOT NULL,
	`track_inventory` integer DEFAULT true NOT NULL,
	`option_names` text DEFAULT '[]' NOT NULL,
	`images` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `products_tenant_status_idx` ON `products` (`tenant_id`,`status`,`name`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`tenant_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `products_brand_idx` ON `products` (`tenant_id`,`brand_id`);--> statement-breakpoint
CREATE TABLE `stock_levels` (
	`tenant_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`variant_id`, `location_id`),
	CONSTRAINT "stock_non_negative" CHECK("stock_levels"."quantity" >= 0)
);
--> statement-breakpoint
CREATE INDEX `stock_tenant_location_idx` ON `stock_levels` (`tenant_id`,`location_id`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`type` text NOT NULL,
	`reason` text NOT NULL,
	`quantity_delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`unit_cost_cents` integer,
	`note` text,
	`reference` text,
	`user_id` text,
	`user_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `movements_variant_idx` ON `stock_movements` (`tenant_id`,`variant_id`,`id`);--> statement-breakpoint
CREATE INDEX `movements_tenant_idx` ON `stock_movements` (`tenant_id`,`id`);--> statement-breakpoint
CREATE INDEX `movements_location_idx` ON `stock_movements` (`tenant_id`,`location_id`,`id`);--> statement-breakpoint
CREATE TABLE `variants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`options` text DEFAULT '[]' NOT NULL,
	`price_cents` integer NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `variants_product_idx` ON `variants` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `variants_tenant_sku_uq` ON `variants` (`tenant_id`,`sku`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `variants_tenant_barcode_uq` ON `variants` (`tenant_id`,`barcode`) WHERE deleted_at IS NULL AND barcode IS NOT NULL;