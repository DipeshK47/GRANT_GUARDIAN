CREATE TABLE `submission_upload_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`submission_session_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_record_id` text,
	`artifact_title` text NOT NULL,
	`file_name` text,
	`mime_type` text,
	`original_path` text,
	`staged_path` text,
	`staging_status` text NOT NULL,
	`byte_size` integer,
	`notes` text
);
