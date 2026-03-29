import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  agentLogs,
  budgets,
  documents,
  evidenceLibrary,
  funders,
  lessons,
  organizations,
  programs,
} from "../../db/schema.js";
import type { NotionMcpClient } from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

export type DemoSeedInput = {
  force?: boolean;
  syncToNotion?: boolean;
};

export type DemoSeedSummary = {
  createdAt: string;
  organizationId?: string;
  programIds: string[];
  evidenceIds: string[];
  documentIds: string[];
  budgetIds: string[];
  funderIds: string[];
  lessonIds: string[];
  notionSeeded: boolean;
  notionSummary?: unknown;
};

export class DemoSeedService {
  private readonly logger: LoggerLike;

  constructor(
    private readonly notionClient?: NotionMcpClient,
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

  async seed(input: DemoSeedInput = {}) {
    const [existingOrganization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.legalName, "Bright Path Youth Collective"))
      .limit(1);

    let summary: DemoSeedSummary;

    if (existingOrganization && !input.force) {
      summary = await this.loadExistingSummary(existingOrganization.id);
    } else {
      summary = await this.seedLocalDatabase();
    }

    if (input.syncToNotion && this.notionClient) {
      try {
        const notionResult = await this.notionClient.seedDemoContent({
          force: input.force,
        });
        summary.notionSeeded = true;
        summary.notionSummary = notionResult.summary;
      } catch (error) {
        this.logger.warn(
          { error: this.serializeError(error) },
          "Skipping Notion demo seed because the workspace is not ready yet",
        );
      }
    }

    return summary;
  }

  private serializeError(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return error;
  }

  private async loadExistingSummary(organizationId: string): Promise<DemoSeedSummary> {
    const existingPrograms = await db
      .select({ id: programs.id })
      .from(programs)
      .where(eq(programs.organizationId, organizationId));

    const programIds = existingPrograms.map((program) => program.id);
    const existingEvidence =
      programIds.length > 0
        ? await db
            .select({ id: evidenceLibrary.id })
            .from(evidenceLibrary)
            .where(inArray(evidenceLibrary.programId, programIds))
        : [];
    const existingBudgets = await db.select({ id: budgets.id }).from(budgets);

    const existingDocuments = await db.select({ id: documents.id }).from(documents);
    const existingFunders = await db.select({ id: funders.id }).from(funders);
    const funderIds = existingFunders.map((funder) => funder.id);
    const existingLessons =
      funderIds.length > 0
        ? await db
            .select({ id: lessons.id })
            .from(lessons)
            .where(
              and(
                inArray(lessons.funderId, funderIds),
                eq(lessons.organizationId, organizationId),
              ),
            )
        : [];

    return {
      createdAt: new Date().toISOString(),
      organizationId,
      programIds,
      evidenceIds: existingEvidence.map((record) => record.id),
      documentIds: existingDocuments.map((record) => record.id),
      budgetIds: existingBudgets.map((record) => record.id),
      funderIds,
      lessonIds: existingLessons.map((record) => record.id),
      notionSeeded: false,
    };
  }

