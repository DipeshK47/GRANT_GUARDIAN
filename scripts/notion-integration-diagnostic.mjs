import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { desc, eq, isNull } from "drizzle-orm";
import { env } from "../apps/orchestrator/dist/config/env.js";
import { db } from "../apps/orchestrator/dist/db/client.js";
import {
  agentLogs,
  draftAnswers,
  evidenceLibrary,
  funders,
  lessons,
  notionConnections,
  opportunities,
  organizations,
  programs,
  reportingCalendar,
  requirements,
} from "../apps/orchestrator/dist/db/schema.js";
import { withRequestContext } from "../apps/orchestrator/dist/lib/request-context.js";
import { NotionMcpClient, NotionAuthorizationError } from "../apps/orchestrator/dist/services/notion/client.js";
import { OrganizationProfileService } from "../apps/orchestrator/dist/services/organizations/profile.js";
import { notionWorkspaceDatabases } from "../apps/orchestrator/dist/services/notion/workspace-schema.js";
import { WorkspaceContextService } from "../apps/orchestrator/dist/services/workspace/context.js";

const CURRENT_TIMESTAMP = new Date().toISOString();
const OUTPUT_DIR = resolve(process.cwd(), "data/notion/diagnostics");
const OUTPUT_FILE = resolve(OUTPUT_DIR, "notion-integration-test-report.txt");

const TEST_DATA = {
  organization: {
    legalName: "Bridgelight Youth Foundation",
    ein: "47-2381956",
    mission:
      "Bridgelight Youth Foundation provides after-school academic coaching, mentorship, and family navigation services to low-income students in grades 6 through 12 across underserved communities in the Chicago metropolitan area. We partner with public schools, community health centers, and local employers to ensure every young person we serve has a clear path from middle school through post-secondary success. Since 2014, we have served over 2,400 students and maintained an 84% high school graduation rate among program participants, compared to a 61% district average.",
    annualBudget: 480000,
    staffCount: 8,
    foundedYear: 2014,
    executiveDirector: "Maya Patel",
    address: "1847 W. Cermak Road, Chicago, IL 60608",
    serviceArea: "Chicago, Cook County, Illinois",
    programSummary:
      "After-school coaching, Mentorship, Family navigation, Post-secondary pathways",
  },
  program: {
    name: "Academic Acceleration Program",
    targetPopulation: "Low-income students grades 6-12, Chicago metro",
    geography: "Cook County, Illinois",
    goals: "Improve academic performance and high school graduation rates",
    outcomes:
      "84% graduation rate among participants vs 61% district average; 91% of seniors accepted to post-secondary program",
    metrics:
      "Students served per year, graduation rate, post-secondary acceptance rate, average GPA improvement",
    annualCost: 180000,
    programLead: "James Okafor",
    strategicPriority: "High",
  },
  funders: [
    {
      name: "A Better Chicago",
      website: "https://abetterchicago.org",
      foundationType: "Private foundation",
      issueAreas: "Youth education, Economic mobility, Workforce development",
      geographicFocus: ["Chicago", "Illinois"],
      averageGrant: 100000,
      smallOrgFriendliness: "High",
      notes: "Multi-year grants available, LOI-based process",
      givingSummary:
        "Private foundation focused on youth education, economic mobility, and workforce development in Chicago, Illinois. Multi-year grants available and the process is LOI-based.",
      medianGrant: 100000,
      grantDnaTopTerms: "community-led; systems change; outcomes; economic mobility",
    },
    {
      name: "T-Mobile Hometown Grant Program",
      website: "https://www.t-mobile.com/community/hometown-grants",
      foundationType: "Corporate foundation",
      issueAreas: "Community spaces, Infrastructure, Small towns",
      geographicFocus: ["Towns under 50,000 population", "USA"],
      averageGrant: 50000,
      smallOrgFriendliness: "Medium",
      notes:
        "Requires physical infrastructure project, towns under 50k population only",
      givingSummary:
        "Corporate foundation program centered on community spaces, infrastructure, and small towns across the USA. Requires a physical infrastructure project and towns under 50,000 population.",
      medianGrant: 50000,
      grantDnaTopTerms: "infrastructure; main street; community spaces; rural",
    },
  ],
  opportunity: {
    title: "A Better Chicago 2026 General Operating Grant",
    status: "Researching",
    deadline: "2026-06-30",
    submissionPlatform: "Email / Direct application",
    sourceUrl: "https://abetterchicago.org/grantee-application",
    fitScore: 82,
    evidenceCoveragePercent: 74,
    effortHours: 12,
    reportingBurdenScore: 3,
    priorityScore: 79,
    pursueDecision: "Pursue",
    nextBestAction: "Run evidence mapping and begin drafting",
  },
  requirements: [
    {
      questionText:
        "Describe your organization's mission and the primary population you serve.",
      type: "Narrative",
      required: true,
      wordLimit: 300,
      coverageStatus: "Green",
      riskFlag: "None",
      riskLevel: "Low",
      reviewerNotes: "None",
    },
    {
      questionText:
        "What specific outcomes will you track and how will you measure them?",
      type: "Narrative",
      required: true,
      wordLimit: 400,
      coverageStatus: "Amber",
      riskFlag: "Evaluation methodology needs strengthening",
      riskLevel: "Medium",
      reviewerNotes: "Evaluation methodology needs strengthening",
    },
    {
      questionText: "Provide your most recent audited financials or Form 990.",
      type: "Document upload",
      required: true,
      wordLimit: null,
      coverageStatus: "Red",
      riskFlag: "Document not yet uploaded",
      riskLevel: "High",
      reviewerNotes: "Document not yet uploaded",
    },
  ],
  evidence: {
    title: "2024 Annual Program Outcomes Report",
    type: "Outcomes data",
    summary:
      "Documents 84% high school graduation rate among 312 participants in 2024, compared to 61% district average. Includes GPA improvement data, post-secondary acceptance rates, and family satisfaction survey results.",
    metrics:
      "Graduation rate 84%, Post-secondary acceptance 91%, Average GPA improvement 0.6 points, Families served 280",
    geography: "Cook County, Illinois",
    date: "2024-12-01",
    qualityScore: 9,
    reusabilityScore: "High",
    tags: "Outcomes, Graduation, Post-secondary, Chicago, Youth",
  },
  draft: {
    draftText:
      "Bridgelight Youth Foundation provides after-school academic coaching, mentorship, and family navigation services to low-income students in grades 6 through 12 across underserved communities in the Chicago metropolitan area. Since 2014, we have served over 2,400 students and maintained an 84% high school graduation rate among program participants — 23 percentage points above the district average. Our model is designed for young people who face the greatest structural barriers to post-secondary success, and every service we provide is built around their specific academic, social, and family needs.",
    groundingRefs: "2024 Annual Program Outcomes Report",
    dnaMatchScore: 78,
    approvalStatus: "Draft",
    reviewerNotes:
      "Strong opening. Consider adding more community-led language to align with A Better Chicago's framing priorities.",
  },
  agentLog: {
    runId: "test-run-001",
    agent: "Funder Intelligence Agent",
    action: "enrichFunder",
    source: "ProPublica Nonprofit Explorer + abetterchicago.org",
    outputSummary:
      "Retrieved 3 years of giving history. Average grant size $100,000. Geographic focus confirmed as Chicago metro. Small-org friendliness scored High based on 68% of grants going to orgs with budgets under $500,000.",
    confidence: "High",
    followUpNeeded: false,
  },
  lesson: {
    title: "T-Mobile Hometown Grant 2025 rejection lesson",
    opportunityTitle: "T-Mobile Hometown Grant 2025",
    result: "Rejected",
    feedbackText:
      "Application was declined because the organization is located in Chicago, a city well above the 50,000 population threshold required for the Hometown Grants program. Additionally the grant requires a physical infrastructure project and Bridgelight's programming work does not qualify.",
    extractedThemes:
      "Geography mismatch, Eligibility failure, Program type mismatch",
    recommendations:
      "Do not apply to T-Mobile Hometown Grants in future cycles. Flag any future corporate grants that require small-town geography or physical infrastructure projects as auto-Skip for Bridgelight.",
    appliedNextCycle: false,
  },
  reporting: {
    reportType: "Interim progress report",
    dueDate: "2026-12-31",
    requiredMetrics:
      "Students served, Graduation rate, GPA improvement, Family satisfaction score",
    owner: "Maya Patel",
    status: "Not started",
  },
};

