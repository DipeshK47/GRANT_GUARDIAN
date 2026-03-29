import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../../app-shell";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../../../lib/server-data";
import { OpportunityRouteHeader } from "../../opportunity-route-header";
import { SubmissionSessionClient } from "../../submission-session-client";

export const dynamic = "force-dynamic";

type OpportunitySubmissionSessionPageProps = {
  params: Promise<{
    opportunityId: string;
    submissionSessionId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunitySubmissionSessionPage({
  params,
  searchParams,
}: OpportunitySubmissionSessionPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const { opportunityId, submissionSessionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedOrganizationId = normalizeOrganizationId(resolvedSearchParams?.organizationId);
  const { opportunity, organization, organizationId } = await getOpportunityPageContext(
    userId,
    opportunityId,
    requestedOrganizationId,
  );

  if (!opportunity) {
    notFound();
  }
  if (!organization || !organization.onboardingCompleted) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      currentSection="opportunities"
      eyebrow="Submission Session"
      title={`${opportunity.title} final check`}
      description="Stage the exact local files, inspect the field plan, and record the second human confirmation from a dedicated session workspace before anyone submits."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
      <OpportunityRouteHeader
        opportunityId={opportunity.id}
        opportunityTitle={opportunity.title}
        organizationId={organizationId}
        organizationName={organization?.legalName ?? null}
        currentSection="submission"
        eyebrow="Submission Session"
        summary="This is the grant's final operating page. It brings the staged files, field plan, learned portal hints, and second-human confirmation into one place so a team can use Grant Guardian from the website instead of the terminal."
      />

      <div style={{ marginTop: 24 }}>
        <SubmissionSessionClient
          opportunityId={opportunity.id}
          submissionSessionId={submissionSessionId}
          organizationId={organizationId}
          defaultReviewer={organization?.grantsContact ?? null}
        />
      </div>
    </AppShell>
  );
}
