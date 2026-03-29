ALTER TABLE `opportunities` ADD COLUMN `organization_id` text;
--> statement-breakpoint

ALTER TABLE `documents` ADD COLUMN `organization_id` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `file_url` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `storage_provider` text;
--> statement-breakpoint
ALTER TABLE `documents` ADD COLUMN `storage_key` text;
--> statement-breakpoint

ALTER TABLE `submissions` ADD COLUMN `organization_id` text;
--> statement-breakpoint

ALTER TABLE `submission_sessions` ADD COLUMN `organization_id` text;
--> statement-breakpoint
ALTER TABLE `submission_sessions` ADD COLUMN `storage_state_path` text;
--> statement-breakpoint

ALTER TABLE `submission_field_mappings` ADD COLUMN `organization_id` text;
--> statement-breakpoint
ALTER TABLE `submission_upload_artifacts` ADD COLUMN `organization_id` text;
--> statement-breakpoint
ALTER TABLE `portal_form_snapshots` ADD COLUMN `organization_id` text;
--> statement-breakpoint
ALTER TABLE `portal_field_profiles` ADD COLUMN `organization_id` text;
--> statement-breakpoint

UPDATE `opportunities`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

UPDATE `documents`
SET
  `organization_id` = COALESCE(
    `organization_id`,
    (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
  ),
  `storage_provider` = COALESCE(`storage_provider`, CASE
    WHEN TRIM(COALESCE(`file_link`, '')) = '' THEN NULL
    WHEN `file_link` LIKE 'http%' THEN 's3'
    ELSE 'local'
  END),
  `storage_key` = COALESCE(`storage_key`, NULLIF(TRIM(COALESCE(`file_link`, '')), '')),
  `file_url` = COALESCE(
    `file_url`,
    CASE WHEN `file_link` LIKE 'http%' THEN `file_link` ELSE NULL END
  )
WHERE
  `organization_id` IS NULL
  OR `storage_provider` IS NULL
  OR `storage_key` IS NULL
  OR `file_url` IS NULL;
--> statement-breakpoint

UPDATE `submissions`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `organization_id` FROM `opportunities` WHERE `opportunities`.`id` = `submissions`.`opportunity_id`),
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

UPDATE `submission_sessions`
SET
  `organization_id` = COALESCE(
    `organization_id`,
    (SELECT `organization_id` FROM `opportunities` WHERE `opportunities`.`id` = `submission_sessions`.`opportunity_id`),
    (SELECT `organization_id` FROM `submissions` WHERE `submissions`.`id` = `submission_sessions`.`submission_id`),
    (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
  ),
  `storage_state_path` = COALESCE(`storage_state_path`, './data/browser/storage-state.json')
WHERE `organization_id` IS NULL OR `storage_state_path` IS NULL;
--> statement-breakpoint

UPDATE `submission_field_mappings`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `organization_id` FROM `submission_sessions` WHERE `submission_sessions`.`id` = `submission_field_mappings`.`submission_session_id`),
  (SELECT `organization_id` FROM `opportunities` WHERE `opportunities`.`id` = `submission_field_mappings`.`opportunity_id`),
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

UPDATE `submission_upload_artifacts`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `organization_id` FROM `submission_sessions` WHERE `submission_sessions`.`id` = `submission_upload_artifacts`.`submission_session_id`),
  (SELECT `organization_id` FROM `opportunities` WHERE `opportunities`.`id` = `submission_upload_artifacts`.`opportunity_id`),
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

UPDATE `portal_form_snapshots`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `organization_id` FROM `submission_sessions` WHERE `submission_sessions`.`id` = `portal_form_snapshots`.`submission_session_id`),
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

UPDATE `portal_field_profiles`
SET `organization_id` = COALESCE(
  `organization_id`,
  (SELECT `id` FROM `organizations` ORDER BY `created_at` ASC LIMIT 1)
)
WHERE `organization_id` IS NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS `portal_field_profiles_scope_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_field_profiles_scope_unique`
  ON `portal_field_profiles` (
    `organization_id`,
    `portal_host`,
    `portal_path`,
    `normalized_label`,
    `field_type`,
    `occurrence_index`
  );
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `opportunities_organization_idx`
  ON `opportunities` (`organization_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_organization_idx`
  ON `documents` (`organization_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submissions_organization_idx`
  ON `submissions` (`organization_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `submission_sessions_organization_idx`
  ON `submission_sessions` (`organization_id`);
