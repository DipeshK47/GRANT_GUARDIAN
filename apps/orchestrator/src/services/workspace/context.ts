import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.js";
import { budgets, evidenceLibrary, organizations, programs } from "../../db/schema.js";
import type {
  NotionBudgetSyncInput,
  NotionEvidenceLibrarySyncInput,
  NotionMcpClient,
  NotionProgramSyncInput,
} from "../notion/client.js";

type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
  error: (payload: unknown, message?: string) => void;
};

type ScopedOrganization = typeof organizations.$inferSelect;
type ProgramRow = typeof programs.$inferSelect;
type EvidenceRow = typeof evidenceLibrary.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;

export type ProgramRecord = {
  id: string;
  organizationId: string;
  name: string;
  description?: string | null;
  targetPopulation?: string | null;
  geography?: string | null;
  theoryOfChange?: string | null;
  status?: string | null;
  keyOutcomes?: string | null;
  programBudget?: number | null;
  programLead?: string | null;
  fundingHistory?: string | null;
  updatedAt: string;
};

export type EvidenceRecord = {
  id: string;
  programId: string;
  programName: string;
  title: string;
  evidenceType: string;
  content: string;
  sourceDocument?: string | null;
  collectedAt?: string | null;
  reliabilityRating?: number | null;
  tags?: string | null;
  updatedAt: string;
};

export type BudgetRecord = {
  id: string;
  programId: string;
  programName: string;
  name: string;
  fiscalYear?: number | null;
  budgetType: string;
  lineItems?: string | null;
  totalRevenue?: number | null;
  totalExpense?: number | null;
  restrictedVsUnrestricted?: string | null;
  updatedAt: string;
};

export type ProgramListResult = {
  programs: ProgramRecord[];
};

export type EvidenceListResult = {
  evidence: EvidenceRecord[];
};

export type BudgetListResult = {
  budgets: BudgetRecord[];
};

export type SaveProgramInput = {
  programId?: string;
  organizationId: string;
  clerkUserId?: string | null;
  name: string;
  description?: string | null;
  targetPopulation?: string | null;
  geography?: string | null;
  theoryOfChange?: string | null;
  status?: string | null;
  keyOutcomes?: string | null;
  programBudget?: number | null;
  programLead?: string | null;
  fundingHistory?: string | null;
  syncToNotion?: boolean;
};

export type SaveEvidenceInput = {
  evidenceId?: string;
  organizationId: string;
  clerkUserId?: string | null;
  programId: string;
  title: string;
  evidenceType: string;
  content: string;
  sourceDocument?: string | null;
  collectedAt?: string | null;
  reliabilityRating?: number | null;
  tags?: string | null;
  syncToNotion?: boolean;
};

export type SaveBudgetInput = {
  budgetId?: string;
  organizationId: string;
  clerkUserId?: string | null;
  programId: string;
  name: string;
  fiscalYear?: number | null;
  budgetType: string;
  lineItems?: string | null;
  totalRevenue?: number | null;
  totalExpense?: number | null;
  restrictedVsUnrestricted?: string | null;
  syncToNotion?: boolean;
};

export type SaveProgramResult = {
  created: boolean;
  program: ProgramRecord;
  notionSync?: {
    programPageId: string;
  };
};

export type SaveEvidenceResult = {
  created: boolean;
  evidence: EvidenceRecord;
  notionSync?: {
    evidencePageId: string;
  };
};

export type SaveBudgetResult = {
  created: boolean;
  budget: BudgetRecord;
  notionSync?: {
    budgetPageId: string;
  };
};

const normalizeText = (value?: string | null) => (value ?? "").replace(/\s+/g, " ").trim();

const toProgramRecord = (row: ProgramRow): ProgramRecord => ({
  id: row.id,
  organizationId: row.organizationId,
  name: row.name,
  description: row.description,
  targetPopulation: row.targetPopulation,
  geography: row.geography,
  theoryOfChange: row.theoryOfChange,
  status: row.status,
  keyOutcomes: row.keyOutcomes,
  programBudget: row.programBudget,
  programLead: row.programLead,
  fundingHistory: row.fundingHistory,
  updatedAt: row.updatedAt,
});

const toEvidenceRecord = (row: EvidenceRow, programName: string): EvidenceRecord => ({
  id: row.id,
  programId: row.programId ?? "",
  programName,
  title: row.title,
  evidenceType: row.evidenceType,
  content: row.content,
  sourceDocument: row.sourceDocument,
  collectedAt: row.collectedAt,
  reliabilityRating: row.reliabilityRating,
  tags: row.tags,
  updatedAt: row.updatedAt,
});

