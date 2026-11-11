ALTER TABLE `business_settings` ADD `receipt_options` text DEFAULT '["print","email","none"]' NOT NULL;--> statement-breakpoint
CREATE TABLE `sms_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'twilio' NOT NULL,
	`account_sid` text NOT NULL,
	`auth_token_enc` text NOT NULL,
	`sender` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);--> statement-breakpoint
ALTER TABLE `promotions` ADD `members_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `locations` ADD `stripe_terminal_location_id` text;--> statement-breakpoint
ALTER TABLE `sale_payments` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sale_payments_pi_uq` ON `sale_payments` (`stripe_payment_intent_id`) WHERE stripe_payment_intent_id IS NOT NULL;
