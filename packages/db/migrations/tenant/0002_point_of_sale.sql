CREATE TABLE `cash_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reason` text NOT NULL,
	`user_id` text,
	`user_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cash_movements_session_idx` ON `cash_movements` (`session_id`);--> statement-breakpoint
CREATE TABLE `cash_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`location_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opening_cash_cents` integer NOT NULL,
	`opened_by` text,
	`opened_by_name` text,
	`opened_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`closed_by` text,
	`closed_by_name` text,
	`closed_at` text,
	`expected_cash_cents` integer,
	`counted_cash_cents` integer,
	`difference_cents` integer,
	`totals` text,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `cash_sessions_tenant_idx` ON `cash_sessions` (`tenant_id`,`opened_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `cash_sessions_one_open_uq` ON `cash_sessions` (`tenant_id`,`location_id`) WHERE status = 'open';--> statement-breakpoint
CREATE TABLE `counters` (
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `name`)
);
--> statement-breakpoint
CREATE TABLE `daily_product_sales` (
	`tenant_id` text NOT NULL,
	`date` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `date`, `variant_id`)
);
--> statement-breakpoint
CREATE INDEX `daily_product_tenant_date_idx` ON `daily_product_sales` (`tenant_id`,`date`);--> statement-breakpoint
CREATE TABLE `daily_sales` (
	`tenant_id` text NOT NULL,
	`date` text NOT NULL,
	`location_id` text NOT NULL,
	`sales_count` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`discount_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`cost_cents` integer DEFAULT 0 NOT NULL,
	`returns_cents` integer DEFAULT 0 NOT NULL,
	`voided_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`tenant_id`, `date`, `location_id`)
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`options` text NOT NULL,
	`sku` text NOT NULL,
	`unit` text NOT NULL,
	`track_inventory` integer NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`tax_rate_bps` integer NOT NULL,
	`net_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`returned_quantity` integer DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT "sale_items_returned_le_qty" CHECK("sale_items"."returned_quantity" <= "sale_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `sale_items_sale_idx` ON `sale_items` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text
);
--> statement-breakpoint
CREATE INDEX `sale_payments_sale_idx` ON `sale_payments` (`sale_id`);--> statement-breakpoint
CREATE TABLE `sale_return_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`return_id` text NOT NULL,
	`sale_item_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`refund_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sale_return_items_return_idx` ON `sale_return_items` (`return_id`);--> statement-breakpoint
CREATE TABLE `sale_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`location_id` text NOT NULL,
	`session_id` text,
	`refund_method` text NOT NULL,
	`refund_cents` integer NOT NULL,
	`restock` integer NOT NULL,
	`reason` text NOT NULL,
	`user_id` text,
	`user_name` text,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sale_returns_sale_idx` ON `sale_returns` (`sale_id`);--> statement-breakpoint
CREATE INDEX `sale_returns_session_idx` ON `sale_returns` (`session_id`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`client_id` text NOT NULL,
	`location_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text,
	`user_name` text,
	`customer_name` text,
	`customer_contact` text,
	`note` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`prices_include_tax` integer NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`discount_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`cost_cents` integer NOT NULL,
	`paid_cents` integer NOT NULL,
	`change_cents` integer NOT NULL,
	`refunded_cents` integer DEFAULT 0 NOT NULL,
	`business_date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`voided_at` text,
	`voided_by` text,
	`void_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_tenant_number_uq` ON `sales` (`tenant_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_tenant_client_uq` ON `sales` (`tenant_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `sales_tenant_date_idx` ON `sales` (`tenant_id`,`business_date`);--> statement-breakpoint
CREATE INDEX `sales_session_idx` ON `sales` (`session_id`);--> statement-breakpoint
ALTER TABLE `business_settings` ADD `cashier_max_discount_bps` integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE `business_settings` ADD `receipt_width_mm` integer DEFAULT 80 NOT NULL;