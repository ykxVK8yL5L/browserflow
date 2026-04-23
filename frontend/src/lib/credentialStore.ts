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

export interface CredentialFormData {
  name: string;
  type: string;
  value?: string;
  description: string;
  credential_data?: Record<string, any>;
  is_visible?: boolean;
}

/**
 * 从后端同步凭证列表
 */
export async function fetchCredentials(): Promise<Credential[]> {
  const list = await apiCall<Credential[]>("/api/credentials");

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
    site: "browserflow",
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
