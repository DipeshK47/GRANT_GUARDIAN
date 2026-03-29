import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { withRequestContext } from "./lib/request-context.js";
import { getClerkUserIdFromRequest } from "./lib/request-auth.js";
import { registerDemoRoutes } from "./routes/demo.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerFunderRoutes } from "./routes/funders.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIntakeRoutes } from "./routes/intake.js";
import { registerLessonRoutes } from "./routes/lessons.js";
import { registerNotionRoutes } from "./routes/notion.js";
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerOrganizationRoutes } from "./routes/organizations.js";
import { registerOpportunityRoutes } from "./routes/opportunities.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerReportingRoutes } from "./routes/reporting.js";
import { registerWorkspaceContextRoutes } from "./routes/workspace-context.js";
import { DemoSeedService } from "./services/demo/seed.js";
import { DocumentVaultService } from "./services/documents/vault.js";
import { FunderContrastService } from "./services/funders/contrast.js";
import { FunderFilingParsingService } from "./services/funders/filing-parser.js";
import { FunderIntelligenceService } from "./services/funders/intelligence.js";
import { GeminiClient } from "./services/gemini/client.js";
import { OpportunityIntakeService } from "./services/intake/opportunity.js";
import { NotionMcpClient } from "./services/notion/client.js";
import { NotionWorkspaceSyncService } from "./services/notion/workspace-sync.js";
import { OpportunityAnalysisService } from "./services/opportunities/analysis.js";
import { OpportunityCatalogService } from "./services/opportunities/catalog.js";
import { OpportunityDraftingService } from "./services/opportunities/drafting.js";
import { OpportunityReviewWorkflowService } from "./services/opportunities/review-workflow.js";
import { SubmissionPacketService } from "./services/opportunities/submission-packet.js";
import { SubmissionAutopilotService } from "./services/opportunities/submission-autopilot.js";
import { SubmissionFormFillService } from "./services/opportunities/submission-form-fill.js";
import { PortalSchemaProfileService } from "./services/opportunities/portal-schema.js";
import { PortalDiscoveryService } from "./services/opportunities/portal-discovery.js";
import { PortfolioOptimizerService } from "./services/opportunities/portfolio.js";
import { SubmissionSessionsService } from "./services/opportunities/submission-sessions.js";
import { SubmissionUploadStagingService } from "./services/opportunities/submission-upload-staging.js";
import { OpportunityWorkbenchService } from "./services/opportunities/workbench.js";
import { CustomerOnboardingService } from "./services/onboarding/customer-onboarding.js";
import { LessonMemoryService } from "./services/lessons/workflow.js";
import { GeminiLessonFeedbackAnalyzer } from "./services/lessons/gemini-feedback.js";
import { OrganizationProfileService } from "./services/organizations/profile.js";
import { ProPublicaClient } from "./services/propublica/client.js";
import { PostAwardReportingService } from "./services/reporting/workflow.js";
import { WorkspaceContextService } from "./services/workspace/context.js";

export const buildServer = () => {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === "development"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "SYS:standard",
              },
            }
          : undefined,
    },
    disableRequestLogging: false,
    bodyLimit: Math.max(env.DOCUMENT_UPLOAD_MAX_BYTES * 2, 25 * 1024 * 1024),
  });

  app.decorate("config", env);
  app.addHook("onRequest", (request, reply, done) => {
    withRequestContext(
      {
        clerkUserId: getClerkUserIdFromRequest(request),
      },
      () => done(),
    );
  });
  app.register(multipart, {
    limits: {
      fileSize: env.DOCUMENT_UPLOAD_MAX_BYTES,
      files: 1,
    },
  });

  const notionClient = new NotionMcpClient(env, app.log);
  const notionWorkspaceSyncService = new NotionWorkspaceSyncService(notionClient, app.log);
  const geminiClient = new GeminiClient(env);
  const proPublicaClient = new ProPublicaClient(env);
  const documentVaultService = new DocumentVaultService(env, notionClient, app.log);
  const portalDiscoveryService = new PortalDiscoveryService(env, notionClient, app.log);
  const funderIntelligenceService = new FunderIntelligenceService(
    env,
    proPublicaClient,
    notionClient,
    app.log,
  );
  const opportunityAnalysisService = new OpportunityAnalysisService(notionClient, app.log);
  const opportunityDraftingService = new OpportunityDraftingService(
    geminiClient,
    opportunityAnalysisService,
    notionClient,
    app.log,
  );
  const opportunityReviewWorkflowService = new OpportunityReviewWorkflowService(
    opportunityDraftingService,
    notionClient,
    app.log,
  );
  const submissionPacketService = new SubmissionPacketService(
    opportunityReviewWorkflowService,
    notionClient,
    app.log,
  );
  const portalSchemaProfileService = new PortalSchemaProfileService(app.log);
  const submissionUploadStagingService = new SubmissionUploadStagingService(
    env,
    notionClient,
    app.log,
  );
  const submissionFormFillService = new SubmissionFormFillService(
    submissionUploadStagingService,
    notionClient,
    app.log,
  );
  const submissionAutopilotService = new SubmissionAutopilotService(
    env,
    submissionPacketService,
    submissionFormFillService,
    notionClient,
    app.log,
  );
  const opportunityWorkbenchService = new OpportunityWorkbenchService(
    opportunityAnalysisService,
    opportunityReviewWorkflowService,
    app.log,
  );
  const portfolioOptimizerService = new PortfolioOptimizerService(notionClient, app.log);
  const geminiLessonFeedbackAnalyzer = new GeminiLessonFeedbackAnalyzer(env, app.log);

  registerHealthRoutes(app);
  registerNotionRoutes(app, notionClient, notionWorkspaceSyncService);
  registerDemoRoutes(app, new DemoSeedService(notionClient, app.log));
  registerOrganizationRoutes(app, new OrganizationProfileService(app.log), notionClient);
  registerWorkspaceContextRoutes(app, new WorkspaceContextService(notionClient, app.log));
  registerOnboardingRoutes(app, new CustomerOnboardingService(env, notionClient, app.log));
  registerPortfolioRoutes(app, portfolioOptimizerService);
  registerLessonRoutes(
    app,
    new LessonMemoryService(notionClient, geminiLessonFeedbackAnalyzer, app.log),
  );
  registerDocumentRoutes(app, documentVaultService);
  registerFunderRoutes(
    app,
    funderIntelligenceService,
    new FunderFilingParsingService(env, geminiClient, notionClient, app.log),
    new FunderContrastService(notionClient, app.log),
  );
  registerIntakeRoutes(
    app,
    new OpportunityIntakeService(env, geminiClient, portalDiscoveryService, notionClient, app.log),
  );
  registerOpportunityRoutes(
    app,
    portalDiscoveryService,
    funderIntelligenceService,
    new FunderFilingParsingService(env, geminiClient, notionClient, app.log),
    new OpportunityCatalogService(portalDiscoveryService, notionClient, app.log),
    opportunityAnalysisService,
    opportunityWorkbenchService,
    opportunityDraftingService,
    opportunityReviewWorkflowService,
    submissionPacketService,
    submissionAutopilotService,
    submissionFormFillService,
    submissionUploadStagingService,
    portalSchemaProfileService,
    new SubmissionSessionsService(portalSchemaProfileService, app.log),
  );
  registerReportingRoutes(app, new PostAwardReportingService(notionClient, geminiClient, app.log));

  return app;
};

export type AppServer = ReturnType<typeof buildServer>;
