import { z } from "zod";
import {
  coverageStatuses,
  opportunityStatuses,
  pursueDecisions,
  reviewStatuses,
} from "../constants/status.js";

export const organizationSchema = z.object({
  legalName: z.string().min(1),
  ein: z.string().min(1),
  mission: z.string().min(1),
  annualBudget: z.number().nullable().optional(),
  executiveDirector: z.string().optional(),
  grantsContact: z.string().optional(),
});

export const programSchema = z.object({
  name: z.string().min(1),
  targetPopulation: z.string().optional(),
  geography: z.string().optional(),
  keyOutcomes: z.string().optional(),
  programBudget: z.number().nullable().optional(),
});

export const funderSchema = z.object({
  name: z.string().min(1),
  ein: z.string().optional(),
  website: z.string().url().optional(),
  averageGrant: z.number().nullable().optional(),
  medianGrant: z.number().nullable().optional(),
  geographicFocus: z.string().optional(),
  grantDnaTopTerms: z.string().optional(),
});

export const opportunitySchema = z.object({
  title: z.string().min(1),
  funderId: z.string().min(1),
  status: z.enum(opportunityStatuses),
  fitScore: z.number().min(0).max(100).nullable().optional(),
  pursueDecision: z.enum(pursueDecisions).nullable().optional(),
  evidenceCoveragePercent: z.number().min(0).max(100).nullable().optional(),
  effortEstimateHours: z.number().min(0).nullable().optional(),
  reportingBurdenScore: z.number().min(0).max(100).nullable().optional(),
});

export const requirementSchema = z.object({
  opportunityId: z.string().min(1),
  questionText: z.string().min(1),
  coverageStatus: z.enum(coverageStatuses),
  wordLimit: z.number().nullable().optional(),
});

export const draftAnswerSchema = z.object({
  opportunityId: z.string().min(1),
  requirementId: z.string().min(1),
  draftText: z.string().min(1),
  dnaMatchScore: z.number().min(0).max(100).nullable().optional(),
});

export const reviewSchema = z.object({
  opportunityId: z.string().min(1),
  reviewer: z.string().min(1),
  status: z.enum(reviewStatuses),
  reviewType: z.string().min(1),
});

export const workflowRunSchema = z.object({
  runId: z.string().min(1),
  agentName: z.string().min(1),
  actionDescription: z.string().min(1),
  confidenceLevel: z.number().min(0).max(1).optional(),
});

