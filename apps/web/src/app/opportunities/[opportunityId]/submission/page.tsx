import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { SubmissionClient } from "../submission-client";
import { OpportunityRouteHeader } from "../opportunity-route-header";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../../lib/server-data";

export const dynamic = "force-dynamic";

type OpportunitySubmissionPageProps = {
  params: Promise<{
    opportunityId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunitySubmissionPage({
  params,
  searchParams,
}: OpportunitySubmissionPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const { opportunityId } = await params;
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
      eyebrow="Submission Handoff"
      title={`${opportunity.title} submission`}
      description="Assemble the packet, confirm portal readiness, and prepare the guarded browser handoff from a dedicated submission workspace."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
        <OpportunityRouteHeader
          opportunityId={opportunity.id}
          opportunityTitle={opportunity.title}
          organizationId={organizationId}
          organizationName={organization?.legalName ?? null}
          currentSection="submission"
          eyebrow="Submission Handoff"
          summary="Assemble the packet, check portal readiness, and launch the guarded browser handoff from the website. Notion sync stays on so the operating record updates while the team prepares to submit."
        />

        <div style={{ marginTop: 24 }}>
          <SubmissionClient
            opportunityId={opportunity.id}
            portalReadiness={opportunity.portalReadiness}
            organizationId={organizationId}
            defaultReviewer={organization?.grantsContact ?? null}
          />
        </div>
    </AppShell>
  );
}
