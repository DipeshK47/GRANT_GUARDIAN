import { randomUUID } from "node:crypto";
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const baseColumns = {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
};

export const organizations = pgTable(
  "organizations",
  {
    ...baseColumns,
    clerkUserId: text("clerk_user_id"),
    legalName: text("legal_name").notNull(),
    dbaName: text("dba_name"),
    ein: text("ein").notNull(),
    foundedYear: integer("founded_year"),
    mission: text("mission").notNull(),
    vision: text("vision"),
    annualBudget: doublePrecision("annual_budget"),
    staffCount: integer("staff_count"),
    volunteerCount: integer("volunteer_count"),
    executiveDirector: text("executive_director"),
    grantsContact: text("grants_contact"),
    boardChair: text("board_chair"),
    address: text("address"),
    website: text("website"),
    phone: text("phone"),
    serviceArea: text("service_area"),
    programSummary: text("program_summary"),
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  },
  () => ({}),
);

export const programs = pgTable("programs", {
  ...baseColumns,
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  targetPopulation: text("target_population"),
  geography: text("geography"),
  theoryOfChange: text("theory_of_change"),
  startDate: text("start_date"),
  status: text("status"),
  keyOutcomes: text("key_outcomes"),
  programBudget: doublePrecision("program_budget"),
  programLead: text("program_lead"),
  fundingHistory: text("funding_history"),
});

export const funders = pgTable("funders", {
  ...baseColumns,
  name: text("name").notNull(),
  ein: text("ein"),
  website: text("website"),
  programOfficer: text("program_officer"),
  givingSummary: text("giving_summary"),
  averageGrant: doublePrecision("average_grant"),
  medianGrant: doublePrecision("median_grant"),
  grantRange: text("grant_range"),
  geographicFocus: text("geographic_focus"),
  typicalOrgBudgetSize: text("typical_org_budget_size"),
  grantDnaTopTerms: text("grant_dna_top_terms"),
  relationshipHistory: text("relationship_history"),
  toneNotes: text("tone_notes"),
  prioritySignals: text("priority_signals"),
  narrativeStyle: text("narrative_style"),
  lastResearchedAt: text("last_researched_at"),
});

