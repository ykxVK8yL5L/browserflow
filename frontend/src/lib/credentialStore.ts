import { apiCall as sharedApiCall, SESSION_KEY } from "./apiUtils";

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

// ─── Types ──────────────────────────────────────────────

export interface Credential {
  id: string;
  name: string;
  site: string;
  type?: string;
  description: string;
  credential_data: Record<string, any>;
  is_visible: boolean;
  is_valid: boolean;
  last_used: string | null;
  created_at: string;
  updated_at: string;
  value?: string;
}

export interface ImapAccountInput {
  name?: string;
  accountTag?: string;
  address: string;
  password: string;
  description?: string;
  is_visible?: boolean;
}

export type EmailAccountProvider = "imap" | "outlook" | "inboxes" | "generator.email";

export interface EmailAccountRecord {
  id: string;
  name: string;
  site: string;
  provider: EmailAccountProvider;
  description: string;
  is_visible: boolean;
  is_valid: boolean;
  last_used: string | null;
  created_at: string;
  updated_at: string;
  address: string;
  identifier: string;
  accountTag: string;
  username: string;
  authType: string;
  credential_data: Record<string, any>;
}

export interface EmailReceiveTestResult {
  success: boolean;
  provider: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  mailbox_count: number;
  message_count: number;
  message: string;
}

export interface EmailAccountImportParseResult {
  items: Record<string, any>[];
  description: string;
}

export interface CredentialFormData {
  name: string;
  type: string;
  value?: string;
  description: string;
  credential_data?: Record<string, any>;
  is_visible?: boolean;
  site?: string;
}

export const EMAIL_ACCOUNT_PROVIDERS: Array<{
  value: EmailAccountProvider;
  label: string;
  importHint: string;
  description: string;
  supportsOAuth: boolean;
}> = [
  {
    value: "imap",
    label: "IMAP",
    importHint: "邮箱----密码",
    description: "适用于普通 IMAP 邮箱账号导入。",
    supportsOAuth: false,
  },
  {
    value: "outlook",
    label: "Outlook",
    importHint: "邮箱----密码----Client_ID----Refresh_Token",
    description: "通过 Microsoft Graph + refresh_token 读取 Outlook 邮件。",
    supportsOAuth: true,
  },
  {
    value: "inboxes",
    label: "Inboxes",
    importHint: "运行时自动创建并入池",
    description: "通过 inboxes.com API 动态创建邮箱并读取邮件。",
    supportsOAuth: false,
  },
  {
    value: "generator.email",
    label: "Generator.Email",
    importHint: "运行时自动创建并入池",
    description: "通过 generator.email 页面动态生成邮箱并抓取邮件。",
    supportsOAuth: false,
  },
];

/**
 * 从后端同步凭证列表
 */
export async function fetchCredentials(site?: string): Promise<Credential[]> {
  const endpoint = site
    ? `/api/credentials?site=${encodeURIComponent(site)}`
    : "/api/credentials";
  const list = await apiCall<Credential[]>(endpoint);

  return list.map((item) => {
    const data = item.credential_data || {};
    return {
      ...item,
      type: typeof data.type === "string" ? data.type : "text",
      value:
        item.is_visible && typeof data.value === "string"
          ? data.value
          : item.is_visible && typeof data.password === "string"
            ? data.password
            : item.is_visible && typeof data.token === "string"
              ? data.token
              : item.is_visible
                ? JSON.stringify(data)
                : "",
    };
  });
}

function buildCredentialPayload(data: CredentialFormData): Record<string, any> {
  if (data.type === "dictionary") {
    return {
      type: data.type,
      ...(data.credential_data || {}),
    };
  }

  return {
    type: data.type,
    value: data.value || "",
  };
}

function getCredentialPreviewValue(data: Record<string, any>): string {
  return typeof data.value === "string"
    ? data.value
    : typeof data.password === "string"
      ? data.password
      : typeof data.token === "string"
        ? data.token
        : JSON.stringify(data);
}

