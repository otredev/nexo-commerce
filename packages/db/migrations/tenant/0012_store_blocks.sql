ALTER TABLE `store_appearance` ADD `blocks` text;--> statement-breakpoint
UPDATE `store_appearance` SET `blocks` = CASE
  WHEN json_array_length(`banners`) > 0 THEN json_array(
    json_object('id', 'banners', 'type', 'banners', 'data', json_object('slides', json(`banners`))),
    json_object('id', 'portada', 'type', 'hero', 'data', json_object('showHeading', json('false'), 'showText', json('false'))),
    json_object('id', 'catalogo', 'type', 'catalog'),
    json_object('id', 'preguntas', 'type', 'faq'))
  ELSE json_array(
    json_object('id', 'portada', 'type', 'hero'),
    json_object('id', 'catalogo', 'type', 'catalog'),
    json_object('id', 'preguntas', 'type', 'faq'))
END;--> statement-breakpoint
UPDATE `store_appearance` SET `blocks` = json_insert(`blocks`, '$[#]', json_object(
  'id', 'html-anterior', 'type', 'html', 'enabled', json('false'), 'name', 'HTML y JavaScript anteriores',
  'data', json_object('title', 'Contenido personalizado', 'html', trim(
    `head_html` || char(10) || `body_html` || CASE WHEN trim(`custom_js`) <> '' THEN char(10) || '<script>' || char(10) || `custom_js` || char(10) || '</script>' ELSE '' END,
    char(10) || ' '))))
WHERE trim(`head_html` || `body_html` || `custom_js`) <> '';--> statement-breakpoint
ALTER TABLE `store_appearance` DROP COLUMN `banners`;--> statement-breakpoint
ALTER TABLE `store_appearance` DROP COLUMN `head_html`;--> statement-breakpoint
ALTER TABLE `store_appearance` DROP COLUMN `body_html`;--> statement-breakpoint
ALTER TABLE `store_appearance` DROP COLUMN `custom_js`;--> statement-breakpoint
CREATE TABLE `store_preview_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `store_preview_tokens_tenant_idx` ON `store_preview_tokens` (`tenant_id`,`expires_at`);