const toBudgetRecord = (row: BudgetRow, programName: string): BudgetRecord => ({
  id: row.id,
  programId: row.programId ?? "",
  programName,
  name: row.name,
  fiscalYear: row.fiscalYear,
  budgetType: row.budgetType,
  lineItems: row.lineItems,
  totalRevenue: row.totalRevenue,
  totalExpense: row.totalExpense,
  restrictedVsUnrestricted: row.restrictedVsUnrestricted,
  updatedAt: row.updatedAt,
});

const toProgramPriority = (status?: string | null) => {
  const normalized = normalizeText(status).toLowerCase();
  if (!normalized) {
    return "High";
  }

  if (normalized.includes("critical")) {
    return "Critical";
  }
  if (normalized.includes("low")) {
    return "Low";
  }
  if (normalized.includes("medium")) {
    return "Medium";
  }

  return "High";
};

export class WorkspaceContextService {
  private readonly notionClient?: NotionMcpClient;
  private readonly logger: LoggerLike;

  constructor(notionClient?: NotionMcpClient, logger?: Partial<LoggerLike>) {
    this.notionClient = notionClient;
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

  async listPrograms(input: {
    organizationId: string;
    clerkUserId?: string | null;
  }): Promise<ProgramListResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const rows = await db
      .select()
      .from(programs)
      .where(eq(programs.organizationId, organization.id))
      .orderBy(desc(programs.updatedAt), asc(programs.name));

    return {
      programs: rows.map(toProgramRecord),
    };
  }

  async saveProgram(input: SaveProgramInput): Promise<SaveProgramResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const name = normalizeText(input.name);
    if (!name) {
      throw new Error("Program save requires a name.");
    }

    const now = new Date().toISOString();
    const existing = input.programId
      ? await this.requireProgram(input.programId, organization.id)
      : null;

    const values = {
      organizationId: organization.id,
      name,
      description: normalizeText(input.description) || null,
      targetPopulation: normalizeText(input.targetPopulation) || null,
      geography: normalizeText(input.geography) || null,
      theoryOfChange: normalizeText(input.theoryOfChange) || null,
      status: normalizeText(input.status) || null,
      keyOutcomes: normalizeText(input.keyOutcomes) || null,
      programBudget: input.programBudget ?? null,
      programLead: normalizeText(input.programLead) || null,
      fundingHistory: normalizeText(input.fundingHistory) || null,
      updatedAt: now,
    } satisfies Partial<ProgramRow>;

    let row: ProgramRow;
    if (existing) {
      await db.update(programs).set(values).where(eq(programs.id, existing.id));
      row = { ...existing, ...values } as ProgramRow;
    } else {
      const [inserted] = await db
        .insert(programs)
        .values(values)
        .returning();
      if (!inserted) {
        throw new Error("Failed to persist the program.");
      }
      row = inserted;
    }

    const notionSync =
      input.syncToNotion && this.notionClient
        ? await this.notionClient.syncProgramRecord(
            this.toNotionProgramSyncInput(organization, row),
          )
        : undefined;

    this.logger.info(
      {
        organizationId: organization.id,
        programId: row.id,
        syncToNotion: Boolean(notionSync),
      },
      "Workspace program saved",
    );

