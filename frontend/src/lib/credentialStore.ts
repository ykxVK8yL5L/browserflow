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
  is_valid: boolean;
  last_used: string | null;
  created_at: string;
  updated_at: string;
  value?: string;
}

const STORAGE_KEY = "browserflow-credentials";

export function getCredentials(): Credential[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw);
}

function saveCredentials(creds: Credential[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

/**
 * 从后端同步凭证列表
 */
export async function fetchCredentials(): Promise<Credential[]> {
  // 1. 获取列表 (CredentialListResponse)
  const list = await apiCall<any[]>("/api/credentials");

  // 2. 为每个凭证获取详情 (CredentialDetailResponse) 以获得 credential_data
  const detailedCreds = await Promise.all(
    list.map(async (item) => {
      const detail = await apiCall<Credential>(`/api/credentials/${item.id}`);
      const data = detail.credential_data || {};
      return {
        ...detail,
        type: typeof data.type === "string" ? data.type : "text",
        value:
          typeof data.value === "string"
            ? data.value
            : typeof data.password === "string"
              ? data.password
              : typeof data.token === "string"
                ? data.token
                : JSON.stringify(data),
      };
    })
  );

  saveCredentials(detailedCreds);
  return detailedCreds;
}

export async function createCredential(data: {
  name: string;
  type: string;
  value: string;
  description: string;
}): Promise<Credential> {
  const payload = {
    name: data.name,
    site: "browserflow",
    description: data.description,
    credential_data: {
      type: data.type,
      value: data.value,
    },
  };

  const apiRes = await apiCall<Credential>("/api/credentials", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const normalized: Credential = {
    ...apiRes,
    type: data.type,
    value: data.value,
    credential_data: payload.credential_data,
  };

  const creds = getCredentials();
  creds.push(normalized);
  saveCredentials(creds);
  return normalized;
}

export async function updateCredential(id: string, updates: Partial<Credential>): Promise<Credential> {
  const existing = getCredentials().find((c) => c.id === id);
  const nextType = typeof updates.type === "string" ? updates.type : existing?.type || "text";
  const nextValue = typeof updates.value === "string" ? updates.value : existing?.value || "";
  const apiRes = await apiCall<Credential>(`/api/credentials/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: updates.name,
      description: updates.description,
      is_valid: updates.is_valid,
      credential_data: {
        type: nextType,
        value: nextValue,
      },
    }),
  });
  const normalized: Credential = {
    ...apiRes,
    type: nextType,
    value: nextValue,
    credential_data: {
      type: nextType,
      value: nextValue,
    },
  };

  const creds = getCredentials();
  const idx = creds.findIndex((c) => c.id === id);
  if (idx !== -1) {
    creds[idx] = normalized;
    saveCredentials(creds);
  }
  return normalized;
}

export async function deleteCredential(id: string): Promise<void> {
  await apiCall(`/api/credentials/${id}`, { method: "DELETE" });
  saveCredentials(getCredentials().filter((c) => c.id !== id));
}

/**
 * Resolve credential references in a string.
 * References look like {{credential:name}} and get replaced with the credential's value.
 */
export function resolveCredentials(text: string): string {
  const creds = getCredentials();
  return text.replace(/\{\{credential:([^}]+)\}\}/g, (match, name) => {
    const cred = creds.find((c) => c.name === name);
    if (!cred) return match;
    
    // 尝试从 credential_data 中寻找匹配的值 (例如 value 或 password)
    const data = cred.credential_data;
    return data.value || data.password || data.token || JSON.stringify(data);
  });
}
