CREATE TABLE `agent_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`run_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`action_description` text NOT NULL,
	`source_url` text,
	`confidence_level` real,
	`output_summary` text,
	`follow_up_required` integer
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`access_token_encrypted` text NOT NULL,
	`refresh_token_encrypted` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`program_id` text,
	`name` text NOT NULL,
	`fiscal_year` integer,
	`budget_type` text NOT NULL,
	`line_items` text,
	`total_revenue` real,
	`total_expense` real,
	`restricted_vs_unrestricted` text
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`document_type` text NOT NULL,
	`file_link` text,
	`upload_status` text NOT NULL,
	`expiration_date` text,
	`owner` text,
	`last_verified_at` text,
	`required_by_opportunity_ids` text
);
--> statement-breakpoint
CREATE TABLE `draft_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`draft_text` text NOT NULL,
	`word_count` integer,
	`evidence_citations` text,
	`unsupported_claims` text,
	`status` text NOT NULL,
	`reviewer_comments` text,
	`revision_notes` text,
	`dna_match_score` real
);
--> statement-breakpoint
CREATE TABLE `evidence_library` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`program_id` text,
	`title` text NOT NULL,
	`evidence_type` text NOT NULL,
	`content` text NOT NULL,
	`source_document` text,
	`collected_at` text,
	`reliability_rating` real,
	`tags` text,
	`embedding` text
);
--> statement-breakpoint
CREATE TABLE `funder_filings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`funder_id` text NOT NULL,
	`tax_year` integer NOT NULL,
	`filing_type` text NOT NULL,
	`source_url` text NOT NULL,
	`parsed_status` text NOT NULL,
	`grants_count` integer,
	`grants_total_amount` real,
	`top_geographies` text,
	`top_categories` text,
	`snapshot_path` text
);
--> statement-breakpoint
CREATE TABLE `funders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`ein` text,
	`website` text,
	`program_officer` text,
	`giving_summary` text,
	`average_grant` real,
	`median_grant` real,
	`grant_range` text,
	`geographic_focus` text,
	`typical_org_budget_size` text,
	`grant_dna_top_terms` text,
	`relationship_history` text,
	`tone_notes` text,
	`priority_signals` text,
	`narrative_style` text,
	`last_researched_at` text
);
--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`funder_id` text NOT NULL,
	`opportunity_id` text,
	`feedback_text` text NOT NULL,
	`themes` text,
	`recommendations` text,
	`applies_next_cycle` integer
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`funder_id` text NOT NULL,
	`title` text NOT NULL,
	`cycle_year` integer,
	`amount_requested` real,
	`award_range` text,
	`deadline` text,
	`submission_method` text,
	`portal_url` text,
	`status` text NOT NULL,
	`fit_score` real,
	`pursue_decision` text,
	`rationale` text,
	`evidence_coverage_percent` real,
	`effort_estimate_hours` real,
	`capacity_flag` text,
	`owner` text,
	`reviewer` text,
	`reporting_burden_score` real
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`legal_name` text NOT NULL,
	`dba_name` text,
	`ein` text NOT NULL,
	`founded_year` integer,
	`mission` text NOT NULL,
	`vision` text,
	`annual_budget` real,
	`staff_count` integer,
	`volunteer_count` integer,
	`executive_director` text,
	`grants_contact` text,
	`board_chair` text,
	`address` text,
	`website` text,
	`phone` text,
	`service_area` text,
	`program_summary` text
);
--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`target_population` text,
	`geography` text,
	`theory_of_change` text,
	`start_date` text,
	`status` text,
	`key_outcomes` text,
	`program_budget` real,
	`program_lead` text,
	`funding_history` text
);
--> statement-breakpoint
CREATE TABLE `reporting_calendar` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`report_name` text NOT NULL,
	`due_date` text NOT NULL,
	`reporting_period` text,
	`status` text NOT NULL,
	`required_metrics` text,
	`owner` text,
	`template_link` text
);
--> statement-breakpoint
CREATE TABLE `requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`question_text` text NOT NULL,
	`requirement_type` text,
	`word_limit` integer,
	`character_limit` integer,
	`coverage_status` text NOT NULL,
	`linked_evidence_ids` text,
	`draft_answer_id` text,
	`reviewer_notes` text,
	`approval_status` text
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`draft_answer_id` text,
	`review_type` text NOT NULL,
	`reviewer` text NOT NULL,
	`status` text NOT NULL,
	`reviewer_notes` text,
	`approved_at` text
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`content_hash` text NOT NULL,
	`local_path` text NOT NULL,
	`parsed_metadata` text
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`submitted_at` text,
	`method` text,
	`portal_reference` text,
	`documents_included` text,
	`narratives_included` text,
	`budget_included` integer
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`opportunity_id` text,
	`requirement_id` text,
	`description` text NOT NULL,
	`priority` text NOT NULL,
	`assignee` text,
	`due_date` text,
	`status` text NOT NULL,
	`blocking_dependency` text
);
