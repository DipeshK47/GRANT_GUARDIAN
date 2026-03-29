ALTER TABLE `organizations` ADD `clerk_user_id` text;
--> statement-breakpoint
ALTER TABLE `organizations` ADD `onboarding_completed` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_clerk_user_id_unique` ON `organizations` (`clerk_user_id`);
