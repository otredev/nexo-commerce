CREATE TABLE `store_appearance` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`theme` text NOT NULL,
	`announcement` text NOT NULL,
	`banners` text DEFAULT '[]' NOT NULL,
	`pixels` text NOT NULL,
	`custom_css` text DEFAULT '' NOT NULL,
	`head_html` text DEFAULT '' NOT NULL,
	`body_html` text DEFAULT '' NOT NULL,
	`custom_js` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
