CREATE TABLE `purchase_order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`options` text NOT NULL,
	`sku` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`received_quantity` integer DEFAULT 0 NOT NULL,
	`unit_cost_cents` integer NOT NULL,
	`tax_rate_bps` integer DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT "purchase_order_items_received_le_qty" CHECK("purchase_order_items"."received_quantity" <= "purchase_order_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `purchase_order_items_order_idx` ON `purchase_order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`supplier_id` text NOT NULL,
	`location_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`expected_date` text,
	`note` text,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`tax_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`received_cents` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_by_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`ordered_at` text,
	`closed_at` text,
	`cancelled_at` text,
	`cancel_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_tenant_number_uq` ON `purchase_orders` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `purchase_orders_tenant_status_idx` ON `purchase_orders` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_idx` ON `purchase_orders` (`tenant_id`,`supplier_id`);--> statement-breakpoint
CREATE TABLE `purchase_receipt_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`order_item_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_cost_cents` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_receipt_items_receipt_idx` ON `purchase_receipt_items` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `purchase_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`location_id` text NOT NULL,
	`supplier_reference` text,
	`note` text,
	`total_cents` integer NOT NULL,
	`user_id` text,
	`user_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `purchase_receipts_order_idx` ON `purchase_receipts` (`order_id`);--> statement-breakpoint
CREATE TABLE `stock_count_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`count_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`options` text NOT NULL,
	`sku` text NOT NULL,
	`barcode` text,
	`unit` text NOT NULL,
	`expected_quantity` integer NOT NULL,
	`counted_quantity` integer,
	`counted_by_name` text,
	`counted_at` text,
	`stock_at_count` integer,
	`final_before` integer,
	`final_delta` integer,
	`unit_cost_cents` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_count_items_count_variant_uq` ON `stock_count_items` (`count_id`,`variant_id`);--> statement-breakpoint
CREATE INDEX `stock_count_items_count_idx` ON `stock_count_items` (`count_id`);--> statement-breakpoint
CREATE TABLE `stock_counts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`location_id` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`scope` text NOT NULL,
	`category_id` text,
	`note` text,
	`created_by` text,
	`created_by_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`completed_at` text,
	`completed_by_name` text,
	`summary` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_counts_tenant_number_uq` ON `stock_counts` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `stock_counts_tenant_status_idx` ON `stock_counts` (`tenant_id`,`status`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`email` text,
	`phone` text,
	`tax_id` text,
	`address` text,
	`payment_terms_days` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_tenant_name_uq` ON `suppliers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `transfer_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`options` text NOT NULL,
	`sku` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`received_quantity` integer,
	`unit_cost_cents` integer,
	`position` integer NOT NULL,
	CONSTRAINT "transfer_items_received_le_qty" CHECK("transfer_items"."received_quantity" IS NULL OR "transfer_items"."received_quantity" <= "transfer_items"."quantity")
);
--> statement-breakpoint
CREATE INDEX `transfer_items_transfer_idx` ON `transfer_items` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` integer NOT NULL,
	`from_location_id` text NOT NULL,
	`to_location_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`created_by` text,
	`created_by_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`sent_at` text,
	`sent_by_name` text,
	`received_at` text,
	`received_by_name` text,
	`cancelled_at` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfers_tenant_number_uq` ON `transfers` (`tenant_id`,`number`);--> statement-breakpoint
CREATE INDEX `transfers_tenant_status_idx` ON `transfers` (`tenant_id`,`status`);