const EXPECTED_DATABASE_NAMES = [
  "Organization",
  "Programs",
  "Funders",
  "Funder Filings",
  "Opportunities",
  "Requirements",
  "Evidence Library",
  "Documents",
  "Budgets",
  "Draft Answers",
  "Tasks",
  "Reviews / Approvals",
  "Submissions",
  "Reporting Calendar",
  "Lessons / Rejections",
  "Agent Logs",
];

const normalizeText = (value) =>
  (value ?? "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
const normalizeUrl = (value) => normalizeText(value).replace(/\/+$/, "");
const normalizeArray = (value) =>
  Array.isArray(value)
    ? value.map((item) => normalizeText(item).toLowerCase()).filter(Boolean)
    : [];

const textListToString = (segments = []) =>
  segments.map((segment) => segment?.plain_text ?? "").join("").trim();

const readTitle = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return property?.title ? textListToString(property.title) : null;
};

const readRichText = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return property?.rich_text ? textListToString(property.rich_text) : null;
};

const readNumber = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return typeof property?.number?.value === "number"
    ? property.number.value
    : typeof property?.number === "number"
      ? property.number
      : property?.number ?? null;
};

const readDate = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return property?.date?.start ?? property?.date ?? null;
};

const readSelect = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return property?.select?.name ?? null;
};

const readMultiSelect = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return Array.isArray(property?.multi_select)
    ? property.multi_select.map((item) => item?.name ?? "").filter(Boolean)
    : [];
};

const readCheckbox = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return typeof property?.checkbox === "boolean" ? property.checkbox : null;
};

const readRelationIds = (page, propertyName) => {
  const property = page?.properties?.[propertyName];
  return Array.isArray(property?.relation)
    ? property.relation.map((entry) => entry?.id ?? "").filter(Boolean)
    : [];
};

const findPropertyType = (dataSource, propertyName) =>
  dataSource?.properties?.[propertyName]?.type ?? null;

const nowIso = () => new Date().toISOString();

const slugify = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "record";

const exactMatch = (expected, actual) =>
  normalizeText(expected) === normalizeText(actual);

const sameArray = (expected, actual) => {
  const left = normalizeArray(expected).sort();
  const right = normalizeArray(actual).sort();
  return JSON.stringify(left) === JSON.stringify(right);
};

