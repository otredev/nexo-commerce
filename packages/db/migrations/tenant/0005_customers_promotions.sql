CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`value` integer NOT NULL,
	`min_subtotal_cents` integer DEFAULT 0 NOT NULL,
	`max_uses` integer,
	`uses_count` integer DEFAULT 0 NOT NULL,
	`channel` text DEFAULT 'all' NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "coupons_uses_le_max" CHECK("coupons"."max_uses" IS NULL OR "coupons"."uses_count" <= "coupons"."max_uses")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_tenant_code_uq` ON `coupons` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`phone` text,
	`tax_id` text,
	`address` text,
	`notes` text,
	`accepts_marketing` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'admin' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`search_text` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `customers_tenant_name_idx` ON `customers` (`tenant_id`,`name`);--> statement-breakpoint
CREATE INDEX `customers_tenant_email_idx` ON `customers` (`tenant_id`,`email`);--> statement-breakpoint
CREATE INDEX `customers_tenant_phone_idx` ON `customers` (`tenant_id`,`phone`);--> statement-breakpoint
CREATE TABLE `promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`percent_bps` integer NOT NULL,
	`target` text NOT NULL,
	`target_ids` text DEFAULT '[]' NOT NULL,
	`channel` text DEFAULT 'all' NOT NULL,
	`starts_on` text,
	`ends_on` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `promotions_tenant_idx` ON `promotions` (`tenant_id`,`active`);--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`supplier_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	`paid_on` text NOT NULL,
	`note` text,
	`session_id` text,
	`user_id` text,
	`user_name` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `supplier_payments_receipt_idx` ON `supplier_payments` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `supplier_payments_supplier_idx` ON `supplier_payments` (`tenant_id`,`supplier_id`);--> statement-breakpoint
ALTER TABLE `order_items` ADD `discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_items` ADD `promotion_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `customer_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `coupon_code` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`tenant_id`,`customer_id`);--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD `tax_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD `amount_due_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD `paid_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_receipts` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `sale_items` ADD `promotion_id` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `customer_id` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `coupon_code` text;--> statement-breakpoint
ALTER TABLE `sales` ADD `promo_discount_cents` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `sales_customer_idx` ON `sales` (`tenant_id`,`customer_id`);--> statement-breakpoint
-- Accounts payable for receipts recorded before this migration: tax from the order lines,
-- amount due = net + tax, due date from the supplier's credit days.
UPDATE `purchase_receipts` SET `tax_cents` = COALESCE((
  SELECT SUM(ROUND(ri.quantity * ri.unit_cost_cents / 1000.0 * oi.tax_rate_bps / 10000.0))
  FROM `purchase_receipt_items` ri JOIN `purchase_order_items` oi ON oi.id = ri.order_item_id
  WHERE ri.receipt_id = `purchase_receipts`.id), 0);--> statement-breakpoint
UPDATE `purchase_receipts` SET `amount_due_cents` = `total_cents` + `tax_cents`;--> statement-breakpoint
UPDATE `purchase_receipts` SET `due_date` = (
  SELECT date(`purchase_receipts`.created_at, '+' || s.payment_terms_days || ' days')
  FROM `purchase_orders` o JOIN `suppliers` s ON s.id = o.supplier_id WHERE o.id = `purchase_receipts`.order_id);