export async function createCredential(data: CredentialFormData): Promise<Credential> {
  const credentialPayload = buildCredentialPayload(data);
  const payload = {
    name: data.name,
    site: data.site || "browserflow",
    description: data.description,
    is_visible: data.is_visible ?? true,
    credential_data: credentialPayload,
  };

  const apiRes = await apiCall<Credential>("/api/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return {
    ...apiRes,
    type: data.type,
    value: (data.is_visible ?? true) ? getCredentialPreviewValue(credentialPayload) : "",
    credential_data: credentialPayload,
    is_visible: data.is_visible ?? true,
  };
}

export async function updateCredential(
  id: string,
  updates: Partial<Credential> & { credential_data?: Record<string, any> }
): Promise<Credential> {
  const nextType = typeof updates.type === "string" ? updates.type : "text";
  const hasCredentialDataUpdate = typeof updates.credential_data !== "undefined";
  const nextCredentialData = hasCredentialDataUpdate ? updates.credential_data : undefined;
  const requestBody: Record<string, any> = {
    name: updates.name,
    description: updates.description,
    is_visible: updates.is_visible,
    is_valid: updates.is_valid,
  };

  if (hasCredentialDataUpdate) {
    requestBody.credential_data = nextCredentialData;
  }

  const apiRes = await apiCall<Credential>(`/api/credentials/${id}`, {
    method: "PUT",
    body: JSON.stringify(requestBody),
  });
  return {
    ...apiRes,
    type: typeof apiRes.credential_data?.type === "string" ? apiRes.credential_data.type : nextType,
    value: apiRes.is_visible ? getCredentialPreviewValue(apiRes.credential_data || {}) : "",
    credential_data: apiRes.credential_data || {},
    is_visible: apiRes.is_visible,
  };
}

export async function deleteCredential(id: string): Promise<void> {
  await apiCall(`/api/credentials/${id}`, { method: "DELETE" });
}

export async function testEmailAccountReceive(id: string): Promise<EmailReceiveTestResult> {
  return apiCall<EmailReceiveTestResult>(`/api/credentials/${id}/test-email-receive`, {
    method: "POST",
  });
}

