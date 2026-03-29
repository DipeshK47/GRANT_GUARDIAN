import { randomUUID } from "node:crypto";
import { Type, type Schema } from "@google/genai";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  draftAnswers,
  funders,
  opportunities,
  reportingCalendar,
  requirements,
  tasks,
} from "../../db/schema.js";
import { normalizeScopedText } from "../../lib/organization-scope.js";
import {
  computeGrantDnaAlignment,
  readStoredGrantDnaProfile,
} from "../funders/grant-dna.js";
import type { GeminiClient } from "../gemini/client.js";
import { isNotionAuthorizationError, type NotionMcpClient } from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type ReportingCadence = "Final Only" | "Semiannual + Final" | "Quarterly + Final";
export type ReportingStatus = "Upcoming" | "In Progress" | "Submitted" | "Overdue";

type ReportingRecord = typeof reportingCalendar.$inferSelect;
type OpportunityRecord = typeof opportunities.$inferSelect;
type RequirementRecord = typeof requirements.$inferSelect;
type DraftAnswerRecord = typeof draftAnswers.$inferSelect;

type ReportingTemplateDraft = {
  reportId: string;
  reportName: string;
  requirementId: string;
  draftAnswerId: string;
  title: string;
  status: "Drafting" | "Needs Review" | "Approved";
  templateLink?: string | null;
};

type ReportingMilestoneTask = {
  id: string;
  title: string;
  status: "To Do" | "In Progress" | "Blocked" | "Done";
  dueDate?: string | null;
  assignee?: string | null;
};

type ReportingCommitments = {
  metrics: string[];
  outcomes: string[];
  deliverables: string[];
  evidenceCitations: string[];
};

export type ActivateReportingWorkflowInput = {
  opportunityId: string;
  organizationId?: string | null;
  awardDate?: string | null;
  owner?: string | null;
  cadence?: ReportingCadence | null;
  templateLink?: string | null;
  requiredMetrics?: string[] | null;
  syncToNotion?: boolean;
};

export type ReportingCalendarListResult = {
  opportunityId: string;
  opportunityTitle: string;
  opportunityStatus: string;
  cadence: ReportingCadence | null;
  reports: Array<{
    id: string;
    reportName: string;
    dueDate: string;
    reportingPeriod?: string | null;
    status: ReportingStatus;
    owner?: string | null;
    templateLink?: string | null;
    requiredMetrics: string[];
  }>;
  summary: {
    total: number;
    upcoming: number;
    inProgress: number;
    submitted: number;
    overdue: number;
  };
  metricsToTrack: string[];
  reportTemplates: ReportingTemplateDraft[];
  milestoneTasks: ReportingMilestoneTask[];
  notionWorkspaceUrl?: string | null;
};

export type ActivateReportingWorkflowResult = ReportingCalendarListResult & {
  awardDate: string;
  owner?: string | null;
  notionSync?: {
    reportingPageIds: string[];
    taskPageIds: string[];
    draftPageIds?: string[];
    reportingWorkspacePageId?: string;
    reportingWorkspacePageUrl?: string;
  };
};

export type UpdateReportingEntryInput = {
  reportId: string;
  organizationId?: string | null;
  status?: ReportingStatus | null;
  owner?: string | null;
  templateLink?: string | null;
  requiredMetrics?: string[] | null;
  syncToNotion?: boolean;
};

export type UpdateReportingEntryResult = {
  reportId: string;
  opportunityId: string;
  opportunityTitle: string;
  reportName: string;
  dueDate: string;
  status: ReportingStatus;
  owner?: string | null;
  templateLink?: string | null;
  requiredMetrics: string[];
  notionSync?: {
    reportingPageIds: string[];
    taskPageIds: string[];
    reportingWorkspacePageId?: string;
    reportingWorkspacePageUrl?: string;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const cadencePlan: Record<ReportingCadence, Array<{ name: string; monthOffset: number }>> = {
  "Final Only": [{ name: "Final Report", monthOffset: 12 }],
  "Semiannual + Final": [
    { name: "Midpoint Report", monthOffset: 6 },
    { name: "Final Report", monthOffset: 12 },
  ],
  "Quarterly + Final": [
    { name: "Quarter 1 Report", monthOffset: 3 },
    { name: "Quarter 2 Report", monthOffset: 6 },
    { name: "Quarter 3 Report", monthOffset: 9 },
    { name: "Final Report", monthOffset: 12 },
  ],
};

const reportingCommitmentSchema: Schema = {
  type: Type.OBJECT,
  required: ["metrics", "outcomes", "deliverables"],
  propertyOrdering: ["metrics", "outcomes", "deliverables"],
  properties: {
    metrics: {
      type: Type.ARRAY,
      description: "Specific promised metrics or measurable indicators from the proposal.",
      items: { type: Type.STRING },
    },
    outcomes: {
      type: Type.ARRAY,
      description: "Promised beneficiary or program outcomes from the proposal.",
      items: { type: Type.STRING },
    },
    deliverables: {
      type: Type.ARRAY,
      description: "Concrete program deliverables, milestones, or activities promised in the proposal.",
      items: { type: Type.STRING },
    },
  },
};

const parseRequiredMetrics = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeText(String(item))).filter(Boolean)
      : [];
  } catch {
    return normalized
      .split(/\n|,|\|/)
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }
};

