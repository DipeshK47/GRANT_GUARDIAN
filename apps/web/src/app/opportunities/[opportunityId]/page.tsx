import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../app-shell";
import { HomeClient } from "../../home-client";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../lib/server-data";
import { OpportunityRouteHeader } from "./opportunity-route-header";

export const dynamic = "force-dynamic";

type OpportunityDetailPageProps = {
  params: Promise<{
    opportunityId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunityDetailPage({
  params,
  searchParams,
}: OpportunityDetailPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const { opportunityId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedOrganizationId = normalizeOrganizationId(resolvedSearchParams?.organizationId);
  const { organizations, opportunity: selectedOpportunity, organization, organizationId } =
    await getOpportunityPageContext(userId, opportunityId, requestedOrganizationId);
  if (!selectedOpportunity) {
    notFound();
  }
  if (!organization || !organization.onboardingCompleted) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      currentSection="opportunities"
      eyebrow="Opportunity Workspace"
      title={selectedOpportunity.title}
      description="Work one grant all the way through portal confirmation, analysis, drafting, review, submission, reporting, and lessons without losing the larger workspace context."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
        <OpportunityRouteHeader
          opportunityId={selectedOpportunity.id}
          opportunityTitle={selectedOpportunity.title}
          organizationId={organizationId}
          organizationName={organization?.legalName ?? null}
          currentSection="overview"
          eyebrow="Opportunity Route"
          summary="This page keeps one grant in focus so a user can confirm the portal, run analysis, drive review, prepare submission, activate reporting, and capture lessons without bouncing back to a giant dashboard."
        />

        <div style={{ marginTop: 24 }}>
          <HomeClient
            initialOrganizations={organizations}
            initialOrganizationId={organizationId}
            initialOpportunityId={selectedOpportunity.id}
            pageMode="opportunity"
          />
        </div>
    </AppShell>
  );
}
