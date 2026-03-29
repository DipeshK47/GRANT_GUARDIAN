ALTER TABLE `opportunities` ADD COLUMN `source_url` text;
--> statement-breakpoint
ALTER TABLE `opportunities` ADD COLUMN `portal_discovered_at` text;
--> statement-breakpoint

UPDATE `opportunities`
SET `source_url` = COALESCE(
  `source_url`,
  CASE
    WHEN `portal_url` LIKE 'http%' THEN `portal_url`
    ELSE NULL
  END
)
WHERE `source_url` IS NULL;
