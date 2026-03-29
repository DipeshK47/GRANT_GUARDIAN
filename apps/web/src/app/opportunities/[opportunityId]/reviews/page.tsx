import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "../../../app-shell";
import { ReviewsClient } from "../reviews-client";
import { OpportunityRouteHeader } from "../opportunity-route-header";
import {
  getOpportunityPageContext,
  normalizeOrganizationId,
} from "../../../lib/server-data";

export const dynamic = "force-dynamic";

type OpportunityReviewsPageProps = {
  params: Promise<{
    opportunityId: string;
  }>;
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function OpportunityReviewsPage({
  params,
  searchParams,
}: OpportunityReviewsPageProps) {
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
      eyebrow="Review Queue"
      title={`${opportunity.title} reviews`}
      description="Request the right review loop, watch readiness improve, and keep Notion updated while the team moves toward a safe submission handoff."
      organizationId={organizationId}
      workspaceName={organization?.legalName ?? null}
    >
        <OpportunityRouteHeader
          opportunityId={opportunity.id}
          opportunityTitle={opportunity.title}
          organizationId={organizationId}
          organizationName={organization?.legalName ?? null}
          currentSection="reviews"
          eyebrow="Review Queue"
          summary="Request reviews, see submission readiness, and keep Notion synced as the human approval loop fills in. This page is the grant's handoff point between drafting and submission."
        />

        <div style={{ marginTop: 24 }}>
          <ReviewsClient
            opportunityId={opportunity.id}
            organizationId={organizationId}
            defaultReviewer={organization?.grantsContact ?? null}
          />
        </div>
    </AppShell>
  );
}
