ALTER TABLE `reporting_calendar`
ADD `organization_id` text;

--> statement-breakpoint

UPDATE `reporting_calendar`
SET `organization_id` = (
  SELECT `organization_id`
  FROM `opportunities`
  WHERE `opportunities`.`id` = `reporting_calendar`.`opportunity_id`
)
WHERE `organization_id` IS NULL;

--> statement-breakpoint

ALTER TABLE `lessons`
ADD `organization_id` text;

--> statement-breakpoint

UPDATE `lessons`
SET `organization_id` = (
  SELECT `organization_id`
  FROM `opportunities`
  WHERE `opportunities`.`id` = `lessons`.`opportunity_id`
)
WHERE `organization_id` IS NULL
  AND `opportunity_id` IS NOT NULL;
