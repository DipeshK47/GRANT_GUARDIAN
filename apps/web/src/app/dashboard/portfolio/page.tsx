import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppShell } from "../../app-shell";
import { PortfolioClient } from "./portfolio-client";
import {
  getOnboardingStatus,
  getOrganizations,
  getPortfolioSnapshot,
  normalizeOrganizationId,
} from "../../lib/server-data";

export const dynamic = "force-dynamic";

type PortfolioDashboardPageProps = {
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export default async function PortfolioDashboardPage({
  searchParams,
}: PortfolioDashboardPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedOrganizationId = normalizeOrganizationId(resolvedSearchParams?.organizationId);
  const organizations = await getOrganizations(userId);
  const selectedOrganization =
    organizations.find((organization) => organization.id === requestedOrganizationId) ??
    organizations[0] ??
    null;
  const organizationId = selectedOrganization?.id ?? null;

  if (!selectedOrganization || !selectedOrganization.onboardingCompleted) {
    redirect("/onboarding");
  }

  const [onboarding, initialSnapshot] = await Promise.all([
    getOnboardingStatus(userId, organizationId),
    getPortfolioSnapshot(userId, organizationId, 80),
  ]);

  return (
    <AppShell
      currentSection="portfolio"
      eyebrow="Portfolio Optimizer"
      title="Rank the live grant pipeline before the week gets away from you"
      description="Compare fit, evidence coverage, deadline pressure, and effort across every active opportunity. This page turns a pile of open grants into a staffing plan the team can actually follow."
      organizationId={organizationId}
      workspaceName={selectedOrganization?.legalName ?? onboarding?.organizationName ?? null}
    >
      <PortfolioClient
        organizationId={organizationId}
        initialSnapshot={initialSnapshot}
        opportunityLibraryHref={
          organizationId
            ? `/opportunities?organizationId=${encodeURIComponent(organizationId)}`
            : "/opportunities"
        }
      />
    </AppShell>
  );
}
