CREATE TABLE `funder_grant_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`funder_id` text NOT NULL,
	`filing_id` text NOT NULL,
	`tax_year` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`recipient_city` text,
	`recipient_state` text,
	`recipient_ein` text,
	`grant_amount` real,
	`purpose` text,
	`raw_text` text,
	`extraction_method` text NOT NULL,
	`confidence` real
);
