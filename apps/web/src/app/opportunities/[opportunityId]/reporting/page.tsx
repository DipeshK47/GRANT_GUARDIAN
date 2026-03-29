import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { ReportingClient } from "../reporting-client";
import { OpportunityRouteHeader } from "../opportunity-route-header";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../../lib/server-data";

export const dynamic = "force-dynamic";

type OpportunityReportingPageProps = {
  params: Promise<{
    opportunityId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunityReportingPage({
  params,
  searchParams,
}: OpportunityReportingPageProps) {
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
      eyebrow="Post-Award Reporting"
      title={`${opportunity.title} reporting`}
      description="Turn an award into a real reporting calendar with owners, milestones, and Notion-backed follow-through instead of leaving post-award work in email."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
        <OpportunityRouteHeader
          opportunityId={opportunity.id}
          opportunityTitle={opportunity.title}
          organizationId={organizationId}
          organizationName={organization?.legalName ?? null}
          currentSection="reporting"
          eyebrow="Post-Award Reporting"
          summary="Create the reporting calendar, assign owners, and keep each deadline synced into Notion. This page turns award management into a living workflow instead of a note buried after submission."
        />

        <div style={{ marginTop: 24 }}>
          <ReportingClient
            opportunityId={opportunity.id}
            organizationId={organizationId}
            defaultOwner={organization?.grantsContact ?? null}
          />
        </div>
    </AppShell>
  );
}