    return {
      created: !existing,
      program: toProgramRecord(row),
      notionSync,
    };
  }

  async listEvidence(input: {
    organizationId: string;
    clerkUserId?: string | null;
  }): Promise<EvidenceListResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const programRows = await db
      .select()
      .from(programs)
      .where(eq(programs.organizationId, organization.id))
      .orderBy(asc(programs.name));
    const programMap = new Map(programRows.map((row) => [row.id, row]));
    const programIds = programRows.map((row) => row.id);

    if (programIds.length === 0) {
      return { evidence: [] };
    }

    const rows = await db
      .select()
      .from(evidenceLibrary)
      .where(inArray(evidenceLibrary.programId, programIds))
      .orderBy(desc(evidenceLibrary.updatedAt), asc(evidenceLibrary.title));

    return {
      evidence: rows
        .map((row) => {
          const program = row.programId ? programMap.get(row.programId) : null;
          return program ? toEvidenceRecord(row, program.name) : null;
        })
        .filter((row): row is EvidenceRecord => Boolean(row)),
    };
  }

  async saveEvidence(input: SaveEvidenceInput): Promise<SaveEvidenceResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const program = await this.requireProgram(input.programId, organization.id);
    const title = normalizeText(input.title);
    const evidenceType = normalizeText(input.evidenceType);
    const content = normalizeText(input.content);

    if (!title) {
      throw new Error("Evidence save requires a title.");
    }
    if (!evidenceType) {
      throw new Error("Evidence save requires an evidenceType.");
    }
    if (!content) {
      throw new Error("Evidence save requires content.");
    }

    const now = new Date().toISOString();
    const existing = input.evidenceId
      ? await this.requireEvidence(input.evidenceId, program.id)
      : null;

    const values = {
      programId: program.id,
      title,
      evidenceType,
      content,
      sourceDocument: normalizeText(input.sourceDocument) || null,
      collectedAt: normalizeText(input.collectedAt) || null,
      reliabilityRating: input.reliabilityRating ?? null,
      tags: normalizeText(input.tags) || null,
      updatedAt: now,
    } satisfies Partial<EvidenceRow>;

    let row: EvidenceRow;
    if (existing) {
      await db.update(evidenceLibrary).set(values).where(eq(evidenceLibrary.id, existing.id));
      row = { ...existing, ...values } as EvidenceRow;
    } else {
      const [inserted] = await db.insert(evidenceLibrary).values(values).returning();
      if (!inserted) {
        throw new Error("Failed to persist the evidence record.");
      }
      row = inserted;
    }

    const notionSync =
      input.syncToNotion && this.notionClient
        ? await this.notionClient.syncEvidenceLibraryEntry(
            this.toNotionEvidenceSyncInput(program, row),
          )
        : undefined;

    this.logger.info(
      {
        organizationId: organization.id,
        programId: program.id,
        evidenceId: row.id,
        syncToNotion: Boolean(notionSync),
      },
      "Workspace evidence saved",
    );

    return {
      created: !existing,
      evidence: toEvidenceRecord(row, program.name),
      notionSync,
    };
  }

  async listBudgets(input: {
    organizationId: string;
    clerkUserId?: string | null;
  }): Promise<BudgetListResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const programRows = await db
      .select()
      .from(programs)
      .where(eq(programs.organizationId, organization.id))
      .orderBy(asc(programs.name));
    const programMap = new Map(programRows.map((row) => [row.id, row]));
    const programIds = programRows.map((row) => row.id);

    if (programIds.length === 0) {
      return { budgets: [] };
    }

    const rows = await db
      .select()
      .from(budgets)
      .where(inArray(budgets.programId, programIds))
      .orderBy(desc(budgets.updatedAt), asc(budgets.name));

    return {
      budgets: rows
        .map((row) => {
          const program = row.programId ? programMap.get(row.programId) : null;
          return program ? toBudgetRecord(row, program.name) : null;
        })
        .filter((row): row is BudgetRecord => Boolean(row)),
    };
  }

  async saveBudget(input: SaveBudgetInput): Promise<SaveBudgetResult> {
    const organization = await this.requireOrganization(input.organizationId, input.clerkUserId);
    const program = await this.requireProgram(input.programId, organization.id);
    const name = normalizeText(input.name);
    const budgetType = normalizeText(input.budgetType);

    if (!name) {
      throw new Error("Budget save requires a name.");
    }
    if (!budgetType) {
      throw new Error("Budget save requires a budgetType.");
    }

    const now = new Date().toISOString();
    const existing = input.budgetId
      ? await this.requireBudget(input.budgetId, program.id)
      : null;

    const values = {
      programId: program.id,
      name,
      fiscalYear: input.fiscalYear ?? null,
      budgetType,
      lineItems: normalizeText(input.lineItems) || null,
      totalRevenue: input.totalRevenue ?? null,
      totalExpense: input.totalExpense ?? null,
      restrictedVsUnrestricted: normalizeText(input.restrictedVsUnrestricted) || null,
      updatedAt: now,
    } satisfies Partial<BudgetRow>;

    let row: BudgetRow;
    if (existing) {
      await db.update(budgets).set(values).where(eq(budgets.id, existing.id));
      row = { ...existing, ...values } as BudgetRow;
    } else {
      const [inserted] = await db.insert(budgets).values(values).returning();
      if (!inserted) {
        throw new Error("Failed to persist the budget.");
      }
      row = inserted;
    }

    const notionSync =
      input.syncToNotion && this.notionClient
        ? await this.notionClient.syncBudgetEntry(
            this.toNotionBudgetSyncInput(program, row),
          )
        : undefined;

    this.logger.info(
      {
        organizationId: organization.id,
        programId: program.id,
        budgetId: row.id,
        syncToNotion: Boolean(notionSync),
      },
      "Workspace budget saved",
    );

    return {
      created: !existing,
      budget: toBudgetRecord(row, program.name),
      notionSync,
    };
  }

  private async requireOrganization(organizationId: string, clerkUserId?: string | null) {
    const normalizedOrganizationId = normalizeText(organizationId);
    if (!normalizedOrganizationId) {
      throw new Error("Workspace context requires an organizationId.");
    }

    const normalizedClerkUserId = normalizeText(clerkUserId) || null;
    const [organization] = await db
      .select()
      .from(organizations)
      .where(
        normalizedClerkUserId
          ? and(
              eq(organizations.id, normalizedOrganizationId),
              eq(organizations.clerkUserId, normalizedClerkUserId),
            )
          : eq(organizations.id, normalizedOrganizationId),
      )
      .limit(1);

    if (!organization) {
      throw new Error("Organization is not scoped to the current Clerk user.");
    }

    return organization;
  }

  private async requireProgram(programId: string, organizationId: string) {
    const normalizedProgramId = normalizeText(programId);
    if (!normalizedProgramId) {
      throw new Error("Program save requires a programId.");
    }

    const [program] = await db
      .select()
      .from(programs)
      .where(
        and(eq(programs.id, normalizedProgramId), eq(programs.organizationId, organizationId)),
      )
      .limit(1);

    if (!program) {
      throw new Error("Program is not scoped to the selected organization.");
    }

    return program;
  }

  private async requireEvidence(evidenceId: string, programId: string) {
    const normalizedEvidenceId = normalizeText(evidenceId);
    const [evidence] = await db
      .select()
      .from(evidenceLibrary)
      .where(
        and(
          eq(evidenceLibrary.id, normalizedEvidenceId),
          eq(evidenceLibrary.programId, programId),
        ),
      )
      .limit(1);

    if (!evidence) {
      throw new Error("Evidence record is not scoped to the selected program.");
    }

    return evidence;
  }

  private async requireBudget(budgetId: string, programId: string) {
    const normalizedBudgetId = normalizeText(budgetId);
    const [budget] = await db
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, normalizedBudgetId), eq(budgets.programId, programId)))
      .limit(1);

    if (!budget) {
      throw new Error("Budget record is not scoped to the selected program.");
    }

    return budget;
  }

  private toNotionProgramSyncInput(
    organization: ScopedOrganization,
    program: ProgramRow,
  ): NotionProgramSyncInput {
    return {
      organizationName: organization.legalName,
      programName: program.name,
      targetPopulation: program.targetPopulation ?? null,
      geography: program.geography ?? null,
      goals: program.description || program.theoryOfChange || null,
      outcomes: program.keyOutcomes || program.description || null,
      metrics: program.theoryOfChange || program.fundingHistory || null,
      programBudget: program.programBudget ?? null,
      programLead: program.programLead ?? null,
      strategicPriority: toProgramPriority(program.status),
    };
  }

  private toNotionEvidenceSyncInput(
    program: ProgramRow,
    evidence: EvidenceRow,
  ): NotionEvidenceLibrarySyncInput {
    return {
      programName: program.name,
      evidenceTitle: evidence.title,
      evidenceType: evidence.evidenceType,
      summary: evidence.content,
      metrics: evidence.content,
      geography: program.geography ?? null,
      sourceDocument: evidence.sourceDocument ?? null,
      qualityScore: evidence.reliabilityRating ?? null,
      reusabilityScore:
        typeof evidence.reliabilityRating === "number" && evidence.reliabilityRating >= 0.8
          ? "High"
          : typeof evidence.reliabilityRating === "number" && evidence.reliabilityRating >= 0.5
            ? "Medium"
            : null,
      collectedAt: evidence.collectedAt ?? null,
      tags: evidence.tags ?? null,
    };
  }

  private toNotionBudgetSyncInput(
    program: ProgramRow,
    budget: BudgetRow,
  ): NotionBudgetSyncInput {
    return {
      programName: program.name,
      budgetName: budget.name,
      fiscalYear: budget.fiscalYear ?? null,
      budgetType: budget.budgetType,
      totalRevenue: budget.totalRevenue ?? null,
      totalExpense: budget.totalExpense ?? null,
      notes: budget.lineItems || budget.restrictedVsUnrestricted || null,
    };
  }
}
