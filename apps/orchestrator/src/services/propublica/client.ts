import type { AppEnv } from "../../config/env.js";

export type ProPublicaOrganizationSummary = {
  ein: number | string;
  strein?: string;
  name: string;
  sub_name?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  subseccd?: number | string;
  ntee_code?: string;
  [key: string]: unknown;
};

export type ProPublicaFiling = {
  ein?: number | string;
  tax_prd?: number | string;
  tax_prd_yr?: number | string;
  formtype?: number | string;
  pdf_url?: string | null;
  updated?: string;
  [key: string]: unknown;
};

export type ProPublicaSearchResponse = {
  total_results?: number;
  num_pages?: number;
  cur_page?: number;
  organizations: ProPublicaOrganizationSummary[];
};

export type ProPublicaOrganizationResponse = {
  organization: ProPublicaOrganizationSummary;
  filings_with_data?: ProPublicaFiling[];
  filings_without_data?: ProPublicaFiling[];
  api_version?: number | string;
  data_source?: string;
};

export class ProPublicaClient {
  constructor(private readonly config: AppEnv) {}

  private buildApiBaseUrl() {
    const url = new URL(this.config.PROPUBLICA_NONPROFIT_BASE_URL);
    const pathname = url.pathname.replace(/\/$/, "");
    url.pathname = pathname.endsWith("/v2") ? pathname : `${pathname}/v2`;
    return url;
  }

  normalizeEin(ein: string | number) {
    return String(ein).replace(/\D/g, "");
  }

  buildOrganizationSearchUrl(query: string) {
    const url = this.buildApiBaseUrl();
    url.pathname = `${url.pathname.replace(/\/$/, "")}/search.json`;
    url.searchParams.set("q", query);
    return url.toString();
  }

  buildOrganizationUrl(ein: string | number) {
    const url = this.buildApiBaseUrl();
    url.pathname = `${url.pathname.replace(/\/$/, "")}/organizations/${this.normalizeEin(ein)}.json`;
    return url.toString();
  }

  buildExplorerOrganizationUrl(ein: string | number) {
    const url = new URL("https://projects.propublica.org/nonprofits/organizations/");
    url.pathname = `${url.pathname.replace(/\/$/, "")}/${this.normalizeEin(ein)}`;
    return url.toString();
  }

  async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.config.USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`ProPublica request failed: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async searchOrganizations(query: string) {
    return this.fetchJson<ProPublicaSearchResponse>(this.buildOrganizationSearchUrl(query));
  }

  async fetchOrganization(ein: string | number) {
    return this.fetchJson<ProPublicaOrganizationResponse>(this.buildOrganizationUrl(ein));
  }
}
