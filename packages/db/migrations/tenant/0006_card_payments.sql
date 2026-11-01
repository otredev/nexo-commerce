ALTER TABLE `orders` ADD `stripe_session_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `stripe_payment_intent_id` text;--> statement-breakpoint
ALTER TABLE `store_settings` ADD `card_enabled` integer DEFAULT false NOT NULL;