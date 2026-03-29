CREATE TABLE `notion_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`clerk_user_id` text NOT NULL,
	`access_token` text,
	`workspace_id` text,
	`workspace_name` text,
	`bot_id` text,
	`connected_at` text NOT NULL,
	`disconnected_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notion_connections_clerk_user_id_unique` ON `notion_connections` (`clerk_user_id`);
