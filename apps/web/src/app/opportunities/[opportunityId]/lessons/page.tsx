import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { LessonsClient } from "../lessons-client";
import { OpportunityRouteHeader } from "../opportunity-route-header";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../../lib/server-data";

export const dynamic = "force-dynamic";

type OpportunityLessonsPageProps = {
  params: Promise<{
    opportunityId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunityLessonsPage({
  params,
  searchParams,
}: OpportunityLessonsPageProps) {
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
      eyebrow="Lessons Memory"
      title={`${opportunity.title} lessons`}
      description="Capture reviewer feedback and rejection memory in a place the team will actually reuse next cycle, with Notion staying in sync behind the scenes."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
        <OpportunityRouteHeader
          opportunityId={opportunity.id}
          opportunityTitle={opportunity.title}
          organizationId={organizationId}
          organizationName={organization?.legalName ?? null}
          currentSection="lessons"
          eyebrow="Lessons Memory"
          summary="Capture reviewer feedback, turn it into reusable lessons, and sync those recommendations into Notion so the next cycle starts smarter than the last one."
        />

        <div style={{ marginTop: 24 }}>
          <LessonsClient
            opportunityId={opportunity.id}
            opportunityTitle={opportunity.title}
            organizationId={organizationId}
            opportunityStatus={opportunity.status}
          />
        </div>
    </AppShell>
  );
}
