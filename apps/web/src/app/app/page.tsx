import { redirect } from "next/navigation";
import { normalizeOrganizationId } from "../lib/server-data";

type AppDashboardPageProps = {
  searchParams?: Promise<{
    organizationId?: string | string[];
  }>;
};

export const dynamic = "force-dynamic";

export default async function AppDashboardPage({ searchParams }: AppDashboardPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const requestedOrganizationId = normalizeOrganizationId(resolvedSearchParams?.organizationId);
  const query = requestedOrganizationId
    ? `?organizationId=${encodeURIComponent(requestedOrganizationId)}`
    : "";
  redirect(`/dashboard${query}`);
}
