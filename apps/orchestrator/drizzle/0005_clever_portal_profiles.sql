CREATE TABLE `portal_form_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`submission_session_id` text,
	`opportunity_id` text,
	`portal_url` text NOT NULL,
	`portal_host` text NOT NULL,
	`portal_path` text NOT NULL,
	`field_count` integer NOT NULL,
	`capture_source` text NOT NULL,
	`field_inventory` text NOT NULL,
	`captured_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `portal_field_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`portal_host` text NOT NULL,
	`portal_path` text NOT NULL,
	`portal_url` text NOT NULL,
	`normalized_label` text NOT NULL,
	`field_label` text NOT NULL,
	`field_type` text NOT NULL,
	`tag_name` text NOT NULL,
	`input_type` text NOT NULL,
	`occurrence_index` integer NOT NULL,
	`placeholder_sample` text,
	`aria_label_sample` text,
	`times_seen` integer NOT NULL,
	`times_matched` integer NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_matched_at` text,
	`last_mapped_field_label` text,
	`last_fill_action` text,
	`last_confidence` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_field_profiles_scope_unique` ON `portal_field_profiles` (
	`portal_host`,
	`portal_path`,
	`normalized_label`,
	`field_type`,
	`occurrence_index`
);
