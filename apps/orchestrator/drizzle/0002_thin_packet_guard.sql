DELETE FROM `submissions`
WHERE `rowid` IN (
  SELECT `rowid`
  FROM (
    SELECT
      `rowid`,
      ROW_NUMBER() OVER (
        PARTITION BY `opportunity_id`
        ORDER BY `updated_at` DESC, `created_at` DESC, `rowid` DESC
      ) AS `duplicate_rank`
    FROM `submissions`
  )
  WHERE `duplicate_rank` > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_opportunity_id_unique`
ON `submissions` (`opportunity_id`);