export const funderFilings = pgTable("funder_filings", {
  ...baseColumns,
  funderId: text("funder_id").notNull(),
  taxYear: integer("tax_year").notNull(),
  filingType: text("filing_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  parsedStatus: text("parsed_status").notNull(),
  grantsCount: integer("grants_count"),
  grantsTotalAmount: doublePrecision("grants_total_amount"),
  topGeographies: text("top_geographies"),
  topCategories: text("top_categories"),
  snapshotPath: text("snapshot_path"),
});

export const funderGrantRows = pgTable("funder_grant_rows", {
  ...baseColumns,
  funderId: text("funder_id").notNull(),
  filingId: text("filing_id").notNull(),
  taxYear: integer("tax_year").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientCity: text("recipient_city"),
  recipientState: text("recipient_state"),
  recipientEin: text("recipient_ein"),
  grantAmount: doublePrecision("grant_amount"),
  purpose: text("purpose"),
  rawText: text("raw_text"),
  extractionMethod: text("extraction_method").notNull(),
  confidence: doublePrecision("confidence"),
});

export const opportunities = pgTable("opportunities", {
  ...baseColumns,
  organizationId: text("organization_id"),
  funderId: text("funder_id").notNull(),
  title: text("title").notNull(),
  cycleYear: integer("cycle_year"),
  amountRequested: doublePrecision("amount_requested"),
  awardRange: text("award_range"),
  deadline: text("deadline"),
  submissionMethod: text("submission_method"),
  sourceUrl: text("source_url"),
  portalUrl: text("portal_url"),
  portalDiscoveredAt: text("portal_discovered_at"),
  status: text("status").notNull(),
  fitScore: doublePrecision("fit_score"),
  pursueDecision: text("pursue_decision"),
  rationale: text("rationale"),
  evidenceCoveragePercent: doublePrecision("evidence_coverage_percent"),
  effortEstimateHours: doublePrecision("effort_estimate_hours"),
  capacityFlag: text("capacity_flag"),
  owner: text("owner"),
  reviewer: text("reviewer"),
  reportingBurdenScore: doublePrecision("reporting_burden_score"),
});

export const requirements = pgTable("requirements", {
  ...baseColumns,
  opportunityId: text("opportunity_id").notNull(),
  questionText: text("question_text").notNull(),
  requirementType: text("requirement_type"),
  wordLimit: integer("word_limit"),
  characterLimit: integer("character_limit"),
  coverageStatus: text("coverage_status").notNull(),
  linkedEvidenceIds: text("linked_evidence_ids"),
  draftAnswerId: text("draft_answer_id"),
  reviewerNotes: text("reviewer_notes"),
  approvalStatus: text("approval_status"),
});

export const evidenceLibrary = pgTable("evidence_library", {
  ...baseColumns,
  programId: text("program_id"),
  title: text("title").notNull(),
  evidenceType: text("evidence_type").notNull(),
  content: text("content").notNull(),
  sourceDocument: text("source_document"),
  collectedAt: text("collected_at"),
  reliabilityRating: doublePrecision("reliability_rating"),
  tags: text("tags"),
  embedding: text("embedding"),
});

export const documents = pgTable("documents", {
  ...baseColumns,
  organizationId: text("organization_id"),
  name: text("name").notNull(),
  documentType: text("document_type").notNull(),
  fileLink: text("file_link"),
  fileUrl: text("file_url"),
  storageProvider: text("storage_provider"),
  storageKey: text("storage_key"),
  uploadStatus: text("upload_status").notNull(),
  expirationDate: text("expiration_date"),
  owner: text("owner"),
  lastVerifiedAt: text("last_verified_at"),
  requiredByOpportunityIds: text("required_by_opportunity_ids"),
});

export const budgets = pgTable("budgets", {
  ...baseColumns,
  programId: text("program_id"),
  name: text("name").notNull(),
  fiscalYear: integer("fiscal_year"),
  budgetType: text("budget_type").notNull(),
  lineItems: text("line_items"),
  totalRevenue: doublePrecision("total_revenue"),
  totalExpense: doublePrecision("total_expense"),
  restrictedVsUnrestricted: text("restricted_vs_unrestricted"),
});

export const draftAnswers = pgTable("draft_answers", {
  ...baseColumns,
  opportunityId: text("opportunity_id").notNull(),
  requirementId: text("requirement_id").notNull(),
  draftText: text("draft_text").notNull(),
  wordCount: integer("word_count"),
  evidenceCitations: text("evidence_citations"),
  unsupportedClaims: text("unsupported_claims"),
  status: text("status").notNull(),
  reviewerComments: text("reviewer_comments"),
  revisionNotes: text("revision_notes"),
  dnaMatchScore: doublePrecision("dna_match_score"),
});

export const tasks = pgTable("tasks", {
  ...baseColumns,
  opportunityId: text("opportunity_id"),
  requirementId: text("requirement_id"),
  description: text("description").notNull(),
  priority: text("priority").notNull(),
  assignee: text("assignee"),
  dueDate: text("due_date"),
  status: text("status").notNull(),
  blockingDependency: text("blocking_dependency"),
});

export const reviews = pgTable("reviews", {
  ...baseColumns,
  opportunityId: text("opportunity_id").notNull(),
  draftAnswerId: text("draft_answer_id"),
  reviewType: text("review_type").notNull(),
  reviewer: text("reviewer").notNull(),
  status: text("status").notNull(),
  reviewerNotes: text("reviewer_notes"),
  approvedAt: text("approved_at"),
});

export const submissions = pgTable(
  "submissions",
  {
    ...baseColumns,
    organizationId: text("organization_id"),
    opportunityId: text("opportunity_id").notNull(),
    submittedAt: text("submitted_at"),
    method: text("method"),
    adapterKey: text("adapter_key"),
    portalReference: text("portal_reference"),
    documentsIncluded: text("documents_included"),
    narrativesIncluded: text("narratives_included"),
    budgetIncluded: boolean("budget_included"),
  },
  (table) => ({
    opportunityIdUniqueIdx: uniqueIndex("submissions_opportunity_id_unique").on(
      table.opportunityId,
    ),
  }),
);

export const submissionSessions = pgTable("submission_sessions", {
  ...baseColumns,
  organizationId: text("organization_id"),
  opportunityId: text("opportunity_id").notNull(),
  submissionId: text("submission_id").notNull(),
  adapterKey: text("adapter_key"),
  status: text("status").notNull(),
  launchMode: text("launch_mode").notNull(),
  portalUrl: text("portal_url").notNull(),
  launchCommand: text("launch_command"),
  storageStatePath: text("storage_state_path"),
  launchRequestedAt: text("launch_requested_at").notNull(),
  launchTriggeredAt: text("launch_triggered_at"),
  finalSubmitAuthorized: boolean("final_submit_authorized").notNull().default(false),
  finalSubmitAuthorizedAt: text("final_submit_authorized_at"),
  reviewerName: text("reviewer_name"),
  reviewerNotes: text("reviewer_notes"),
});

export const submissionFieldMappings = pgTable("submission_field_mappings", {
  ...baseColumns,
  organizationId: text("organization_id"),
  submissionSessionId: text("submission_session_id").notNull(),
  submissionId: text("submission_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  requirementId: text("requirement_id"),
  fieldLabel: text("field_label").notNull(),
  fieldType: text("field_type").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceRecordId: text("source_record_id"),
  fillAction: text("fill_action").notNull(),
  mappingStatus: text("mapping_status").notNull(),
  plannedValue: text("planned_value"),
  artifactTitle: text("artifact_title"),
  matchedPortalLabel: text("matched_portal_label"),
  confidence: doublePrecision("confidence"),
  needsHumanReview: boolean("needs_human_review").notNull(),
  notes: text("notes"),
  lastAttemptedAt: text("last_attempted_at"),
});

export const submissionUploadArtifacts = pgTable("submission_upload_artifacts", {
  ...baseColumns,
  organizationId: text("organization_id"),
  submissionSessionId: text("submission_session_id").notNull(),
  submissionId: text("submission_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  requirementId: text("requirement_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceRecordId: text("source_record_id"),
  artifactTitle: text("artifact_title").notNull(),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  originalPath: text("original_path"),
  stagedPath: text("staged_path"),
  stagingStatus: text("staging_status").notNull(),
  byteSize: integer("byte_size"),
  notes: text("notes"),
});

export const portalFormSnapshots = pgTable("portal_form_snapshots", {
  ...baseColumns,
  organizationId: text("organization_id"),
  submissionSessionId: text("submission_session_id"),
  opportunityId: text("opportunity_id"),
  portalUrl: text("portal_url").notNull(),
  portalHost: text("portal_host").notNull(),
  portalPath: text("portal_path").notNull(),
  fieldCount: integer("field_count").notNull(),
  captureSource: text("capture_source").notNull(),
  fieldInventory: text("field_inventory").notNull(),
  capturedAt: text("captured_at").notNull(),
});

export const portalFieldProfiles = pgTable(
  "portal_field_profiles",
  {
    ...baseColumns,
    organizationId: text("organization_id"),
    portalHost: text("portal_host").notNull(),
    portalPath: text("portal_path").notNull(),
    portalUrl: text("portal_url").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    fieldLabel: text("field_label").notNull(),
    fieldType: text("field_type").notNull(),
    tagName: text("tag_name").notNull(),
    inputType: text("input_type").notNull(),
    occurrenceIndex: integer("occurrence_index").notNull(),
    placeholderSample: text("placeholder_sample"),
    ariaLabelSample: text("aria_label_sample"),
    timesSeen: integer("times_seen").notNull(),
    timesMatched: integer("times_matched").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    lastMatchedAt: text("last_matched_at"),
    lastMappedFieldLabel: text("last_mapped_field_label"),
    lastFillAction: text("last_fill_action"),
    lastConfidence: doublePrecision("last_confidence"),
  },
  (table) => ({
    portalFieldProfileUniqueIdx: uniqueIndex("portal_field_profiles_scope_unique").on(
      table.organizationId,
      table.portalHost,
      table.portalPath,
      table.normalizedLabel,
      table.fieldType,
      table.occurrenceIndex,
    ),
  }),
);

export const reportingCalendar = pgTable("reporting_calendar", {
  ...baseColumns,
  organizationId: text("organization_id"),
  opportunityId: text("opportunity_id").notNull(),
  reportName: text("report_name").notNull(),
  dueDate: text("due_date").notNull(),
  reportingPeriod: text("reporting_period"),
  status: text("status").notNull(),
  requiredMetrics: text("required_metrics"),
  owner: text("owner"),
  templateLink: text("template_link"),
});

export const lessons = pgTable("lessons", {
  ...baseColumns,
  organizationId: text("organization_id"),
  funderId: text("funder_id").notNull(),
  opportunityId: text("opportunity_id"),
  feedbackText: text("feedback_text").notNull(),
  themes: text("themes"),
  recommendations: text("recommendations"),
  appliesNextCycle: boolean("applies_next_cycle"),
});

export const agentLogs = pgTable("agent_logs", {
  ...baseColumns,
  runId: text("run_id").notNull(),
  agentName: text("agent_name").notNull(),
  actionDescription: text("action_description").notNull(),
  sourceUrl: text("source_url"),
  confidenceLevel: doublePrecision("confidence_level"),
  outputSummary: text("output_summary"),
  followUpRequired: boolean("follow_up_required"),
});

export const authTokens = pgTable("auth_tokens", {
  ...baseColumns,
  provider: text("provider").notNull(),
  accountId: text("account_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: text("expires_at"),
});

export const notionConnections = pgTable(
  "notion_connections",
  {
    ...baseColumns,
    clerkUserId: text("clerk_user_id").notNull(),
    accessToken: text("access_token"),
    workspaceId: text("workspace_id"),
    workspaceName: text("workspace_name"),
    botId: text("bot_id"),
    connectedAt: text("connected_at").notNull(),
    disconnectedAt: text("disconnected_at"),
  },
  (table) => ({
    notionConnectionsClerkUserIdUniqueIdx: uniqueIndex("notion_connections_clerk_user_id_unique").on(
      table.clerkUserId,
    ),
  }),
);

export const sourceSnapshots = pgTable("source_snapshots", {
  ...baseColumns,
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  contentHash: text("content_hash").notNull(),
  localPath: text("local_path").notNull(),
  parsedMetadata: text("parsed_metadata"),
});
