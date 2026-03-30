CREATE TABLE "agent_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"run_id" text NOT NULL,
	"agent_name" text NOT NULL,
	"action_description" text NOT NULL,
	"source_url" text,
	"confidence_level" double precision,
	"output_summary" text,
	"follow_up_required" boolean
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"provider" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"expires_at" text
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"program_id" text,
	"name" text NOT NULL,
	"fiscal_year" integer,
	"budget_type" text NOT NULL,
	"line_items" text,
	"total_revenue" double precision,
	"total_expense" double precision,
	"restricted_vs_unrestricted" text
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"document_type" text NOT NULL,
	"file_link" text,
	"file_url" text,
	"storage_provider" text,
	"storage_key" text,
	"upload_status" text NOT NULL,
	"expiration_date" text,
	"owner" text,
	"last_verified_at" text,
	"required_by_opportunity_ids" text
);
--> statement-breakpoint
CREATE TABLE "draft_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"draft_text" text NOT NULL,
	"word_count" integer,
	"evidence_citations" text,
	"unsupported_claims" text,
	"status" text NOT NULL,
	"reviewer_comments" text,
	"revision_notes" text,
	"dna_match_score" double precision
);
--> statement-breakpoint
CREATE TABLE "evidence_library" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"program_id" text,
	"title" text NOT NULL,
	"evidence_type" text NOT NULL,
	"content" text NOT NULL,
	"source_document" text,
	"collected_at" text,
	"reliability_rating" double precision,
	"tags" text,
	"embedding" text
);
--> statement-breakpoint
CREATE TABLE "funder_filings" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"funder_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"filing_type" text NOT NULL,
	"source_url" text NOT NULL,
	"parsed_status" text NOT NULL,
	"grants_count" integer,
	"grants_total_amount" double precision,
	"top_geographies" text,
	"top_categories" text,
	"snapshot_path" text
);
--> statement-breakpoint
CREATE TABLE "funder_grant_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"funder_id" text NOT NULL,
	"filing_id" text NOT NULL,
	"tax_year" integer NOT NULL,
	"recipient_name" text NOT NULL,
	"recipient_city" text,
	"recipient_state" text,
	"recipient_ein" text,
	"grant_amount" double precision,
	"purpose" text,
	"raw_text" text,
	"extraction_method" text NOT NULL,
	"confidence" double precision
);
--> statement-breakpoint
CREATE TABLE "funders" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"name" text NOT NULL,
	"ein" text,
	"website" text,
	"program_officer" text,
	"giving_summary" text,
	"average_grant" double precision,
	"median_grant" double precision,
	"grant_range" text,
	"geographic_focus" text,
	"typical_org_budget_size" text,
	"grant_dna_top_terms" text,
	"relationship_history" text,
	"tone_notes" text,
	"priority_signals" text,
	"narrative_style" text,
	"last_researched_at" text
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"funder_id" text NOT NULL,
	"opportunity_id" text,
	"feedback_text" text NOT NULL,
	"themes" text,
	"recommendations" text,
	"applies_next_cycle" boolean
);
--> statement-breakpoint
CREATE TABLE "notion_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"access_token" text,
	"workspace_id" text,
	"workspace_name" text,
	"bot_id" text,
	"connected_at" text NOT NULL,
	"disconnected_at" text
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"funder_id" text NOT NULL,
	"title" text NOT NULL,
	"cycle_year" integer,
	"amount_requested" double precision,
	"award_range" text,
	"deadline" text,
	"submission_method" text,
	"source_url" text,
	"portal_url" text,
	"portal_discovered_at" text,
	"status" text NOT NULL,
	"fit_score" double precision,
	"pursue_decision" text,
	"rationale" text,
	"evidence_coverage_percent" double precision,
	"effort_estimate_hours" double precision,
	"capacity_flag" text,
	"owner" text,
	"reviewer" text,
	"reporting_burden_score" double precision
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"clerk_user_id" text,
	"legal_name" text NOT NULL,
	"dba_name" text,
	"ein" text NOT NULL,
	"founded_year" integer,
	"mission" text NOT NULL,
	"vision" text,
	"annual_budget" double precision,
	"staff_count" integer,
	"volunteer_count" integer,
	"executive_director" text,
	"grants_contact" text,
	"board_chair" text,
	"address" text,
	"website" text,
	"phone" text,
	"service_area" text,
	"program_summary" text,
	"onboarding_completed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_field_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"portal_host" text NOT NULL,
	"portal_path" text NOT NULL,
	"portal_url" text NOT NULL,
	"normalized_label" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text NOT NULL,
	"tag_name" text NOT NULL,
	"input_type" text NOT NULL,
	"occurrence_index" integer NOT NULL,
	"placeholder_sample" text,
	"aria_label_sample" text,
	"times_seen" integer NOT NULL,
	"times_matched" integer NOT NULL,
	"last_seen_at" text NOT NULL,
	"last_matched_at" text,
	"last_mapped_field_label" text,
	"last_fill_action" text,
	"last_confidence" double precision
);
--> statement-breakpoint
CREATE TABLE "portal_form_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"submission_session_id" text,
	"opportunity_id" text,
	"portal_url" text NOT NULL,
	"portal_host" text NOT NULL,
	"portal_path" text NOT NULL,
	"field_count" integer NOT NULL,
	"capture_source" text NOT NULL,
	"field_inventory" text NOT NULL,
	"captured_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"target_population" text,
	"geography" text,
	"theory_of_change" text,
	"start_date" text,
	"status" text,
	"key_outcomes" text,
	"program_budget" double precision,
	"program_lead" text,
	"funding_history" text
);
--> statement-breakpoint
CREATE TABLE "reporting_calendar" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"opportunity_id" text NOT NULL,
	"report_name" text NOT NULL,
	"due_date" text NOT NULL,
	"reporting_period" text,
	"status" text NOT NULL,
	"required_metrics" text,
	"owner" text,
	"template_link" text
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"question_text" text NOT NULL,
	"requirement_type" text,
	"word_limit" integer,
	"character_limit" integer,
	"coverage_status" text NOT NULL,
	"linked_evidence_ids" text,
	"draft_answer_id" text,
	"reviewer_notes" text,
	"approval_status" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"draft_answer_id" text,
	"review_type" text NOT NULL,
	"reviewer" text NOT NULL,
	"status" text NOT NULL,
	"reviewer_notes" text,
	"approved_at" text
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"local_path" text NOT NULL,
	"parsed_metadata" text
);
--> statement-breakpoint
CREATE TABLE "submission_field_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"submission_session_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"requirement_id" text,
	"field_label" text NOT NULL,
	"field_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_record_id" text,
	"fill_action" text NOT NULL,
	"mapping_status" text NOT NULL,
	"planned_value" text,
	"artifact_title" text,
	"matched_portal_label" text,
	"confidence" double precision,
	"needs_human_review" boolean NOT NULL,
	"notes" text,
	"last_attempted_at" text
);
--> statement-breakpoint
CREATE TABLE "submission_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"opportunity_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"adapter_key" text,
	"status" text NOT NULL,
	"launch_mode" text NOT NULL,
	"portal_url" text NOT NULL,
	"launch_command" text,
	"storage_state_path" text,
	"launch_requested_at" text NOT NULL,
	"launch_triggered_at" text,
	"final_submit_authorized" boolean DEFAULT false NOT NULL,
	"final_submit_authorized_at" text,
	"reviewer_name" text,
	"reviewer_notes" text
);
--> statement-breakpoint
CREATE TABLE "submission_upload_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"submission_session_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_record_id" text,
	"artifact_title" text NOT NULL,
	"file_name" text,
	"mime_type" text,
	"original_path" text,
	"staged_path" text,
	"staging_status" text NOT NULL,
	"byte_size" integer,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"organization_id" text,
	"opportunity_id" text NOT NULL,
	"submitted_at" text,
	"method" text,
	"adapter_key" text,
	"portal_reference" text,
	"documents_included" text,
	"narratives_included" text,
	"budget_included" boolean
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"opportunity_id" text,
	"requirement_id" text,
	"description" text NOT NULL,
	"priority" text NOT NULL,
	"assignee" text,
	"due_date" text,
	"status" text NOT NULL,
	"blocking_dependency" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notion_connections_clerk_user_id_unique" ON "notion_connections" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_field_profiles_scope_unique" ON "portal_field_profiles" USING btree ("organization_id","portal_host","portal_path","normalized_label","field_type","occurrence_index");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_opportunity_id_unique" ON "submissions" USING btree ("opportunity_id");