const createLogger = () => ({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

const expectedCodeSchema = new Map(
  notionWorkspaceDatabases
    .filter((database) => EXPECTED_DATABASE_NAMES.includes(database.name))
    .map((database) => [database.name, database]),
);

const resultToStatus = (passed) => (passed ? "PASS" : "FAIL");

const fieldResult = (testKey, field, expected, actual, passed, note) => ({
  testKey,
  field,
  expected,
  actual,
  passed,
  note: note ?? null,
});

const relationResult = (field, passed, note) => ({
  field,
  passed,
  note,
});

const countPasses = (results) => results.filter((result) => result.passed).length;

const formatValue = (value) => {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

const parseArgs = (argv) => {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith("--clerk-user-id=")) {
      parsed.clerkUserId = arg.replace("--clerk-user-id=", "").trim();
    }
  }
  return parsed;
};

const getCurrentConnection = async (explicitClerkUserId) => {
  if (explicitClerkUserId) {
    const [connection] = await db
      .select()
      .from(notionConnections)
      .where(eq(notionConnections.clerkUserId, explicitClerkUserId))
      .limit(1);
    if (!connection) {
      throw new Error(`No notion connection found for clerk user ${explicitClerkUserId}.`);
    }
    return connection;
  }

  const [connection] = await db
    .select()
    .from(notionConnections)
    .where(isNull(notionConnections.disconnectedAt))
    .orderBy(desc(notionConnections.updatedAt), desc(notionConnections.connectedAt))
    .limit(1);

  if (!connection?.clerkUserId) {
    throw new Error("No active Notion connection was found.");
  }

  return connection;
};

const upsertFunder = async (input) => {
  const [existing] = await db.select().from(funders).where(eq(funders.name, input.name)).limit(1);
  const values = {
    name: input.name,
    website: input.website,
    averageGrant: input.averageGrant,
    medianGrant: input.medianGrant,
    geographicFocus: input.geographicFocus.join(", "),
    givingSummary: input.givingSummary,
    grantDnaTopTerms: input.grantDnaTopTerms,
    typicalOrgBudgetSize: input.smallOrgFriendliness,
    lastResearchedAt: nowIso(),
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(funders).set(values).where(eq(funders.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(funders).values(values).returning();
  return inserted;
};

const upsertOpportunity = async (input) => {
  const [existing] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.title, input.title))
    .limit(1);
  const values = {
    organizationId: input.organizationId,
    funderId: input.funderId,
    title: input.title,
    deadline: input.deadline,
    submissionMethod: input.submissionMethod,
    sourceUrl: input.sourceUrl,
    status: input.status,
    fitScore: input.fitScore,
    pursueDecision: input.pursueDecision,
    evidenceCoveragePercent: input.evidenceCoveragePercent,
    effortEstimateHours: input.effortEstimateHours,
    reportingBurdenScore: input.reportingBurdenScore,
    rationale: input.rationale ?? null,
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(opportunities).set(values).where(eq(opportunities.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(opportunities).values(values).returning();
  return inserted;
};

const upsertRequirement = async (input) => {
  const [existing] = await db
    .select()
    .from(requirements)
    .where(eq(requirements.questionText, input.questionText))
    .limit(1);
  const values = {
    opportunityId: input.opportunityId,
    questionText: input.questionText,
    requirementType: input.requirementType,
    wordLimit: input.wordLimit,
    coverageStatus: input.coverageStatus,
    reviewerNotes: input.reviewerNotes,
    approvalStatus: input.required ? "Required" : "Optional",
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(requirements).set(values).where(eq(requirements.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(requirements).values(values).returning();
  return inserted;
};

const upsertDraftAnswer = async (input) => {
  const [existing] = await db
    .select()
    .from(draftAnswers)
    .where(eq(draftAnswers.requirementId, input.requirementId))
    .limit(1);
  const values = {
    opportunityId: input.opportunityId,
    requirementId: input.requirementId,
    draftText: input.draftText,
    wordCount: input.wordCount,
    evidenceCitations: input.evidenceCitations,
    unsupportedClaims: input.unsupportedClaims,
    status: input.status,
    reviewerComments: input.reviewerComments,
    revisionNotes: input.revisionNotes,
    dnaMatchScore: input.dnaMatchScore,
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(draftAnswers).set(values).where(eq(draftAnswers.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(draftAnswers).values(values).returning();
  return inserted;
};

const upsertAgentLog = async (input) => {
  const [existing] = await db
    .select()
    .from(agentLogs)
    .where(eq(agentLogs.runId, input.runId))
    .limit(1);
  const values = {
    runId: input.runId,
    agentName: input.agentName,
    actionDescription: input.actionDescription,
    sourceUrl: input.sourceUrl,
    confidenceLevel: input.confidenceLevel,
    outputSummary: input.outputSummary,
    followUpRequired: input.followUpRequired,
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(agentLogs).set(values).where(eq(agentLogs.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(agentLogs).values(values).returning();
  return inserted;
};

const upsertLesson = async (input) => {
  const [existing] = await db
    .select()
    .from(lessons)
    .where(eq(lessons.feedbackText, input.feedbackText))
    .limit(1);
  const values = {
    organizationId: input.organizationId,
    funderId: input.funderId,
    opportunityId: input.opportunityId,
    feedbackText: input.feedbackText,
    themes: input.themes,
    recommendations: input.recommendations,
    appliesNextCycle: input.appliesNextCycle,
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(lessons).set(values).where(eq(lessons.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(lessons).values(values).returning();
  return inserted;
};

const upsertReportingRecord = async (input) => {
  const [existing] = await db
    .select()
    .from(reportingCalendar)
    .where(eq(reportingCalendar.reportName, input.reportName))
    .limit(1);
  const values = {
    organizationId: input.organizationId,
    opportunityId: input.opportunityId,
    reportName: input.reportName,
    dueDate: input.dueDate,
    reportingPeriod: input.reportingPeriod,
    status: input.status,
    requiredMetrics: input.requiredMetrics,
    owner: input.owner,
    templateLink: input.templateLink,
    updatedAt: nowIso(),
  };

  if (existing) {
    await db.update(reportingCalendar).set(values).where(eq(reportingCalendar.id, existing.id));
    return { ...existing, ...values };
  }

  const [inserted] = await db.insert(reportingCalendar).values(values).returning();
  return inserted;
};

const compareField = (testKey, field, expected, actual, note) =>
  fieldResult(testKey, field, expected, actual, expected === actual, note);

const compareNormalizedText = (testKey, field, expected, actual, note) =>
  fieldResult(
    testKey,
    field,
    expected,
    actual,
    exactMatch(expected, actual),
    note,
  );

const compareUrl = (testKey, field, expected, actual, note) =>
  fieldResult(
    testKey,
    field,
    expected,
    actual,
    normalizeUrl(expected) === normalizeUrl(actual),
    note,
  );

const compareArray = (testKey, field, expected, actual, note) =>
  fieldResult(testKey, field, expected, actual, sameArray(expected, actual), note);

const compareNumber = (testKey, field, expected, actual, note) =>
  fieldResult(
    testKey,
    field,
    expected,
    actual,
    typeof actual === "number" && Math.abs(expected - actual) < 0.0001,
    note,
  );

const comparePercentNumber = (testKey, field, expectedPercent, actual, note) =>
  fieldResult(
    testKey,
    field,
    `${expectedPercent}%`,
    actual,
    typeof actual === "number" && Math.abs(expectedPercent / 100 - actual) < 0.0001,
    note,
  );

const compareDateTimeClose = (testKey, field, expected, actual, toleranceMs = 60_000, note) => {
  const expectedMs = Date.parse(expected ?? "");
  const actualMs = Date.parse(actual ?? "");
  return fieldResult(
    testKey,
    field,
    expected,
    actual,
    Number.isFinite(expectedMs) &&
      Number.isFinite(actualMs) &&
      Math.abs(expectedMs - actualMs) <= toleranceMs,
    note,
  );
};

const compareMissingProperty = (testKey, field, expected, dataSource, propertyName) =>
  fieldResult(
    testKey,
    field,
    expected,
    `<missing property: ${propertyName}>`,
    false,
    `The ${dataSource.titleText} database does not define a '${propertyName}' property.`,
  );

const compareRelationTargets = async (
  testKey,
  field,
  expected,
  api,
  page,
  propertyName,
  targetTitleProperty,
  missingNote,
) => {
  const relationIds = readRelationIds(page, propertyName);
  if (relationIds.length === 0) {
    return fieldResult(testKey, field, expected, "<no relation>", false, missingNote);
  }

  const relationPages = await Promise.all(relationIds.map((id) => retrievePage(api, id)));
  const actualTitles = relationPages
    .map((entry) => readTitle(entry, targetTitleProperty) ?? readRichText(entry, targetTitleProperty))
    .filter(Boolean);

  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return fieldResult(
    testKey,
    field,
    expected,
    actualTitles.length === 1 ? actualTitles[0] : actualTitles,
    sameArray(expectedValues, actualTitles),
    sameArray(expectedValues, actualTitles) ? null : missingNote,
  );
};

const makeTestSummary = (label, results) => {
  const passed = countPasses(results);
  return {
    label,
    passed: passed === results.length,
    passedCount: passed,
    totalCount: results.length,
    results,
  };
};

const findPageByTitle = async (api, dataSourceId, titlePropertyName, title) => {
  const response = await api(`/data_sources/${dataSourceId}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 100 }),
  });

  const page =
    response.results?.find(
      (candidate) => normalizeText(readTitle(candidate, titlePropertyName)) === normalizeText(title),
    ) ?? null;

  if (!page) {
    throw new Error(`No Notion page found for ${titlePropertyName}='${title}' in data source ${dataSourceId}.`);
  }

  return page;
};

const retrievePage = async (api, pageId) => api(`/pages/${pageId}`, { method: "GET" });

const buildSchemaBaseline = (liveDataSources) => {
  const liveByName = new Map(liveDataSources.map((dataSource) => [dataSource.titleText, dataSource]));
  const baseline = [];

  for (const databaseName of EXPECTED_DATABASE_NAMES) {
    const live = liveByName.get(databaseName) ?? null;
    const expectedDefinition = expectedCodeSchema.get(databaseName) ?? null;
    const missingProperties = expectedDefinition
      ? expectedDefinition.properties
          .map((property) => property.name)
          .filter((propertyName) => !live?.properties?.[propertyName])
      : [];

    baseline.push({
      databaseName,
      exists: Boolean(live),
      databaseId: live?.databaseId ?? null,
      dataSourceId: live?.dataSourceId ?? null,
      missingProperties,
    });
  }

  const extraDatabases = liveDataSources
    .filter((dataSource) => !EXPECTED_DATABASE_NAMES.includes(dataSource.titleText))
    .map((dataSource) => ({
      databaseName: dataSource.titleText,
      databaseId: dataSource.databaseId,
      dataSourceId: dataSource.dataSourceId,
    }));

  return { baseline, extraDatabases };
};

const buildFailureLines = (summaries, relationAudit, baseline) => {
  const failures = [];

  for (const row of baseline.baseline) {
    if (!row.exists) {
      failures.push(`Missing Notion database: ${row.databaseName}`);
    }
    for (const property of row.missingProperties) {
      failures.push(
        `${row.databaseName} schema missing property '${property}' required by current code expectations.`,
      );
    }
  }

  for (const summary of summaries) {
    for (const result of summary.results) {
      if (!result.passed) {
        failures.push(
          `${summary.label} -> ${result.field}: expected ${formatValue(result.expected)}; got ${formatValue(result.actual)}${result.note ? ` (${result.note})` : ""}`,
        );
      }
    }
  }

  for (const relation of relationAudit.results) {
    if (!relation.passed) {
      failures.push(`Relation audit -> ${relation.field}: ${relation.note}`);
    }
  }

  return failures;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const connection = await getCurrentConnection(args.clerkUserId);
  const clerkUserId = connection.clerkUserId;

  await withRequestContext({ clerkUserId }, async () => {
    const notion = new NotionMcpClient(env, createLogger());
    const organizationService = new OrganizationProfileService(createLogger());
    const workspaceContextService = new WorkspaceContextService(notion, createLogger());
    await notion.bootstrapWorkspace();

    const api = async (path, init) => {
      const tokens = await notion["requireStoredTokens"]();
      const response = await notion["requestWithToken"](path, tokens.accessToken, init);
      return response.body;
    };

    const bootstrap = await notion.getBootstrapSummary();
    if (!bootstrap) {
      throw new Error("No bootstrap summary exists for the connected workspace.");
    }

    const liveSearch = await api("/search", {
      method: "POST",
      body: JSON.stringify({ filter: { property: "object", value: "data_source" }, page_size: 100 }),
    });

    const liveCurrentDataSources = (liveSearch.results ?? [])
      .filter((result) => result.database_parent?.page_id === bootstrap.rootPageId)
      .map((result) => ({
        titleText: textListToString(result.title),
        descriptionText: textListToString(result.description),
        dataSourceId: result.id,
        databaseId: result.parent?.database_id ?? null,
        properties: result.properties ?? {},
      }));

    if (liveCurrentDataSources.length === 0) {
      throw new Error("The live Notion search returned no databases under the current Grant Guardian root page.");
    }

    const baseline = buildSchemaBaseline(liveCurrentDataSources);

    const [existingOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.clerkUserId, clerkUserId))
      .orderBy(desc(organizations.updatedAt), desc(organizations.createdAt))
      .limit(1);

    const organizationResult = await organizationService.save({
      organizationId: existingOrg?.id,
      clerkUserId,
      legalName: TEST_DATA.organization.legalName,
      ein: TEST_DATA.organization.ein,
      mission: TEST_DATA.organization.mission,
      foundedYear: TEST_DATA.organization.foundedYear,
      annualBudget: TEST_DATA.organization.annualBudget,
      staffCount: TEST_DATA.organization.staffCount,
      executiveDirector: TEST_DATA.organization.executiveDirector,
      address: TEST_DATA.organization.address,
      serviceArea: TEST_DATA.organization.serviceArea,
      programSummary: TEST_DATA.organization.programSummary,
      onboardingCompleted: true,
    });

    const organizationSync = await notion.syncOrganizationProfile({
      legalName: TEST_DATA.organization.legalName,
      ein: TEST_DATA.organization.ein,
      mission: TEST_DATA.organization.mission,
      foundingYear: TEST_DATA.organization.foundedYear,
      annualBudget: TEST_DATA.organization.annualBudget,
      staffSize: TEST_DATA.organization.staffCount,
      executiveDirector: TEST_DATA.organization.executiveDirector,
      address: TEST_DATA.organization.address,
      grantsContact: null,
      serviceArea: TEST_DATA.organization.serviceArea,
      programAreas: TEST_DATA.organization.programSummary,
      website: null,
    });

    const orgDataSource = liveCurrentDataSources.find((row) => row.titleText === "Organization");
    const orgPage = await retrievePage(api, organizationSync.organizationPageId);
    const test1Results = [
      compareNormalizedText("TEST 1", "Name", TEST_DATA.organization.legalName, readTitle(orgPage, "Name")),
      compareNormalizedText("TEST 1", "EIN", TEST_DATA.organization.ein, readRichText(orgPage, "EIN")),
      compareNormalizedText("TEST 1", "Mission", TEST_DATA.organization.mission, readRichText(orgPage, "Mission")),
      compareNumber("TEST 1", "Annual budget", TEST_DATA.organization.annualBudget, readNumber(orgPage, "Annual Budget")),
      compareNumber("TEST 1", "Staff size", TEST_DATA.organization.staffCount, readNumber(orgPage, "Staff Size")),
      compareNumber("TEST 1", "Founding year", TEST_DATA.organization.foundedYear, readNumber(orgPage, "Founding Year")),
      compareNormalizedText("TEST 1", "Executive director", TEST_DATA.organization.executiveDirector, readRichText(orgPage, "Executive Director")),
      compareNormalizedText("TEST 1", "Address", TEST_DATA.organization.address, readRichText(orgPage, "Address")),
      compareArray("TEST 1", "Focus geographies", ["Chicago", "Cook County", "Illinois"], readMultiSelect(orgPage, "Service Areas")),
      compareArray(
        "TEST 1",
        "Program areas",
        ["After-school coaching", "Mentorship", "Family navigation", "Post-secondary pathways"],
        readMultiSelect(orgPage, "Program Areas"),
      ),
    ];

    const programResult = await workspaceContextService.saveProgram({
      organizationId: organizationResult.organization.id,
      clerkUserId,
      name: TEST_DATA.program.name,
      description: TEST_DATA.program.goals,
      targetPopulation: TEST_DATA.program.targetPopulation,
      geography: TEST_DATA.program.geography,
      theoryOfChange: TEST_DATA.program.metrics,
      status: TEST_DATA.program.strategicPriority,
      keyOutcomes: TEST_DATA.program.outcomes,
      programBudget: TEST_DATA.program.annualCost,
      programLead: TEST_DATA.program.programLead,
      fundingHistory: null,
      syncToNotion: true,
    });

    const programPage = await retrievePage(api, programResult.notionSync.programPageId);
    const test2Results = [
      compareNormalizedText("TEST 2", "Program name", TEST_DATA.program.name, readTitle(programPage, "Program Name")),
      compareNormalizedText("TEST 2", "Target population", TEST_DATA.program.targetPopulation, readRichText(programPage, "Target Population")),
      compareArray("TEST 2", "Geography", ["Cook County", "Illinois"], readMultiSelect(programPage, "Geography")),
      compareNormalizedText("TEST 2", "Goals", TEST_DATA.program.goals, readRichText(programPage, "Goals")),
      compareNormalizedText("TEST 2", "Outcomes", TEST_DATA.program.outcomes, readRichText(programPage, "Outcomes")),
      compareNormalizedText("TEST 2", "Metrics", TEST_DATA.program.metrics, readRichText(programPage, "Metrics")),
      compareNumber("TEST 2", "Annual cost", TEST_DATA.program.annualCost, readNumber(programPage, "Program Budget")),
      compareNormalizedText("TEST 2", "Program lead", TEST_DATA.program.programLead, readRichText(programPage, "Program Lead")),
      compareNormalizedText("TEST 2", "Strategic priority", TEST_DATA.program.strategicPriority, readSelect(programPage, "Strategic Priority")),
      await compareRelationTargets(
        "TEST 2",
        "Organization relation",
        TEST_DATA.organization.legalName,
        api,
        programPage,
        "Organization",
        "Name",
        "Programs database should relate back to Organization.",
      ),
    ];

    const funderPages = [];
    const funderRows = [];
    const test3Results = [];
    for (const funder of TEST_DATA.funders) {
      const funderRow = await upsertFunder(funder);
      funderRows.push(funderRow);
      try {
        const notionSync = await notion.syncFunderIntelligence({
          funderName: funder.name,
          website: funder.website,
          foundationType: funder.foundationType,
          issueAreas: funder.issueAreas.split(",").map((item) => item.trim()),
          averageGrant: funder.averageGrant,
          medianGrant: funder.medianGrant,
          geographicFocus: funder.geographicFocus,
          givingSummary: funder.givingSummary,
          grantDnaTopTerms: funder.grantDnaTopTerms,
          notes: funder.notes,
          smallOrgFriendly: funder.smallOrgFriendliness,
          filings: [],
        });
        const funderPage = await retrievePage(api, notionSync.funderPageId);
        funderPages.push(funderPage);
        test3Results.push(
          compareNormalizedText("TEST 3", `${funder.name} -> Name`, funder.name, readTitle(funderPage, "Funder Name")),
          compareUrl("TEST 3", `${funder.name} -> Website`, funder.website, readRichText(funderPage, "Website") || funderPage.properties?.Website?.url),
          compareNormalizedText("TEST 3", `${funder.name} -> Foundation type`, funder.foundationType, readSelect(funderPage, "Foundation Type")),
          compareArray("TEST 3", `${funder.name} -> Issue areas`, funder.issueAreas.split(",").map((item) => item.trim()), readMultiSelect(funderPage, "Issue Areas")),
          compareArray("TEST 3", `${funder.name} -> Geographic focus`, funder.geographicFocus, readMultiSelect(funderPage, "Geographic Focus")),
          compareNumber("TEST 3", `${funder.name} -> Average grant size`, funder.averageGrant, readNumber(funderPage, "Average Grant")),
          compareNormalizedText("TEST 3", `${funder.name} -> Small-org friendliness`, funder.smallOrgFriendliness, readSelect(funderPage, "Small-Org Friendly")),
          compareNormalizedText("TEST 3", `${funder.name} -> Notes`, funder.notes, readRichText(funderPage, "Notes")),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        funderPages.push(null);
        test3Results.push(
          fieldResult("TEST 3", `${funder.name} -> Name`, funder.name, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Website`, funder.website, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Foundation type`, funder.foundationType, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Issue areas`, funder.issueAreas, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Geographic focus`, funder.geographicFocus, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Average grant size`, funder.averageGrant, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Small-org friendliness`, funder.smallOrgFriendliness, "<not synced>", false, message),
          fieldResult("TEST 3", `${funder.name} -> Notes`, funder.notes, "<not synced>", false, message),
        );
      }
    }

    const abetterChicago = funderRows.find((row) => row.name === "A Better Chicago");
    const opportunityRow = await upsertOpportunity({
      organizationId: organizationResult.organization.id,
      funderId: abetterChicago.id,
      title: TEST_DATA.opportunity.title,
      deadline: TEST_DATA.opportunity.deadline,
      submissionMethod: TEST_DATA.opportunity.submissionPlatform,
      sourceUrl: TEST_DATA.opportunity.sourceUrl,
      status: TEST_DATA.opportunity.status,
      fitScore: TEST_DATA.opportunity.fitScore,
      pursueDecision: TEST_DATA.opportunity.pursueDecision,
      evidenceCoveragePercent: TEST_DATA.opportunity.evidenceCoveragePercent,
      effortEstimateHours: TEST_DATA.opportunity.effortHours,
      reportingBurdenScore: TEST_DATA.opportunity.reportingBurdenScore,
      rationale: TEST_DATA.opportunity.nextBestAction,
    });

    const opportunityIntakeSync = await notion.syncOpportunityIntake({
      opportunityId: opportunityRow.id,
      funderName: "A Better Chicago",
      funderWebsite: TEST_DATA.funders[0].website,
      sourceUrl: TEST_DATA.opportunity.sourceUrl,
      opportunityTitle: TEST_DATA.opportunity.title,
      deadline: TEST_DATA.opportunity.deadline,
      submissionMethod: TEST_DATA.opportunity.submissionPlatform,
      portalUrl: null,
      requirements: TEST_DATA.requirements.map((requirement) => ({
        questionText: requirement.questionText,
        requirementType: requirement.type,
        wordLimit: requirement.wordLimit,
      })),
    });

    const opportunityAnalysisSync = await notion.syncOpportunityAnalysis({
      opportunityId: opportunityRow.id,
      opportunityTitle: TEST_DATA.opportunity.title,
      funderName: TEST_DATA.funders[0].name,
      status: TEST_DATA.opportunity.status,
      deadline: TEST_DATA.opportunity.deadline,
      submissionPlatform: TEST_DATA.opportunity.submissionPlatform,
      sourceUrl: TEST_DATA.opportunity.sourceUrl,
      fitScorePercent: TEST_DATA.opportunity.fitScore,
      pursueDecision: TEST_DATA.opportunity.pursueDecision,
      evidenceCoveragePercent: TEST_DATA.opportunity.evidenceCoveragePercent,
      effortHours: TEST_DATA.opportunity.effortHours,
      reportingBurdenScore: TEST_DATA.opportunity.reportingBurdenScore,
      priorityScore: TEST_DATA.opportunity.priorityScore,
      nextBestAction: TEST_DATA.opportunity.nextBestAction,
      tasks: [],
      requirements: TEST_DATA.requirements.map((requirement) => ({
        questionText: requirement.questionText,
        required: requirement.required,
        coverageStatus: requirement.coverageStatus,
        riskLevel: requirement.riskLevel,
        note: requirement.riskFlag,
        riskFlag: requirement.riskFlag,
      })),
    });

    const opportunityPage = await retrievePage(api, opportunityAnalysisSync.opportunityPageId);
    const opportunitiesDataSource = liveCurrentDataSources.find((row) => row.titleText === "Opportunities");
    const test4Results = [
      compareNormalizedText("TEST 4", "Title", TEST_DATA.opportunity.title, readTitle(opportunityPage, "Opportunity Name")),
      await compareRelationTargets(
        "TEST 4",
        "Funder relation",
        TEST_DATA.funders[0].name,
        api,
        opportunityPage,
        "Funder",
        "Funder Name",
        "Opportunities should relate to the Funders database.",
      ),
      compareNormalizedText("TEST 4", "Status", TEST_DATA.opportunity.status, readSelect(opportunityPage, "Status")),
      compareNormalizedText("TEST 4", "Deadline", TEST_DATA.opportunity.deadline, readDate(opportunityPage, "Deadline")),
      compareNormalizedText("TEST 4", "Submission platform", TEST_DATA.opportunity.submissionPlatform, readSelect(opportunityPage, "Submission Platform")),
      compareUrl("TEST 4", "Source URL", TEST_DATA.opportunity.sourceUrl, opportunityPage.properties?.["Source URL"]?.url),
      comparePercentNumber("TEST 4", "Fit score", TEST_DATA.opportunity.fitScore, readNumber(opportunityPage, "Fit Score")),
      comparePercentNumber("TEST 4", "Evidence coverage", TEST_DATA.opportunity.evidenceCoveragePercent, readNumber(opportunityPage, "Evidence Coverage %")),
      compareNumber("TEST 4", "Estimated effort hours", TEST_DATA.opportunity.effortHours, readNumber(opportunityPage, "Effort Hours")),
      compareNumber("TEST 4", "Reporting burden score", TEST_DATA.opportunity.reportingBurdenScore, readNumber(opportunityPage, "Reporting Burden Score")),
      compareNumber("TEST 4", "Priority score", TEST_DATA.opportunity.priorityScore, readNumber(opportunityPage, "Priority Score")),
      compareNormalizedText("TEST 4", "Pursue decision", TEST_DATA.opportunity.pursueDecision, readSelect(opportunityPage, "Pursue Decision")),
      compareNormalizedText("TEST 4", "Next best action", TEST_DATA.opportunity.nextBestAction, readRichText(opportunityPage, "Next Best Action")),
      fieldResult(
        "TEST 4",
        "Fit score field type",
        "number",
        findPropertyType(opportunitiesDataSource, "Fit Score"),
        findPropertyType(opportunitiesDataSource, "Fit Score") === "number",
        null,
      ),
      fieldResult(
        "TEST 4",
        "Pursue decision field type",
        "select",
        findPropertyType(opportunitiesDataSource, "Pursue Decision"),
        findPropertyType(opportunitiesDataSource, "Pursue Decision") === "select",
        null,
      ),
      fieldResult(
        "TEST 4",
        "Priority score field type",
        "number",
        findPropertyType(opportunitiesDataSource, "Priority Score") ?? "<missing>",
        findPropertyType(opportunitiesDataSource, "Priority Score") === "number",
        "Priority Score property is missing, so it cannot be typed correctly.",
      ),
    ];

    const requirementRows = [];
    for (const requirement of TEST_DATA.requirements) {
      const requirementRow = await upsertRequirement({
        opportunityId: opportunityRow.id,
        questionText: requirement.questionText,
        requirementType: requirement.type,
        wordLimit: requirement.wordLimit,
        coverageStatus: requirement.coverageStatus,
        reviewerNotes: requirement.riskFlag,
        required: requirement.required,
      });
      requirementRows.push(requirementRow);
    }

    const requirementPages = [];
    const test5Results = [];
    for (const requirement of TEST_DATA.requirements) {
      const page = await findPageByTitle(
        api,
        bootstrap.databases.find((database) => database.key === "requirements").dataSourceId,
        "Requirement",
        requirement.questionText,
      );
      requirementPages.push(page);
      test5Results.push(
        compareNormalizedText("TEST 5", `${requirement.questionText} -> Question text`, requirement.questionText, readTitle(page, "Requirement")),
        compareNormalizedText("TEST 5", `${requirement.questionText} -> Type`, requirement.type, readSelect(page, "Requirement Type")),
        compareField("TEST 5", `${requirement.questionText} -> Required`, requirement.required, readCheckbox(page, "Required"), null),
        compareField("TEST 5", `${requirement.questionText} -> Word limit`, requirement.wordLimit, readNumber(page, "Word Limit"), null),
        compareNormalizedText("TEST 5", `${requirement.questionText} -> Coverage status`, requirement.coverageStatus, readSelect(page, "Coverage Status")),
        compareNormalizedText("TEST 5", `${requirement.questionText} -> Risk flag`, requirement.riskFlag, readRichText(page, "Risk Flag")),
        await compareRelationTargets(
          "TEST 5",
          `${requirement.questionText} -> Opportunity relation`,
          TEST_DATA.opportunity.title,
          api,
          page,
          "Opportunity",
          "Opportunity Name",
          "Requirements should relate back to their opportunity.",
        ),
      );
    }

    const evidenceResult = await workspaceContextService.saveEvidence({
      organizationId: organizationResult.organization.id,
      clerkUserId,
      programId: programResult.program.id,
      title: TEST_DATA.evidence.title,
      evidenceType: TEST_DATA.evidence.type,
      content: TEST_DATA.evidence.summary,
      sourceDocument: TEST_DATA.evidence.title,
      collectedAt: TEST_DATA.evidence.date,
      reliabilityRating: TEST_DATA.evidence.qualityScore,
      tags: TEST_DATA.evidence.tags,
      syncToNotion: false,
    });

    const evidenceSync = await notion.syncEvidenceLibraryEntry({
      programName: TEST_DATA.program.name,
      evidenceTitle: TEST_DATA.evidence.title,
      evidenceType: TEST_DATA.evidence.type,
      summary: TEST_DATA.evidence.summary,
      metrics: TEST_DATA.evidence.metrics,
      geography: TEST_DATA.evidence.geography,
      sourceDocument: TEST_DATA.evidence.title,
      qualityScore: TEST_DATA.evidence.qualityScore,
      reusabilityScore: TEST_DATA.evidence.reusabilityScore,
      collectedAt: TEST_DATA.evidence.date,
      tags: TEST_DATA.evidence.tags,
    });

    const evidencePage = await retrievePage(api, evidenceSync.evidencePageId);
    const test6Results = [
      compareNormalizedText("TEST 6", "Title", TEST_DATA.evidence.title, readTitle(evidencePage, "Evidence Title")),
      compareNormalizedText("TEST 6", "Type", TEST_DATA.evidence.type, readSelect(evidencePage, "Evidence Type")),
      compareNormalizedText("TEST 6", "Summary", TEST_DATA.evidence.summary, readRichText(evidencePage, "Summary")),
      await compareRelationTargets(
        "TEST 6",
        "Program relation",
        TEST_DATA.program.name,
        api,
        evidencePage,
        "Program",
        "Program Name",
        "Evidence Library entries should relate to Programs.",
      ),
      compareNormalizedText("TEST 6", "Date", TEST_DATA.evidence.date, readDate(evidencePage, "Collected At")),
      compareNumber("TEST 6", "Quality score", TEST_DATA.evidence.qualityScore, readNumber(evidencePage, "Quality Score")),
      compareNormalizedText("TEST 6", "Metrics", TEST_DATA.evidence.metrics, readRichText(evidencePage, "Metrics")),
      compareNormalizedText("TEST 6", "Reusability score", TEST_DATA.evidence.reusabilityScore, readSelect(evidencePage, "Reusability Score")),
      compareArray("TEST 6", "Tags", ["Outcomes", "Graduation", "Post-secondary", "Chicago", "Youth"], readMultiSelect(evidencePage, "Tags")),
      compareNormalizedText("TEST 6", "Geography", TEST_DATA.evidence.geography, readRichText(evidencePage, "Geography")),
      compareNormalizedText("TEST 6", "Source document", TEST_DATA.evidence.title, readRichText(evidencePage, "Source Document")),
    ];

    const draftRow = await upsertDraftAnswer({
      opportunityId: opportunityRow.id,
      requirementId: requirementRows[0].id,
      draftText: TEST_DATA.draft.draftText,
      wordCount: TEST_DATA.draft.draftText.split(/\s+/).length,
      evidenceCitations: TEST_DATA.draft.groundingRefs,
      unsupportedClaims: "",
      status: TEST_DATA.draft.approvalStatus,
      reviewerComments: TEST_DATA.draft.reviewerNotes,
      revisionNotes: TEST_DATA.draft.reviewerNotes,
      dnaMatchScore: TEST_DATA.draft.dnaMatchScore,
    });

    const draftSync = await notion.syncDraftAnswers({
      opportunityId: opportunityRow.id,
      opportunityTitle: TEST_DATA.opportunity.title,
      archiveStale: false,
      drafts: [
        {
          requirementId: requirementRows[0].id,
          requirementText: TEST_DATA.requirements[0].questionText,
          status: TEST_DATA.draft.approvalStatus,
          draftText: TEST_DATA.draft.draftText,
          evidenceCitations: [TEST_DATA.draft.groundingRefs],
          dnaMatchPercent: TEST_DATA.draft.dnaMatchScore,
          unsupportedClaims: [],
          reviewerNotes: TEST_DATA.draft.reviewerNotes,
        },
      ],
    });

    const draftPage = await retrievePage(api, draftSync.draftPageIds[0]);
    const test7Results = [
      await compareRelationTargets(
        "TEST 7",
        "Opportunity relation",
        TEST_DATA.opportunity.title,
        api,
        draftPage,
        "Opportunity",
        "Opportunity Name",
        "Draft Answers should relate to their opportunity.",
      ),
      await compareRelationTargets(
        "TEST 7",
        "Requirement relation",
        TEST_DATA.requirements[0].questionText,
        api,
        draftPage,
        "Requirement",
        "Requirement",
        "Draft Answers should relate to their requirement.",
      ),
      compareNormalizedText("TEST 7", "Draft text", TEST_DATA.draft.draftText, readRichText(draftPage, "Draft Text")),
      await compareRelationTargets(
        "TEST 7",
        "Grounding refs",
        TEST_DATA.draft.groundingRefs,
        api,
        draftPage,
        "Evidence",
        "Evidence Title",
        "Draft Answers should relate to their evidence sources.",
      ),
      comparePercentNumber("TEST 7", "DNA match score", TEST_DATA.draft.dnaMatchScore, readNumber(draftPage, "DNA Match %")),
      compareNormalizedText("TEST 7", "Approval status", TEST_DATA.draft.approvalStatus, readSelect(draftPage, "Status")),
      compareNormalizedText("TEST 7", "Reviewer notes", TEST_DATA.draft.reviewerNotes, readRichText(draftPage, "Reviewer Notes")),
    ];

    const agentLogRow = await upsertAgentLog({
      runId: TEST_DATA.agentLog.runId,
      agentName: TEST_DATA.agentLog.agent,
      actionDescription: TEST_DATA.agentLog.action,
      sourceUrl: TEST_DATA.opportunity.sourceUrl,
      confidenceLevel: 1,
      outputSummary: TEST_DATA.agentLog.outputSummary,
      followUpRequired: TEST_DATA.agentLog.followUpNeeded,
    });

    const agentLogSync = await notion.syncStoredAgentLog({
      logId: agentLogRow.id,
      runId: TEST_DATA.agentLog.runId,
      agentName: TEST_DATA.agentLog.agent,
      actionDescription: TEST_DATA.agentLog.action,
      summary: TEST_DATA.agentLog.outputSummary,
      source: TEST_DATA.agentLog.source,
      sourceUrl: TEST_DATA.opportunity.sourceUrl,
      confidenceLevel: 1,
      followUpRequired: TEST_DATA.agentLog.followUpNeeded,
      createdAt: CURRENT_TIMESTAMP,
    });

    const agentLogPage = await retrievePage(api, agentLogSync.agentLogPageId);
    const test8Results = [
      compareNormalizedText("TEST 8", "Run ID", TEST_DATA.agentLog.runId, readRichText(agentLogPage, "Run ID")),
      compareNormalizedText("TEST 8", "Agent", TEST_DATA.agentLog.agent, readSelect(agentLogPage, "Agent")),
      compareDateTimeClose("TEST 8", "Timestamp", CURRENT_TIMESTAMP, readDate(agentLogPage, "Timestamp")),
      compareNormalizedText("TEST 8", "Action", TEST_DATA.agentLog.action, readRichText(agentLogPage, "Action")),
      compareNormalizedText("TEST 8", "Source", TEST_DATA.agentLog.source, readRichText(agentLogPage, "Source")),
      compareNormalizedText("TEST 8", "Output summary", TEST_DATA.agentLog.outputSummary, readRichText(agentLogPage, "Output Summary")),
      compareNormalizedText("TEST 8", "Confidence", TEST_DATA.agentLog.confidence, readSelect(agentLogPage, "Confidence")),
      compareField("TEST 8", "Follow-up needed", TEST_DATA.agentLog.followUpNeeded, readCheckbox(agentLogPage, "Follow-Up Required"), null),
    ];

    const tmobileFunder = funderRows.find((row) => row.name === "T-Mobile Hometown Grant Program");
    const tmobileOpportunityRow = await upsertOpportunity({
      organizationId: organizationResult.organization.id,
      funderId: tmobileFunder.id,
      title: TEST_DATA.lesson.opportunityTitle,
      deadline: "2025-03-31",
      submissionMethod: "Submittable",
      sourceUrl: TEST_DATA.funders[1].website,
      status: "Rejected",
      fitScore: 0,
      pursueDecision: "Skip",
      evidenceCoveragePercent: 0,
      effortEstimateHours: 0,
      reportingBurdenScore: 0,
      rationale: TEST_DATA.lesson.recommendations,
    });

    await notion.syncOpportunityIntake({
      opportunityId: tmobileOpportunityRow.id,
      funderName: TEST_DATA.funders[1].name,
      funderWebsite: TEST_DATA.funders[1].website,
      sourceUrl: TEST_DATA.funders[1].website,
      opportunityTitle: TEST_DATA.lesson.opportunityTitle,
      deadline: "2025-03-31",
      submissionMethod: "Submittable",
      portalUrl: TEST_DATA.funders[1].website,
      requirements: [],
    });
    await notion.syncOpportunityStatus({
      opportunityId: tmobileOpportunityRow.id,
      opportunityTitle: TEST_DATA.lesson.opportunityTitle,
      status: "Rejected",
    });

    const lessonRow = await upsertLesson({
      organizationId: organizationResult.organization.id,
      funderId: tmobileFunder.id,
      opportunityId: tmobileOpportunityRow.id,
      feedbackText: TEST_DATA.lesson.feedbackText,
      themes: TEST_DATA.lesson.extractedThemes,
      recommendations: TEST_DATA.lesson.recommendations,
      appliesNextCycle: TEST_DATA.lesson.appliedNextCycle,
    });

    const lessonSync = await notion.syncLessonsMemory({
      lessons: [
        {
          title: TEST_DATA.lesson.title,
          funderName: TEST_DATA.funders[1].name,
          opportunityTitle: TEST_DATA.lesson.opportunityTitle,
          result: TEST_DATA.lesson.result,
          feedbackText: TEST_DATA.lesson.feedbackText,
          themes: TEST_DATA.lesson.extractedThemes.split(",").map((item) => item.trim()),
          recommendations: TEST_DATA.lesson.recommendations,
          appliesNextCycle: TEST_DATA.lesson.appliedNextCycle,
          recordedAt: CURRENT_TIMESTAMP,
          appendToFunderPage: true,
        },
      ],
    });

    const lessonPage = await retrievePage(api, lessonSync.lessonPageIds[0]);
    const test9Results = [
      await compareRelationTargets(
        "TEST 9",
        "Funder relation",
        TEST_DATA.funders[1].name,
        api,
        lessonPage,
        "Funder",
        "Funder Name",
        "Lessons should relate to the funder they reference.",
      ),
      await compareRelationTargets(
        "TEST 9",
        "Opportunity",
        TEST_DATA.lesson.opportunityTitle,
        api,
        lessonPage,
        "Opportunity",
        "Opportunity Name",
        "Lessons should relate to the opportunity they describe.",
      ),
      compareNormalizedText("TEST 9", "Result", TEST_DATA.lesson.result, readSelect(lessonPage, "Result")),
      compareNormalizedText("TEST 9", "Feedback text", TEST_DATA.lesson.feedbackText, readRichText(lessonPage, "Feedback Text")),
      compareArray("TEST 9", "Extracted themes", TEST_DATA.lesson.extractedThemes.split(",").map((item) => item.trim()), readMultiSelect(lessonPage, "Themes")),
      compareNormalizedText("TEST 9", "Recommendations", TEST_DATA.lesson.recommendations, readRichText(lessonPage, "Recommendations")),
      compareField("TEST 9", "Applied next cycle", TEST_DATA.lesson.appliedNextCycle, readCheckbox(lessonPage, "Applies Next Cycle"), null),
    ];

    const reportingRow = await upsertReportingRecord({
      organizationId: organizationResult.organization.id,
      opportunityId: opportunityRow.id,
      reportName: TEST_DATA.reporting.reportType,
      dueDate: TEST_DATA.reporting.dueDate,
      reportingPeriod: "Interim",
      status: "Upcoming",
      requiredMetrics: TEST_DATA.reporting.requiredMetrics,
      owner: TEST_DATA.reporting.owner,
      templateLink: null,
    });

    const reportingSync = await notion.syncReportingWorkflow({
      opportunityId: opportunityRow.id,
      opportunityTitle: TEST_DATA.opportunity.title,
      metricsToTrack: TEST_DATA.reporting.requiredMetrics.split(",").map((item) => item.trim()),
      templates: [],
      reports: [
        {
          title: TEST_DATA.reporting.reportType,
          dueDate: TEST_DATA.reporting.dueDate,
          status: "Upcoming",
          owner: TEST_DATA.reporting.owner,
          reportingPeriod: "Interim",
          requiredMetrics: TEST_DATA.reporting.requiredMetrics,
          templateLink: null,
        },
      ],
      tasks: [],
    });

    const reportingPage = await retrievePage(api, reportingSync.reportingPageIds[0]);
    const test10Results = [
      await compareRelationTargets(
        "TEST 10",
        "Opportunity relation",
        TEST_DATA.opportunity.title,
        api,
        reportingPage,
        "Opportunity",
        "Opportunity Name",
        "Reporting Calendar entries should relate to their opportunity.",
      ),
      compareNormalizedText("TEST 10", "Report type", TEST_DATA.reporting.reportType, readTitle(reportingPage, "Report")),
      compareNormalizedText("TEST 10", "Due date", TEST_DATA.reporting.dueDate, readDate(reportingPage, "Due Date")),
      compareNormalizedText("TEST 10", "Required metrics", TEST_DATA.reporting.requiredMetrics, readRichText(reportingPage, "Required Metrics")),
      compareNormalizedText("TEST 10", "Owner", TEST_DATA.reporting.owner, readRichText(reportingPage, "Owner")),
      compareNormalizedText("TEST 10", "Status", TEST_DATA.reporting.status, readSelect(reportingPage, "Status")),
    ];

    const relationAuditResults = [
      relationResult(
        "Program -> Organization",
        (await compareRelationTargets("TEST 11", "Program -> Organization", TEST_DATA.organization.legalName, api, programPage, "Organization", "Name", "Program should resolve to Organization.")).passed,
        "Program should resolve to Organization.",
      ),
      relationResult(
        "Opportunity -> Funder",
        (await compareRelationTargets("TEST 11", "Opportunity -> Funder", TEST_DATA.funders[0].name, api, opportunityPage, "Funder", "Funder Name", "Opportunity should resolve to Funder.")).passed,
        "Opportunity should resolve to Funder.",
      ),
      relationResult(
        "Requirements -> Opportunity",
        (await compareRelationTargets("TEST 11", "Requirements -> Opportunity", TEST_DATA.opportunity.title, api, requirementPages[0], "Opportunity", "Opportunity Name", "Requirement should resolve to Opportunity.")).passed,
        "Requirement should resolve to Opportunity.",
      ),
      relationResult(
        "Draft Answer -> Opportunity",
        (await compareRelationTargets("TEST 11", "Draft Answer -> Opportunity", TEST_DATA.opportunity.title, api, draftPage, "Opportunity", "Opportunity Name", "Draft should resolve to Opportunity.")).passed,
        "Draft should resolve to Opportunity.",
      ),
      relationResult(
        "Draft Answer -> Requirement",
        (await compareRelationTargets("TEST 11", "Draft Answer -> Requirement", TEST_DATA.requirements[0].questionText, api, draftPage, "Requirement", "Requirement", "Draft should resolve to Requirement.")).passed,
        "Draft should resolve to Requirement.",
      ),
      relationResult(
        "Draft Answer -> Evidence",
        (await compareRelationTargets("TEST 11", "Draft Answer -> Evidence", TEST_DATA.evidence.title, api, draftPage, "Evidence", "Evidence Title", "Draft should resolve to Evidence.")).passed,
        "Draft should resolve to Evidence.",
      ),
      relationResult(
        "Lessons -> Funder",
        (await compareRelationTargets("TEST 11", "Lessons -> Funder", TEST_DATA.funders[1].name, api, lessonPage, "Funder", "Funder Name", "Lesson should resolve to Funder.")).passed,
        "Lesson should resolve to Funder.",
      ),
      relationResult(
        "Reporting Calendar -> Opportunity",
        (await compareRelationTargets("TEST 11", "Reporting Calendar -> Opportunity", TEST_DATA.opportunity.title, api, reportingPage, "Opportunity", "Opportunity Name", "Reporting record should resolve to Opportunity.")).passed,
        "Reporting record should resolve to Opportunity.",
      ),
    ];

    const summaries = [
      makeTestSummary("TEST 1 - Organization Record", test1Results),
      makeTestSummary("TEST 2 - Program Record", test2Results),
      makeTestSummary("TEST 3 - Funder Records", test3Results),
      makeTestSummary("TEST 4 - Opportunity Record", test4Results),
      makeTestSummary("TEST 5 - Requirements Records", test5Results),
      makeTestSummary("TEST 6 - Evidence Library Record", test6Results),
      makeTestSummary("TEST 7 - Draft Answer Record", test7Results),
      makeTestSummary("TEST 8 - Agent Log Record", test8Results),
      makeTestSummary("TEST 9 - Lessons Record", test9Results),
      makeTestSummary("TEST 10 - Reporting Calendar Record", test10Results),
    ];

    const relationAudit = {
      label: "TEST 11 - Relation Chain Audit",
      passed: relationAuditResults.every((result) => result.passed),
      passedCount: countPasses(relationAuditResults),
      totalCount: relationAuditResults.length,
      results: relationAuditResults,
    };

    const failureLines = buildFailureLines(summaries, relationAudit, baseline);
    const databasesFound = baseline.baseline.filter((row) => row.exists).length;
    const overallPassed = summaries.every((summary) => summary.passed) && relationAudit.passed;

    const lines = [];
    lines.push("NOTION INTEGRATION TEST REPORT");
    lines.push("================================");
    lines.push(`Workspace: ${connection.workspaceName} (${connection.workspaceId})`);
    lines.push(`Clerk user: ${clerkUserId}`);
    lines.push(`Root page: ${bootstrap.rootPageId}`);
    lines.push("");
    lines.push("LIVE DATABASE INVENTORY");
    for (const dataSource of liveCurrentDataSources) {
      lines.push(`- ${dataSource.titleText}: databaseId=${dataSource.databaseId} dataSourceId=${dataSource.dataSourceId}`);
    }
    lines.push("");
    lines.push(`Databases found: ${databasesFound} of 16 expected`);
    lines.push("");
    lines.push("SCHEMA CHECKLIST");
    for (const row of baseline.baseline) {
      lines.push(
        `- ${row.databaseName}: ${row.exists ? "yes" : "no"}${
          row.exists ? ` (databaseId=${row.databaseId}, dataSourceId=${row.dataSourceId})` : ""
        }`,
      );
      if (row.missingProperties.length > 0) {
        lines.push(`  Missing properties: ${row.missingProperties.join(", ")}`);
      }
    }
    if (baseline.extraDatabases.length > 0) {
      lines.push("Extra databases present:");
      for (const extra of baseline.extraDatabases) {
        lines.push(`- ${extra.databaseName}: databaseId=${extra.databaseId} dataSourceId=${extra.dataSourceId}`);
      }
    }
    lines.push("");
    for (const summary of summaries) {
      lines.push(
        `${summary.label}: ${resultToStatus(summary.passed)} (${summary.passedCount} of ${summary.totalCount} fields correct)`,
      );
    }
    lines.push(
      `${relationAudit.label}: ${resultToStatus(relationAudit.passed)} (${relationAudit.passedCount} of ${relationAudit.totalCount} relations resolve correctly)`,
    );
    lines.push("");
    lines.push("FAILURES REQUIRING FIXES:");
    if (failureLines.length === 0) {
      lines.push("- None");
    } else {
      for (const line of failureLines) {
        lines.push(`- ${line}`);
      }
    }
    lines.push("");
    lines.push(`OVERALL STATUS: ${resultToStatus(overallPassed)}`);
    lines.push("");
    lines.push("FIELD-BY-FIELD DETAIL");
    for (const summary of summaries) {
      lines.push(summary.label);
      for (const result of summary.results) {
        lines.push(
          `- ${resultToStatus(result.passed)} ${result.field}: expected=${formatValue(result.expected)} actual=${formatValue(result.actual)}${result.note ? ` | ${result.note}` : ""}`,
        );
      }
      lines.push("");
    }
    lines.push(relationAudit.label);
    for (const result of relationAudit.results) {
      lines.push(`- ${resultToStatus(result.passed)} ${result.field}: ${result.note}`);
    }

    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(OUTPUT_FILE, lines.join("\n"), "utf8");
    console.log(lines.join("\n"));
  });
};

main().catch((error) => {
  if (error instanceof NotionAuthorizationError) {
    console.error(`Notion authorization failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.error(error);
  process.exitCode = 1;
});
