import { redirect } from "next/navigation";
import { requireClerkUserId } from "../lib/clerk-auth";
import { getOrganizations } from "../lib/server-data";
import { OnboardingClient } from "./onboarding-client";

type OnboardingPageProps = {
  searchParams?: Promise<{
    step?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

const normalizeStep = (value?: string | string[]) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1;
};

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const userId = await requireClerkUserId();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedStep = normalizeStep(resolvedSearchParams?.step);
  const revisitOnboarding = Boolean(resolvedSearchParams?.step);
  const organizations = await getOrganizations(userId);
  const initialOrganization =
    organizations.find((organization) => !organization.onboardingCompleted) ??
    (revisitOnboarding ? (organizations[0] ?? null) : null);

  if (!initialOrganization && organizations[0]?.onboardingCompleted && !revisitOnboarding) {
    redirect(`/dashboard?organizationId=${encodeURIComponent(organizations[0].id)}`);
  }

  return (
    <OnboardingClient
      initialOrganizations={organizations}
      initialOrganization={initialOrganization}
      initialStep={requestedStep}
      respectRequestedStep={revisitOnboarding}
    />
  );
}
