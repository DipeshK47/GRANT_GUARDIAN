CREATE TABLE `submission_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`status` text NOT NULL,
	`launch_mode` text NOT NULL,
	`portal_url` text NOT NULL,
	`launch_command` text,
	`launch_requested_at` text NOT NULL,
	`launch_triggered_at` text,
	`final_submit_authorized` integer NOT NULL,
	`final_submit_authorized_at` text,
	`reviewer_name` text,
	`reviewer_notes` text
);
