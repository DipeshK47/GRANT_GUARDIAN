ALTER TABLE `submissions`
ADD `adapter_key` text;

--> statement-breakpoint

ALTER TABLE `submission_sessions`
ADD `adapter_key` text;

--> statement-breakpoint

UPDATE `submissions`
SET `adapter_key` = CASE
  WHEN lower(ifnull(`method`, '')) LIKE '%submittable%' THEN 'submittable'
  WHEN lower(ifnull(`method`, '')) LIKE '%email%' THEN 'email'
  WHEN lower(ifnull(`method`, '')) LIKE '%portal%' THEN 'generic-portal'
  ELSE 'manual'
END
WHERE `adapter_key` IS NULL;

--> statement-breakpoint

UPDATE `submission_sessions`
SET `adapter_key` = CASE
  WHEN lower(ifnull(`portal_url`, '')) LIKE 'mailto:%' THEN 'email'
  WHEN lower(ifnull(`portal_url`, '')) LIKE '%submittable%' THEN 'submittable'
  ELSE 'generic-portal'
END
WHERE `adapter_key` IS NULL;
