import { clearStoredSession, getSession } from "./apiUtils";

// const getApiBase = () => {
//   if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
//   if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
//     return "http://localhost:8000";
//   }
//   return `${window.location.protocol}//${window.location.hostname}:8000`;
// };

// const API_BASE = getApiBase();

async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getSession()?.token ?? null;
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  
  const response = await fetch(`${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
    if (response.status === 401) {
      clearStoredSession();
    }
    throw new Error(error.detail || "Request failed");
  }
  return response.json();
}

export interface Identity {
  id: string;
  name: string;
  type: string;
  storage_path: string | null;
  credential_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdentityStateFile {
  identity_id: string;
  path: string;
  content: string;
  size: number;
}

export interface IdentityFileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  updated_at: number;
}

export interface IdentityFileListResponse {
  current_path: string;
  entries: IdentityFileEntry[];
}

export interface IdentityFileContentResponse {
  path: string;
  content: string;
  size: number;
}

export async function getIdentities(): Promise<Identity[]> {
  return await apiCall<Identity[]>("/api/identities");
}

export async function createIdentity(data: any): Promise<Identity> {
  return await apiCall<Identity>("/api/identities", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateIdentity(id: string, updates: any): Promise<Identity> {
  return await apiCall<Identity>(`/api/identities/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteIdentity(id: string): Promise<void> {
  await apiCall(`/api/identities/${id}`, { method: "DELETE" });
}

export async function uploadIdentityState(formData: FormData): Promise<Identity> {
  const token = getSession()?.token ?? null;
  
  const headers: HeadersInit = {};
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  
  const response = await fetch(`/api/identities/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    if (response.status === 401) {
      clearStoredSession();
    }
    throw new Error(error.detail || "Upload failed");
  }
  return response.json();
}

export async function getIdentityState(id: string): Promise<IdentityStateFile> {
  return await apiCall<IdentityStateFile>(`/api/identities/${id}/state`);
}

export async function saveIdentityState(id: string, content: string): Promise<IdentityStateFile> {
  return await apiCall<IdentityStateFile>(`/api/identities/${id}/state`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function listIdentityFiles(id: string, path = ""): Promise<IdentityFileListResponse> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  return await apiCall<IdentityFileListResponse>(`/api/identities/${id}/files${params.toString() ? `?${params.toString()}` : ""}`);
}

export async function getIdentityFileContent(id: string, path: string): Promise<IdentityFileContentResponse> {
  const params = new URLSearchParams({ path });
  return await apiCall<IdentityFileContentResponse>(`/api/identities/${id}/files/content?${params.toString()}`);
}

export async function saveIdentityFileContent(id: string, path: string, content: string): Promise<IdentityFileContentResponse> {
  return await apiCall<IdentityFileContentResponse>(`/api/identities/${id}/files/content`, {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}

export async function createIdentityFolder(id: string, path: string, name: string): Promise<{ message: string; path: string }> {
  return await apiCall<{ message: string; path: string }>(`/api/identities/${id}/files/folders`, {
    method: "POST",
    body: JSON.stringify({ path, name }),
  });
}

export async function renameIdentityPath(id: string, path: string, newPath: string): Promise<{ message: string; path: string }> {
  return await apiCall<{ message: string; path: string }>(`/api/identities/${id}/files/rename`, {
    method: "PATCH",
    body: JSON.stringify({ path, new_path: newPath }),
  });
}

export async function deleteIdentityPath(id: string, path: string): Promise<{ message: string }> {
  const params = new URLSearchParams({ path });
  return await apiCall<{ message: string }>(`/api/identities/${id}/files?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function uploadIdentityFile(id: string, path: string, file: File): Promise<{ message: string; path: string; size: number }> {
  const token = getSession()?.token ?? null;
  const headers: HeadersInit = {};
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  const response = await fetch(`/api/identities/${id}/files/upload`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    if (response.status === 401) {
      clearStoredSession();
    }
    throw new Error(error.detail || "Upload failed");
  }

  return response.json();
}