  private async seedLocalDatabase(): Promise<DemoSeedSummary> {
    const createdAt = new Date().toISOString();
    const organizationId = randomUUID();
    const readingProgramId = randomUUID();
    const familyProgramId = randomUUID();
    const evidenceIds = [randomUUID(), randomUUID(), randomUUID()] as const;
    const documentIds = [randomUUID(), randomUUID(), randomUUID()] as const;
    const budgetIds = [randomUUID(), randomUUID()] as const;
    const funderIds = [randomUUID(), randomUUID()] as const;
    const lessonId = randomUUID();

    await db.insert(organizations).values({
      id: organizationId,
      legalName: "Bright Path Youth Collective",
      dbaName: "Bright Path",
      ein: "12-3456789",
      foundedYear: 2018,
      mission:
        "Bright Path Youth Collective equips low-income middle-school students with literacy, mentoring, and family support.",
      annualBudget: 420000,
      staffCount: 8,
      volunteerCount: 28,
      executiveDirector: "Ava Thompson",
      grantsContact: "Maya Patel",
      boardChair: "Jordan Lee",
      address: "Atlanta, Georgia",
      website: "https://brightpathyouth.example.org",
      phone: "(404) 555-0100",
      serviceArea: "Atlanta and Dekalb County",
      programSummary:
        "Year-round literacy acceleration, mentoring, and family engagement programming.",
    });

    await db.insert(programs).values([
      {
        id: readingProgramId,
        organizationId,
        name: "Reading Acceleration Lab",
        description: "Small-group literacy tutoring and mentoring.",
        targetPopulation: "Middle-school students reading below grade level",
        geography: "Atlanta",
        status: "Active",
        keyOutcomes: "1.2+ grade-level literacy growth",
        programBudget: 160000,
        programLead: "Nia Brooks",
      },
      {
        id: familyProgramId,
        organizationId,
        name: "Family Learning Circles",
        description: "Workshops and coaching for caregivers.",
        targetPopulation: "Parents and caregivers of enrolled students",
        geography: "Atlanta, Dekalb County",
        status: "Active",
        keyOutcomes: "Consistent home reading routines and stronger caregiver confidence",
        programBudget: 78000,
        programLead: "Luis Romero",
      },
    ]);

    await db.insert(evidenceLibrary).values([
      {
        id: evidenceIds[0],
        programId: readingProgramId,
        title: "2025 literacy growth outcomes",
        evidenceType: "Metric",
        content:
          "Across 86 students, median reading growth reached 1.3 grade levels during FY25.",
        sourceDocument: "FY25 Reading Outcomes Memo",
        collectedAt: "2025-12-15",
        reliabilityRating: 0.92,
        tags: "literacy,outcomes,evaluation",
      },
      {
        id: evidenceIds[1],
        programId: familyProgramId,
        title: "Caregiver survey results",
        evidenceType: "Outcome",
        content:
          "92% of caregivers reported stronger weekly literacy routines after Family Learning Circles.",
        sourceDocument: "Family Learning Circles Survey Summary",
        collectedAt: "2025-11-10",
        reliabilityRating: 0.88,
        tags: "family engagement,survey",
      },
      {
        id: evidenceIds[2],
        programId: readingProgramId,
        title: "Student confidence testimonial",
        evidenceType: "Testimonial",
        content:
          "A sixth-grade student shared that mentoring support helped them read aloud in class for the first time.",
        sourceDocument: "Student Story Bank",
        collectedAt: "2025-10-01",
        reliabilityRating: 0.75,
        tags: "testimonials,mentoring",
      },
    ]);

    await db.insert(documents).values([
      {
        id: documentIds[0],
        organizationId,
        name: "IRS 501(c)(3) Determination Letter",
        documentType: "501(c)(3)",
        uploadStatus: "Ready",
        owner: "Maya Patel",
      },
      {
        id: documentIds[1],
        organizationId,
        name: "FY26 Organizational Budget",
        documentType: "Budget",
        uploadStatus: "Ready",
        owner: "Luis Romero",
      },
      {
        id: documentIds[2],
        organizationId,
        name: "Board of Directors Roster",
        documentType: "Board List",
        uploadStatus: "Ready",
        owner: "Maya Patel",
      },
    ]);

    await db.insert(budgets).values([
      {
        id: budgetIds[0],
        programId: readingProgramId,
        name: "FY26 Reading Acceleration Lab Budget",
        fiscalYear: 2026,
        budgetType: "Program",
        totalRevenue: 160000,
        totalExpense: 160000,
        restrictedVsUnrestricted: "Mixed",
      },
      {
        id: budgetIds[1],
        name: "FY26 Organizational Budget",
        fiscalYear: 2026,
        budgetType: "Organizational",
        totalRevenue: 420000,
        totalExpense: 420000,
        restrictedVsUnrestricted: "Mixed",
      },
    ]);

    await db.insert(funders).values([
      {
        id: funderIds[0],
        name: "North Star Family Foundation",
        website: "https://northstarfamily.example.org",
        givingSummary:
          "Historically funds small youth-literacy nonprofits and family support organizations in the Southeast.",
        averageGrant: 65000,
        medianGrant: 50000,
        geographicFocus: "Georgia,Southeast",
        grantDnaTopTerms:
          "community-led,literacy gains,family partnership,measurable outcomes",
      },
      {
        id: funderIds[1],
        name: "North Star Learning Fund",
        website: "https://northstarlearning.example.org",
        givingSummary:
          "Prioritizes systems-change education work, larger national grants, and heavier evaluation rigor at scale.",
        averageGrant: 180000,
        medianGrant: 150000,
        geographicFocus: "National",
        grantDnaTopTerms:
          "systems change,evidence-based,catalytic investment,scale",
      },
    ]);

    await db.insert(lessons).values({
      id: lessonId,
      organizationId,
      funderId: funderIds[1],
      feedbackText:
        "Reviewer noted that Bright Path's evaluation methodology was promising but lacked long-term comparison data.",
      themes: "Evaluation Weakness,Capacity Concerns",
      recommendations:
        "Strengthen evaluation answer with benchmark data and a clearer plan for longitudinal tracking.",
      appliesNextCycle: true,
    });

    await db.insert(agentLogs).values({
      runId: randomUUID(),
      agentName: "System",
      actionDescription: "Seeded demo nonprofit baseline records",
      outputSummary:
        "Created organization, programs, evidence, documents, budgets, funders, and one lesson record for local development.",
      confidenceLevel: 1,
      followUpRequired: false,
    });

    return {
      createdAt,
      organizationId,
      programIds: [readingProgramId, familyProgramId],
      evidenceIds: [...evidenceIds],
      documentIds: [...documentIds],
      budgetIds: [...budgetIds],
      funderIds: [...funderIds],
      lessonIds: [lessonId],
      notionSeeded: false,
    };
  }
}
