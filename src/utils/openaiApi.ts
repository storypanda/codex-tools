import type { AccountSummary } from "../types/app";

export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";

export function isOpenAiApiBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const url = new URL(baseUrl.trim());
    return url.origin === "https://api.openai.com" &&
      !url.username && !url.password && !url.search && !url.hash &&
      ["", "/v1"].includes(url.pathname.replace(/\/+$/, ""));
  } catch {
    return false;
  }
}

export function isOpenAiApiAccount(account: AccountSummary): boolean {
  return account.sourceKind === "relay" && isOpenAiApiBaseUrl(account.apiBaseUrl);
}
