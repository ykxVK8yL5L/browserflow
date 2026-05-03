import { apiCall as sharedApiCall, SESSION_KEY } from "./apiUtils";
import type {
  EmailAccountImportParseResult,
  EmailAccountProvider,
  EmailAccountRecord,
  EmailReceiveTestResult,
} from "./credentialStore";

function notifyAuthExpired() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("storage"));
  window.dispatchEvent(new CustomEvent("auth:expired"));
}

async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    return await sharedApiCall<T>(endpoint, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === "Session expired or revoked"
      || message === "Invalid or expired token"
      || message === "Not authenticated"
    ) {
      notifyAuthExpired();
    }
    throw error;
  }
}

interface EmailAccountApiResponse {
  id: string;
  name: string;
  provider: EmailAccountProvider;
  address: string | null;
  description: string;
  credential_data: Record<string, any>;
  is_visible: boolean;
  is_valid: boolean;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

export { EMAIL_ACCOUNT_PROVIDERS, parseEmailAccountImportText } from "./credentialStore";
export type { EmailAccountProvider, EmailAccountRecord, EmailReceiveTestResult, EmailAccountImportParseResult } from "./credentialStore";

function normalizeProvider(value: string): EmailAccountProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "inboxes") return "inboxes";
  if (normalized === "generator.email") return "generator.email";
  return "imap";
}

function normalizeEmailAddress(value: string): string {
  return value.trim().toLowerCase();
}

function buildEmailAccountName(data: {
  provider: EmailAccountProvider;
  address: string;
  accountTag?: string;
  name?: string;
}): string {
  return data.name?.trim() || data.accountTag?.trim() || data.address || `${data.provider}-account`;
}

function toEmailAccountRecord(credential: EmailAccountApiResponse): EmailAccountRecord {
  const data = credential.credential_data || {};
  const provider = normalizeProvider(String(data.provider || credential.provider || "imap"));
  const address = normalizeEmailAddress(String(data.address || data.email || credential.address || data.identifier || ""));
  const identifier = String(data.identifier || address || credential.name || "").trim();
  const accountTag = String(data.accountTag || data.account_tag || credential.name || identifier).trim();
  const username = String(data.username || address || identifier).trim();
  const authType = String(data.authType || data.auth_type || data.type || (data.password ? "password" : "oauth2")).trim();

  return {
    id: credential.id,
    name: credential.name,
    site: credential.provider,
    provider,
    description: credential.description,
    is_visible: credential.is_visible,
    is_valid: credential.is_valid,
    last_used: credential.last_used,
    created_at: credential.created_at,
    updated_at: credential.updated_at,
    address,
    identifier,
    accountTag,
    username,
    authType,
    credential_data: data,
  };
}

export async function fetchEmailAccounts(): Promise<EmailAccountRecord[]> {
  const list = await apiCall<EmailAccountApiResponse[]>("/api/email-accounts");
  return list.map(toEmailAccountRecord);
}

export async function createEmailAccount(
  provider: EmailAccountProvider,
  credentialData: Record<string, any>,
  options?: {
    name?: string;
    description?: string;
    is_visible?: boolean;
  },
): Promise<EmailAccountApiResponse> {
  const address = normalizeEmailAddress(String(credentialData.address || credentialData.identifier || ""));
  return apiCall<EmailAccountApiResponse>("/api/email-accounts", {
    method: "POST",
    body: JSON.stringify({
      name: buildEmailAccountName({
        provider,
        address,
        accountTag: credentialData.accountTag,
        name: options?.name,
      }),
      provider,
      description: options?.description?.trim() || `${provider} account`,
      credential_data: {
        ...credentialData,
        provider,
        type: credentialData.type || provider,
      },
      is_visible: options?.is_visible ?? true,
    }),
  });
}

export async function updateEmailAccount(
  id: string,
  provider: EmailAccountProvider,
  credentialData: Record<string, any>,
  options?: {
    name?: string;
    description?: string;
    is_visible?: boolean;
    is_valid?: boolean;
  },
): Promise<EmailAccountApiResponse> {
  const address = normalizeEmailAddress(String(credentialData.address || credentialData.identifier || ""));
  return apiCall<EmailAccountApiResponse>(`/api/email-accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: buildEmailAccountName({
        provider,
        address,
        accountTag: credentialData.accountTag,
        name: options?.name,
      }),
      provider,
      description: options?.description?.trim() || `${provider} account`,
      is_visible: options?.is_visible,
      is_valid: options?.is_valid,
      credential_data: {
        ...credentialData,
        provider,
        type: credentialData.type || provider,
      },
    }),
  });
}

export async function deleteEmailAccount(id: string): Promise<void> {
  await apiCall(`/api/email-accounts/${id}`, { method: "DELETE" });
}

export async function testEmailAccountReceive(id: string): Promise<EmailReceiveTestResult> {
  return apiCall<EmailReceiveTestResult>(`/api/email-accounts/${id}/test-email-receive`, {
    method: "POST",
  });
}
