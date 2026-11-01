CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`options` text NOT NULL,
	`sku` text NOT NULL,
	`unit` text NOT NULL,
	`image` text,
	`track_inventory` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`tax_rate_bps` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`location_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fulfillment` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_email` text NOT NULL,
	`customer_phone` text NOT NULL,
	`address` text,
	`notes` text,
	`payment_method` text NOT NULL,
	`payment_status` text DEFAULT 'pending' NOT NULL,
	`paid_method` text,
	`paid_reference` text,
	`paid_at` text,
	`session_id` text,
	`prices_include_tax` integer NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`shipping_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`ip` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`confirmed_at` text,
	`ready_at` text,
	`completed_at` text,
	`completed_by_name` text,
	`business_date` text,
	`cancelled_at` text,
	`cancel_reason` text,
	`cancelled_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_number_uq` ON `orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_client_uq` ON `orders` (`tenant_id`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_token_uq` ON `orders` (`token`);--> statement-breakpoint
CREATE INDEX `orders_tenant_status_idx` ON `orders` (`tenant_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`location_id` text,
	`tagline` text,
	`about` text,
	`pickup_enabled` integer DEFAULT true NOT NULL,
	`pickup_instructions` text,
	`delivery_enabled` integer DEFAULT false NOT NULL,
	`delivery_fee_cents` integer DEFAULT 0 NOT NULL,
	`free_delivery_from_cents` integer,
	`delivery_area` text,
	`min_order_cents` integer DEFAULT 0 NOT NULL,
	`pay_on_delivery` integer DEFAULT true NOT NULL,
	`transfer_enabled` integer DEFAULT false NOT NULL,
	`transfer_instructions` text,
	`whatsapp` text,
	`notify_email` text,
	`hold_hours` integer DEFAULT 48 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `daily_sales` ADD `online_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_sales` ADD `online_total_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `online` integer DEFAULT false NOT NULL;