const serializeRequiredMetrics = (metrics?: string[] | null) => {
  const normalized = (metrics ?? []).map((item) => normalizeText(item)).filter(Boolean);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
};

const parseDateOnly = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const candidate = normalized.length <= 10 ? `${normalized}T00:00:00.000Z` : normalized;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const addMonths = (value: Date, months: number) => {
  const next = new Date(value.getTime());
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

const addDays = (value: Date, days: number) => {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const taskDescriptionForReport = (reportName: string) => `Prepare report: ${reportName}`;

const reportingTemplateRequirementText = (reportName: string) => `Reporting template: ${reportName}`;

const internalReportingTemplateHref = (opportunityId: string, reportId: string) =>
  `/opportunities/${opportunityId}/reporting?template=${reportId}`;

const reportStatusToTaskStatus = (status: ReportingStatus) => {
  switch (status) {
    case "In Progress":
      return "In Progress" as const;
    case "Submitted":
      return "Done" as const;
    case "Overdue":
      return "Blocked" as const;
    default:
      return "To Do" as const;
  }
};

const getTodayDateOnly = () => formatDateOnly(new Date());

const normalizeSentence = (value?: string | null) => normalizeText(value).replace(/\s+/g, " ");

const splitIntoSentences = (value?: string | null) =>
  normalizeSentence(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const uniqueStrings = (values: Array<string | null | undefined>) => [
  ...new Set(values.map((value) => normalizeText(value)).filter(Boolean)),
];

const deriveStatus = (status: string, dueDate: string): ReportingStatus => {
  const normalizedStatus = normalizeText(status) as ReportingStatus;
  if (normalizedStatus === "Submitted" || normalizedStatus === "In Progress") {
    return normalizedStatus;
  }

  return dueDate < getTodayDateOnly() ? "Overdue" : "Upcoming";
};

const pickCadence = (
  requestedCadence?: ReportingCadence | null,
  opportunity?: OpportunityRecord | null,
): ReportingCadence => {
  if (requestedCadence && cadencePlan[requestedCadence]) {
    return requestedCadence;
  }

  const burden = opportunity?.reportingBurdenScore ?? 0;
  return burden >= 60 ? "Quarterly + Final" : "Semiannual + Final";
};

export class PostAwardReportingService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly notionClient?: NotionMcpClient,
    private readonly geminiClient?: GeminiClient,
    logger?: Partial<LoggerLike>,
  ) {
    this.logger = {
      info: logger?.info
        ? (payload, message) => logger.info?.(payload, message)
        : () => undefined,
      warn: logger?.warn
        ? (payload, message) => logger.warn?.(payload, message)
        : () => undefined,
      error: logger?.error
        ? (payload, message) => logger.error?.(payload, message)
        : () => undefined,
    };
  }

  async activate(input: ActivateReportingWorkflowInput): Promise<ActivateReportingWorkflowResult> {
    const { opportunity, organizationId } = await this.loadOpportunityContext({
      opportunityId: input.opportunityId,
      organizationId: input.organizationId,
    });
    const [funder] = await db
      .select()
      .from(funders)
      .where(eq(funders.id, opportunity.funderId))
      .limit(1);
    if (!funder) {
      throw new Error("The opportunity references a missing funder record.");
    }

    const awardDate = formatDateOnly(parseDateOnly(input.awardDate) ?? new Date());
    const cadence = pickCadence(input.cadence, opportunity);
    const owner = normalizeText(input.owner) || opportunity.owner || null;
    const templateLink = normalizeText(input.templateLink) || null;
    const extractedCommitments = await this.extractReportingCommitments(opportunity.id);
    const requiredMetrics = uniqueStrings([
      ...(input.requiredMetrics ?? []),
      ...extractedCommitments.metrics,
    ]);
    const now = new Date().toISOString();

    const existingReports = await db
      .select()
      .from(reportingCalendar)
      .where(eq(reportingCalendar.opportunityId, opportunity.id))
      .orderBy(asc(reportingCalendar.dueDate));
    const existingReportMap = new Map(existingReports.map((report) => [report.reportName, report]));

    const existingTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.opportunityId, opportunity.id));
    const existingTaskMap = new Map(existingTasks.map((task) => [task.description, task]));

    let currentPeriodStart = parseDateOnly(awardDate)!;
    const reportsForSync: Array<{
      title: string;
      dueDate: string;
      status: ReportingStatus;
      owner?: string | null;
      reportingPeriod?: string | null;
      templateLink?: string | null;
    }> = [];
    const tasksForSync: Array<{
      title: string;
      priority: "Low" | "Medium" | "High";
      status: "To Do" | "In Progress" | "Blocked" | "Done";
      dueDate?: string | null;
      assignee?: string | null;
      blocking: boolean;
    }> = [];
    const reportTemplateSeedRows: Array<{
      reportId: string;
      reportName: string;
      dueDate: string;
      reportingPeriod?: string | null;
      requiredMetrics: string[];
      owner?: string | null;
    }> = [];

    for (const plan of cadencePlan[cadence]) {
      const dueDateObject = addMonths(parseDateOnly(awardDate)!, plan.monthOffset);
      const dueDate = formatDateOnly(dueDateObject);
      const reportName = plan.name;
      const existingReport = existingReportMap.get(reportName);
      const reportingPeriod = `${formatDateOnly(currentPeriodStart)} to ${dueDate}`;
      const nextStatus = existingReport
        ? deriveStatus(existingReport.status, dueDate)
        : deriveStatus("Upcoming", dueDate);
      const nextOwner = owner ?? existingReport?.owner ?? null;
      const nextTemplateLink = templateLink || existingReport?.templateLink || null;
      const nextMetrics =
        requiredMetrics.length > 0
          ? requiredMetrics
          : parseRequiredMetrics(existingReport?.requiredMetrics);
      const reportValues = {
        organizationId,
        opportunityId: opportunity.id,
        reportName,
        dueDate,
        reportingPeriod,
        status: nextStatus,
        owner: nextOwner,
        templateLink: nextTemplateLink,
        requiredMetrics: serializeRequiredMetrics(nextMetrics),
        updatedAt: now,
      };

      if (existingReport) {
        await db
          .update(reportingCalendar)
          .set(reportValues)
          .where(eq(reportingCalendar.id, existingReport.id));
      } else {
        await db.insert(reportingCalendar).values({
          id: randomUUID(),
          ...reportValues,
          createdAt: now,
        });
      }

      reportsForSync.push({
        title: `${opportunity.title} - ${reportName}`,
        dueDate,
        status: nextStatus,
        owner: nextOwner,
        reportingPeriod,
        templateLink: nextTemplateLink,
      });
      const reportTaskBlueprints = this.buildReportingTasks({
        reportName,
        dueDate,
        owner: nextOwner,
        status: nextStatus,
      });
      for (const taskBlueprint of reportTaskBlueprints) {
        const existingTask =
          existingTaskMap.get(taskBlueprint.title) ??
          (taskBlueprint.title.startsWith("Draft report narrative:")
            ? existingTaskMap.get(taskDescriptionForReport(reportName))
            : undefined);
        const taskValues = {
          opportunityId: opportunity.id,
          requirementId: null,
          description: taskBlueprint.title,
          priority: taskBlueprint.priority,
          assignee: taskBlueprint.assignee,
          dueDate: taskBlueprint.dueDate,
          status: taskBlueprint.status,
          blockingDependency: null,
          updatedAt: now,
        };

        if (existingTask) {
          await db.update(tasks).set(taskValues).where(eq(tasks.id, existingTask.id));
        } else {
          await db.insert(tasks).values({
            id: randomUUID(),
            ...taskValues,
            createdAt: now,
          });
        }

        tasksForSync.push({
          title: taskBlueprint.title,
          priority: taskBlueprint.priority,
          status: taskBlueprint.status,
          dueDate: taskBlueprint.dueDate,
          assignee: taskBlueprint.assignee,
          blocking: taskBlueprint.status === "Blocked",
        });
      }
      reportTemplateSeedRows.push({
        reportId: existingReport?.id ?? reportValues.opportunityId,
        reportName,
        dueDate,
        reportingPeriod,
        requiredMetrics: nextMetrics,
        owner: nextOwner,
      });
      currentPeriodStart = addDays(dueDateObject, 1);
    }

    const refreshedReports = await db
      .select()
      .from(reportingCalendar)
      .where(eq(reportingCalendar.opportunityId, opportunity.id))
      .orderBy(asc(reportingCalendar.dueDate));
    const reportByName = new Map(refreshedReports.map((report) => [report.reportName, report]));
    const seededTemplates = await this.seedReportingTemplates({
      opportunity,
      funder,
      commitments: extractedCommitments,
      reports: reportTemplateSeedRows
        .map((row) => ({
          ...row,
          reportId: reportByName.get(row.reportName)?.id ?? row.reportId,
        }))
        .filter((row) => normalizeText(row.reportId)),
    });

    await db
      .update(opportunities)
      .set({
        status: "Awarded",
        updatedAt: now,
      })
      .where(eq(opportunities.id, opportunity.id));

    await db.insert(agentLogs).values({
      id: randomUUID(),
      runId: randomUUID(),
      agentName: "reporting-workflow",
      actionDescription: "Activated post-award reporting workflow",
      confidenceLevel: 0.97,
      outputSummary: `Built a ${cadence.toLowerCase()} reporting plan for ${opportunity.title} with ${reportsForSync.length} deadline(s).`,
      followUpRequired: true,
      createdAt: now,
      updatedAt: now,
    });

    let notionSync: ActivateReportingWorkflowResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        const draftSync = await this.syncReportingTemplatesToNotion(opportunity.id, opportunity.title);
        const templateUrlByRequirement = new Map(
          (draftSync?.draftPages ?? []).map((page) => [page.requirementText, page.url ?? null]),
        );

        for (const template of seededTemplates) {
          const pageUrl =
            templateUrlByRequirement.get(reportingTemplateRequirementText(template.reportName)) ??
            null;
          if (!pageUrl) {
            continue;
          }

          await db
            .update(reportingCalendar)
            .set({
              templateLink: pageUrl,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(reportingCalendar.id, template.reportId));
          template.templateLink = pageUrl;
        }

        notionSync = await this.notionClient.syncReportingWorkflow({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          metricsToTrack: requiredMetrics,
          templates: seededTemplates.map((template) => ({
            title: template.title,
            templateLink: template.templateLink ?? null,
          })),
          reports: reportsForSync.map((report) => ({
            ...report,
            templateLink:
              seededTemplates.find((template) => report.title.endsWith(template.reportName))
                ?.templateLink ??
              report.templateLink ??
              null,
          })),
          tasks: tasksForSync,
        });
        notionSync.draftPageIds = draftSync?.draftPageIds;
        await this.notionClient.syncOpportunityStatus({
          opportunityId: opportunity.id,
          opportunityTitle: opportunity.title,
          status: "Awarded",
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for reporting workflow activation");
      }
    }

    const result = await this.list({
      organizationId,
      opportunityId: opportunity.id,
      cadence,
    });

    return {
      ...result,
      awardDate,
      owner,
      notionSync,
    };
  }

  async list(input: {
    opportunityId: string;
    organizationId?: string | null;
    cadence?: ReportingCadence | null;
  }): Promise<ReportingCalendarListResult> {
    const { opportunity, organizationId } = await this.loadOpportunityContext({
      opportunityId: input.opportunityId,
      organizationId: input.organizationId,
    });

    const [rows, taskRows, requirementRows, draftRows] = await Promise.all([
      db
        .select()
        .from(reportingCalendar)
        .where(eq(reportingCalendar.opportunityId, opportunity.id))
        .orderBy(asc(reportingCalendar.dueDate)),
      db.select().from(tasks).where(eq(tasks.opportunityId, opportunity.id)),
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunity.id)),
    ]);

    const updates = rows.filter(
      (row) =>
        (row.organizationId == null || row.organizationId === organizationId) &&
        row.status === "Upcoming" &&
        row.dueDate < getTodayDateOnly(),
    );
    for (const row of updates) {
      await db
        .update(reportingCalendar)
        .set({
          organizationId,
          status: "Overdue",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(reportingCalendar.id, row.id));
    }

    const finalRows: ReportingRecord[] =
      updates.length > 0
        ? await db
            .select()
            .from(reportingCalendar)
            .where(eq(reportingCalendar.opportunityId, opportunity.id))
            .orderBy(asc(reportingCalendar.dueDate))
        : rows;

    const reports = finalRows.map((row) => ({
      id: row.id,
      reportName: row.reportName,
      dueDate: row.dueDate,
      reportingPeriod: row.reportingPeriod,
      status: deriveStatus(row.status, row.dueDate),
      owner: row.owner,
      templateLink: row.templateLink,
      requiredMetrics: parseRequiredMetrics(row.requiredMetrics),
    }));
    const reportTemplateRequirements = requirementRows.filter(
      (row) => normalizeText(row.requirementType).toLowerCase() === "reporting template",
    );
    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));
    const reportTemplates = draftRows
      .filter((row) => reportTemplateRequirements.some((requirement) => requirement.id === row.requirementId))
      .map((row) => {
        const requirement = requirementById.get(row.requirementId);
        const reportName = normalizeText(requirement?.questionText).replace(/^Reporting template:\s*/i, "") || "Reporting template";
        const report = finalRows.find((entry) => normalizeText(entry.reportName) === normalizeText(reportName));
        return {
          reportId: report?.id ?? row.id,
          reportName,
          requirementId: row.requirementId,
          draftAnswerId: row.id,
          title: requirement?.questionText ?? reportingTemplateRequirementText(reportName),
          status: (normalizeText(row.status) as ReportingTemplateDraft["status"]) || "Drafting",
          templateLink: report?.templateLink ?? internalReportingTemplateHref(opportunity.id, report?.id ?? row.id),
        };
      });
    const milestoneTasks = taskRows
      .filter((task) =>
        /^(Collect reporting data|Milestone check-in|Draft report narrative):/i.test(task.description),
      )
      .sort((left, right) => (left.dueDate ?? "").localeCompare(right.dueDate ?? ""))
      .map((task) => ({
        id: task.id,
        title: task.description,
        status: task.status as ReportingMilestoneTask["status"],
        dueDate: task.dueDate,
        assignee: task.assignee,
      }));

    return {
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      opportunityStatus: opportunity.status,
      cadence: input.cadence ?? inferCadenceFromReports(reports.map((row) => row.reportName)),
      reports,
      summary: {
        total: reports.length,
        upcoming: reports.filter((row) => row.status === "Upcoming").length,
        inProgress: reports.filter((row) => row.status === "In Progress").length,
        submitted: reports.filter((row) => row.status === "Submitted").length,
        overdue: reports.filter((row) => row.status === "Overdue").length,
      },
      metricsToTrack: uniqueStrings(reports.flatMap((report) => report.requiredMetrics)),
      reportTemplates,
      milestoneTasks,
      notionWorkspaceUrl: null,
    };
  }

  async updateReport(input: UpdateReportingEntryInput): Promise<UpdateReportingEntryResult> {
    const [report] = await db
      .select()
      .from(reportingCalendar)
      .where(eq(reportingCalendar.id, input.reportId))
      .limit(1);
    if (!report) {
      throw new Error("No reporting entry exists for the provided reportId.");
    }

    const requestedOrganizationId = normalizeScopedText(input.organizationId) || null;
    const storedOrganizationId = normalizeScopedText(report.organizationId) || null;
    if (
      requestedOrganizationId &&
      storedOrganizationId &&
      requestedOrganizationId !== storedOrganizationId
    ) {
      throw new Error("Reporting entry does not belong to the requested organizationId.");
    }
    const { opportunity, organizationId } = await this.loadOpportunityContext({
      opportunityId: report.opportunityId,
      organizationId: requestedOrganizationId ?? storedOrganizationId,
      missingMessage: "No opportunity exists for the reporting entry.",
    });

    const nextStatus = input.status ?? deriveStatus(report.status, report.dueDate);
    const nextOwner = input.owner !== undefined ? normalizeText(input.owner) || null : report.owner;
    const nextTemplateLink =
      input.templateLink !== undefined ? normalizeText(input.templateLink) || null : report.templateLink;
    const nextMetrics =
      input.requiredMetrics !== undefined
        ? (input.requiredMetrics ?? []).map((item) => normalizeText(item)).filter(Boolean)
        : parseRequiredMetrics(report.requiredMetrics);
    const now = new Date().toISOString();

    await db
      .update(reportingCalendar)
      .set({
        organizationId,
        status: nextStatus,
        owner: nextOwner,
        templateLink: nextTemplateLink,
        requiredMetrics: serializeRequiredMetrics(nextMetrics),
        updatedAt: now,
      })
      .where(eq(reportingCalendar.id, report.id));

    const taskDescription = taskDescriptionForReport(report.reportName);
    const taskRows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.opportunityId, opportunity.id));
    const matchingTask =
      taskRows.find((task) => task.description === taskDescription) ?? null;
    if (matchingTask) {
      await db
        .update(tasks)
        .set({
          assignee: nextOwner,
          dueDate: report.dueDate,
          status: reportStatusToTaskStatus(nextStatus),
          updatedAt: now,
        })
        .where(eq(tasks.id, matchingTask.id));
    }

    await db.insert(agentLogs).values({
      id: randomUUID(),
      runId: randomUUID(),
      agentName: "reporting-workflow",
      actionDescription: "Updated reporting workflow entry",
      confidenceLevel: 0.97,
      outputSummary: `Updated ${report.reportName} for ${opportunity.title} to '${nextStatus}'.`,
      followUpRequired: nextStatus !== "Submitted",
      createdAt: now,
      updatedAt: now,
    });

    let notionSync: UpdateReportingEntryResult["notionSync"];
    if (input.syncToNotion && this.notionClient) {
      try {
        notionSync = await this.notionClient.syncReportingWorkflow({
          opportunityTitle: opportunity.title,
          reports: [
            {
              title: `${opportunity.title} - ${report.reportName}`,
              dueDate: report.dueDate,
              status: nextStatus,
              owner: nextOwner,
              reportingPeriod: report.reportingPeriod,
              templateLink: nextTemplateLink,
            },
          ],
          tasks: [
            {
              title: taskDescription,
              priority: "Medium",
              status: reportStatusToTaskStatus(nextStatus),
              dueDate: report.dueDate,
              assignee: nextOwner,
              blocking: reportStatusToTaskStatus(nextStatus) === "Blocked",
            },
          ],
        });
      } catch (error) {
        if (isNotionAuthorizationError(error)) {
          throw error;
        }
        this.logger.warn({ error }, "Skipping Notion sync for reporting workflow update");
      }
    }

    return {
      reportId: report.id,
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      reportName: report.reportName,
      dueDate: report.dueDate,
      status: nextStatus,
      owner: nextOwner,
      templateLink: nextTemplateLink,
      requiredMetrics: nextMetrics,
      notionSync,
    };
  }

  private async loadOpportunityContext(input: {
    opportunityId: string;
    organizationId?: string | null;
    missingMessage?: string;
  }) {
    const [opportunity] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, input.opportunityId))
      .limit(1);
    if (!opportunity) {
      throw new Error(input.missingMessage ?? "No opportunity exists for the provided opportunityId.");
    }

    const requestedOrganizationId = normalizeScopedText(input.organizationId) || null;
    const opportunityOrganizationId = normalizeScopedText(opportunity.organizationId) || null;
    if (
      requestedOrganizationId &&
      opportunityOrganizationId &&
      requestedOrganizationId !== opportunityOrganizationId
    ) {
      throw new Error("Opportunity does not belong to the requested organizationId.");
    }
    if (requestedOrganizationId && !opportunityOrganizationId) {
      throw new Error("Opportunity is not scoped to the requested organizationId.");
    }

    return {
      opportunity,
      organizationId: opportunityOrganizationId ?? requestedOrganizationId ?? null,
    };
  }

  private buildReportingTasks(input: {
    reportName: string;
    dueDate: string;
    owner?: string | null;
    status: ReportingStatus;
  }) {
    const dueDate = parseDateOnly(input.dueDate) ?? new Date();
    const baseStatus = reportStatusToTaskStatus(input.status);
    return [
      {
        title: `Collect reporting data: ${input.reportName}`,
        priority: "High" as const,
        status: input.status === "Submitted" ? ("Done" as const) : baseStatus,
        dueDate: formatDateOnly(addDays(dueDate, -30)),
        assignee: input.owner ?? null,
      },
      {
        title: `Milestone check-in: ${input.reportName}`,
        priority: "Medium" as const,
        status: input.status === "Submitted" ? ("Done" as const) : baseStatus,
        dueDate: formatDateOnly(addDays(dueDate, -14)),
        assignee: input.owner ?? null,
      },
      {
        title: `Draft report narrative: ${input.reportName}`,
        priority: "High" as const,
        status: baseStatus,
        dueDate: formatDateOnly(addDays(dueDate, -7)),
        assignee: input.owner ?? null,
      },
    ];
  }

  private async extractReportingCommitments(opportunityId: string): Promise<ReportingCommitments> {
    const [draftRows, requirementRows] = await Promise.all([
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunityId)),
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunityId)),
    ]);
    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));
    const sourceDrafts = draftRows.filter((draft) => {
      const requirement = requirementById.get(draft.requirementId);
      const type = normalizeText(requirement?.requirementType).toLowerCase();
      if (type === "reporting template") {
        return false;
      }
      if (draft.status === "Approved") {
        return true;
      }
      return draft.status === "Needs Review";
    });

    const sourceTexts = sourceDrafts
      .map((draft) => normalizeSentence(draft.draftText.replace(/\n?\n?UNSUPPORTED:\n[\s\S]*$/i, "")))
      .filter(Boolean);
    const evidenceCitations = uniqueStrings(
      sourceDrafts.flatMap((draft) => parseRequiredMetrics(draft.evidenceCitations)),
    );

    if (sourceTexts.length === 0) {
      return {
        metrics: evidenceCitations.slice(0, 5),
        outcomes: [],
        deliverables: [],
        evidenceCitations,
      };
    }

    if (this.geminiClient) {
      try {
        const parsed = await this.geminiClient.generateStructuredJson<{
          metrics?: unknown;
          outcomes?: unknown;
          deliverables?: unknown;
        }>({
          prompt: `
You extract reporting commitments from awarded nonprofit grant proposal drafts.
Return only JSON.

Rules:
- Use only language grounded in the provided proposal excerpts.
- Metrics should be concise measurable items to track over the grant period.
- Outcomes should be short promised result statements.
- Deliverables should be concrete activities or outputs the nonprofit promised.
- Keep each list to at most 6 items.

Proposal draft excerpts:
${sourceTexts.map((text, index) => `${index + 1}. ${text}`).join("\n")}
`.trim(),
          responseSchema: reportingCommitmentSchema,
          temperature: 0.1,
          maxOutputTokens: 500,
        });

        return {
          metrics: uniqueStrings(Array.isArray(parsed.metrics) ? parsed.metrics.map(String) : []).slice(0, 6),
          outcomes: uniqueStrings(Array.isArray(parsed.outcomes) ? parsed.outcomes.map(String) : []).slice(0, 6),
          deliverables: uniqueStrings(Array.isArray(parsed.deliverables) ? parsed.deliverables.map(String) : []).slice(0, 6),
          evidenceCitations,
        };
      } catch (error) {
        this.logger.warn({ error, opportunityId }, "Falling back to heuristic reporting extraction");
      }
    }

    const sentences = sourceTexts.flatMap((text) => splitIntoSentences(text));
    const pickSentences = (matcher: (sentence: string) => boolean, limit = 6) =>
      uniqueStrings(sentences.filter(matcher)).slice(0, limit);

    const metrics = pickSentences(
      (sentence) =>
        /\b\d+[%]?\b/.test(sentence) ||
        /\b(students|families|participants|served|growth|attendance|survey|outcomes?|benchmark|target)\b/i.test(sentence),
    );
    const outcomes = pickSentences(
      (sentence) =>
        /\b(improve|increase|grow|growth|reported|stronger|achieve|gain|outcome|results?)\b/i.test(sentence),
    );
    const deliverables = pickSentences(
      (sentence) =>
        /\b(workshops?|coaching|mentoring|tutoring|training|sessions?|support|activation|circles?|labs?)\b/i.test(sentence),
    );

    return {
      metrics: metrics.length > 0 ? metrics : evidenceCitations.slice(0, 6),
      outcomes,
      deliverables,
      evidenceCitations,
    };
  }

  private async seedReportingTemplates(input: {
    opportunity: OpportunityRecord;
    funder: typeof funders.$inferSelect;
    commitments: ReportingCommitments;
    reports: Array<{
      reportId: string;
      reportName: string;
      dueDate: string;
      reportingPeriod?: string | null;
      requiredMetrics: string[];
      owner?: string | null;
    }>;
  }) {
    const [requirementRows, existingDraftRows] = await Promise.all([
      db.select().from(requirements).where(eq(requirements.opportunityId, input.opportunity.id)),
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, input.opportunity.id)),
    ]);
    const requirementByQuestion = new Map(
      requirementRows.map((row) => [normalizeText(row.questionText).toLowerCase(), row]),
    );
    const draftByRequirementId = new Map(existingDraftRows.map((row) => [row.requirementId, row]));
    const grantDnaProfile = readStoredGrantDnaProfile({
      relationshipHistory: input.funder.relationshipHistory,
      grantDnaTopTerms: input.funder.grantDnaTopTerms,
      narrativeStyle: input.funder.narrativeStyle,
      toneNotes: input.funder.toneNotes,
    });
    const now = new Date().toISOString();
    const templates: ReportingTemplateDraft[] = [];

    for (const report of input.reports) {
      const requirementText = reportingTemplateRequirementText(report.reportName);
      const requirementKey = normalizeText(requirementText).toLowerCase();
      const existingRequirement = requirementByQuestion.get(requirementKey);
      const requirementId = existingRequirement?.id ?? randomUUID();

      if (existingRequirement) {
        await db
          .update(requirements)
          .set({
            requirementType: "Reporting Template",
            coverageStatus: "Green",
            reviewerNotes: "Seeded automatically from the awarded proposal commitments.",
            updatedAt: now,
          })
          .where(eq(requirements.id, existingRequirement.id));
      } else {
        await db.insert(requirements).values({
          id: requirementId,
          opportunityId: input.opportunity.id,
          questionText: requirementText,
          requirementType: "Reporting Template",
          wordLimit: null,
          characterLimit: null,
          coverageStatus: "Green",
          linkedEvidenceIds: null,
          draftAnswerId: null,
          reviewerNotes: "Seeded automatically from the awarded proposal commitments.",
          approvalStatus: "Drafting",
          createdAt: now,
          updatedAt: now,
        });
      }

      const draftText = this.composeReportTemplate({
        opportunityTitle: input.opportunity.title,
        reportName: report.reportName,
        dueDate: report.dueDate,
        reportingPeriod: report.reportingPeriod,
        commitments: {
          ...input.commitments,
          metrics: report.requiredMetrics.length > 0 ? report.requiredMetrics : input.commitments.metrics,
        },
      });
      const alignment = computeGrantDnaAlignment({
        profile: grantDnaProfile,
        draftText,
      });
      const revisionNotes = JSON.stringify({
        dnaSuggestions: alignment.suggestions,
      });
      const existingDraft = draftByRequirementId.get(requirementId);

      if (existingDraft) {
        await db
          .update(draftAnswers)
          .set({
            draftText,
            wordCount: normalizeText(draftText).split(/\s+/).filter(Boolean).length,
            evidenceCitations: JSON.stringify(input.commitments.evidenceCitations),
            unsupportedClaims: JSON.stringify([]),
            status: "Drafting",
            reviewerComments: "Seeded report template from the awarded proposal commitments.",
            revisionNotes,
            dnaMatchScore: alignment.score,
            updatedAt: now,
          })
          .where(eq(draftAnswers.id, existingDraft.id));
        templates.push({
          reportId: report.reportId,
          reportName: report.reportName,
          requirementId,
          draftAnswerId: existingDraft.id,
          title: requirementText,
          status: "Drafting",
          templateLink: internalReportingTemplateHref(input.opportunity.id, report.reportId),
        });
      } else {
        const draftId = randomUUID();
        await db.insert(draftAnswers).values({
          id: draftId,
          opportunityId: input.opportunity.id,
          requirementId,
          draftText,
          wordCount: normalizeText(draftText).split(/\s+/).filter(Boolean).length,
          evidenceCitations: JSON.stringify(input.commitments.evidenceCitations),
          unsupportedClaims: JSON.stringify([]),
          status: "Drafting",
          reviewerComments: "Seeded report template from the awarded proposal commitments.",
          revisionNotes,
          dnaMatchScore: alignment.score,
          createdAt: now,
          updatedAt: now,
        });
        templates.push({
          reportId: report.reportId,
          reportName: report.reportName,
          requirementId,
          draftAnswerId: draftId,
          title: requirementText,
          status: "Drafting",
          templateLink: internalReportingTemplateHref(input.opportunity.id, report.reportId),
        });
      }
    }

    return templates;
  }

  private composeReportTemplate(input: {
    opportunityTitle: string;
    reportName: string;
    dueDate: string;
    reportingPeriod?: string | null;
    commitments: ReportingCommitments;
  }) {
    const metricLines = (input.commitments.metrics.length > 0
      ? input.commitments.metrics
      : ["Add the agreed metrics before drafting the live report."]
    )
      .map((metric) => `- ${metric}`)
      .join("\n");
    const outcomeLines = (input.commitments.outcomes.length > 0
      ? input.commitments.outcomes
      : ["Summarize the outcomes promised in the proposal and update them with award-period results."]
    )
      .map((outcome) => `- ${outcome}`)
      .join("\n");
    const deliverableLines = (input.commitments.deliverables.length > 0
      ? input.commitments.deliverables
      : ["Confirm which core activities or deliverables were completed in this reporting period."]
    )
      .map((deliverable) => `- ${deliverable}`)
      .join("\n");
    const evidenceLine =
      input.commitments.evidenceCitations.length > 0
        ? input.commitments.evidenceCitations.join(", ")
        : "Link the supporting evidence items and fresh monitoring data before submission.";

    return [
      `${input.reportName} template for ${input.opportunityTitle}.`,
      `Reporting period: ${input.reportingPeriod ?? "Confirm the award period in Notion."}`,
      `Due date: ${input.dueDate}.`,
      "",
      "Promised outcomes to address:",
      outcomeLines,
      "",
      "Metrics to update:",
      metricLines,
      "",
      "Deliverables and milestones to confirm:",
      deliverableLines,
      "",
      `Evidence to reference: ${evidenceLine}.`,
      "Replace these placeholders with actual award-period results before marking the report submitted.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async syncReportingTemplatesToNotion(opportunityId: string, opportunityTitle: string) {
    if (!this.notionClient) {
      return undefined;
    }

    const [draftRows, requirementRows] = await Promise.all([
      db.select().from(draftAnswers).where(eq(draftAnswers.opportunityId, opportunityId)),
      db.select().from(requirements).where(eq(requirements.opportunityId, opportunityId)),
    ]);
    const requirementById = new Map(requirementRows.map((row) => [row.id, row]));

    return this.notionClient.syncDraftAnswers({
      opportunityId,
      opportunityTitle,
      drafts: draftRows.map((draft) => ({
        requirementText: requirementById.get(draft.requirementId)?.questionText ?? "Requirement",
        status: (normalizeText(draft.status) as "Not Started" | "Drafting" | "Needs Review" | "Approved") || "Drafting",
        draftText: draft.draftText,
        evidenceCitations: parseRequiredMetrics(draft.evidenceCitations),
        dnaMatchPercent: draft.dnaMatchScore ?? 0,
        unsupportedClaims: parseRequiredMetrics(draft.unsupportedClaims),
      })),
    });
  }
}

const inferCadenceFromReports = (reportNames: string[]): ReportingCadence | null => {
  if (reportNames.includes("Quarter 3 Report")) {
    return "Quarterly + Final";
  }
  if (reportNames.includes("Midpoint Report")) {
    return "Semiannual + Final";
  }
  if (reportNames.includes("Final Report")) {
    return "Final Only";
  }
  return null;
};