function normalizeProvider(value: string): EmailAccountProvider {
  const normalized = value.trim().toLowerCase();
  if (normalized === "outlook") return "outlook";
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

function buildEmailAccountSite(provider: EmailAccountProvider): string {
  return provider;
}

export function isEmailAccountCredential(credential: Credential): boolean {
  const provider = String(credential.credential_data?.provider || credential.site || "").trim().toLowerCase();
  return EMAIL_ACCOUNT_PROVIDERS.some((item) => item.value === provider);
}

export function toEmailAccountRecord(credential: Credential): EmailAccountRecord {
  const data = credential.credential_data || {};
  const provider = normalizeProvider(String(data.provider || credential.site || "imap"));
  const address = normalizeEmailAddress(String(data.address || data.email || data.identifier || ""));
  const identifier = String(data.identifier || address || credential.name || "").trim();
  const accountTag = String(data.accountTag || data.account_tag || credential.name || identifier).trim();
  const username = String(data.username || address || identifier).trim();
  const authType = String(data.authType || data.auth_type || data.type || (data.password ? "password" : "oauth2")).trim();

  return {
    id: credential.id,
    name: credential.name,
    site: credential.site,
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
  const list = await fetchCredentials();
  return list.filter(isEmailAccountCredential).map(toEmailAccountRecord);
}

export function parseEmailAccountImportText(
  provider: EmailAccountProvider,
  rawText: string,
): EmailAccountImportParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (provider === "imap") {
    return {
      description: "IMAP imported account",
      items: lines.map((line, index) => {
        const [rawAddress, ...rest] = line.split("----");
        const password = rest.join("----").trim();
        const address = normalizeEmailAddress(rawAddress || "");
        if (!address || !password) {
          throw new Error(`第 ${index + 1} 行格式错误，应为 邮箱----密码`);
        }
        return {
          provider: "imap",
          type: "imap",
          identifier: address,
          accountTag: address,
          address,
          username: address,
          password,
        };
      }),
    };
  }

  if (provider === "outlook") {
    return {
      description: "Outlook OAuth imported account",
      items: lines.map((line, index) => {
        const parts = line.split("----");
        const [rawAddress, rawPassword, rawClientId, ...refreshParts] = parts;
        const address = normalizeEmailAddress(rawAddress || "");
        const password = String(rawPassword || "").trim();
        const clientId = String(rawClientId || "").trim();
        const refreshToken = refreshParts.join("----").trim();
        if (!address || !password || !clientId || !refreshToken) {
          throw new Error(`第 ${index + 1} 行格式错误，应为 邮箱----密码----Client_ID----Refresh_Token`);
        }
        return {
          provider: "outlook",
          type: "outlook",
          identifier: address,
          accountTag: address,
          address,
          username: address,
          password,
          clientId,
          refreshToken,
          authType: "oauth2",
          tenant: "common",
        };
      }),
    };
  }

  if (provider === "inboxes") {
    throw new Error("inboxes 账号由运行时自动创建，无需手动导入");
  }

  if (provider === "generator.email") {
    throw new Error("generator.email 账号由运行时自动创建，无需手动导入");
  }

  throw new Error(`${provider} 暂未实现导入解析`);
}

export async function createEmailAccount(
  provider: EmailAccountProvider,
  credentialData: Record<string, any>,
  options?: {
    name?: string;
    description?: string;
    is_visible?: boolean;
  },
): Promise<Credential> {
  const address = normalizeEmailAddress(String(credentialData.address || credentialData.identifier || ""));
  return createCredential({
    name: buildEmailAccountName({
      provider,
      address,
      accountTag: credentialData.accountTag,
      name: options?.name,
    }),
    type: "dictionary",
    description: options?.description?.trim() || `${provider} account`,
    credential_data: {
      ...credentialData,
      provider,
      type: credentialData.type || provider,
    },
    is_visible: options?.is_visible ?? true,
    site: buildEmailAccountSite(provider),
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
): Promise<Credential> {
  const address = normalizeEmailAddress(String(credentialData.address || credentialData.identifier || ""));
  return updateCredential(id, {
    name: buildEmailAccountName({
      provider,
      address,
      accountTag: credentialData.accountTag,
      name: options?.name,
    }),
    description: options?.description?.trim() || `${provider} account`,
    is_visible: options?.is_visible,
    is_valid: options?.is_valid,
    credential_data: {
      ...credentialData,
      provider,
      type: credentialData.type || provider,
    },
  });
}

function normalizeImapAddress(value: string): string {
  return value.trim().toLowerCase();
}

function buildImapCredentialPayload(input: ImapAccountInput): Record<string, any> {
  const address = normalizeImapAddress(input.address);
  const accountTag = input.accountTag?.trim() || address;
  return {
    provider: "imap",
    type: "imap",
    identifier: address,
    accountTag,
    address,
    username: address,
    password: input.password,
  };
}

export async function fetchImapAccounts(): Promise<Credential[]> {
  return fetchCredentials("imap");
}

export async function createImapAccount(input: ImapAccountInput): Promise<Credential> {
  const address = normalizeImapAddress(input.address);
  return createCredential({
    name: input.name?.trim() || input.accountTag?.trim() || address,
    type: "dictionary",
    description: input.description?.trim() || "IMAP account",
    credential_data: buildImapCredentialPayload(input),
    is_visible: input.is_visible ?? true,
    site: "imap",
  });
}

export async function updateImapAccount(
  id: string,
  input: ImapAccountInput,
): Promise<Credential> {
  const address = normalizeImapAddress(input.address);
  const credential_data = buildImapCredentialPayload(input);
  return updateCredential(id, {
    name: input.name?.trim() || input.accountTag?.trim() || address,
    description: input.description?.trim() || "IMAP account",
    credential_data,
  });
}

export function parseImapImportText(rawText: string): ImapAccountInput[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const [rawAddress, ...rest] = line.split("----");
      const password = rest.join("----").trim();
      const address = normalizeImapAddress(rawAddress || "");
      if (!address || !password) {
        throw new Error(`第 ${index + 1} 行格式错误，应为 邮箱----密码`);
      }
      return {
        name: address,
        accountTag: address,
        address,
        password,
        description: "IMAP imported account",
        is_visible: true,
      } satisfies ImapAccountInput;
    });
}
