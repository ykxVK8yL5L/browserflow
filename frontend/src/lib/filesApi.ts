import { apiCall, clearStoredSession, getSession } from "./apiUtils";

export interface FileEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number | null;
  updated_at: number;
}

export interface FileListResponse {
  current_path: string;
  entries: FileEntry[];
}

export interface FileContentResponse {
  path: string;
  content: string;
  size: number;
}

export function listFiles(path = ""): Promise<FileListResponse> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  return apiCall<FileListResponse>(`/api/files${params.toString() ? `?${params.toString()}` : ""}`);
}

export function getFileContent(path: string): Promise<FileContentResponse> {
  const params = new URLSearchParams({ path });
  return apiCall<FileContentResponse>(`/api/files/content?${params.toString()}`);
}

export function saveFileContent(path: string, content: string): Promise<FileContentResponse> {
  return apiCall<FileContentResponse>("/api/files/content", {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}

export function createFolder(path: string, name: string): Promise<{ message: string; path: string }> {
  return apiCall<{ message: string; path: string }>("/api/files/folders", {
    method: "POST",
    body: JSON.stringify({ path, name }),
  });
}

export function renameFilePath(path: string, newPath: string): Promise<{ message: string; path: string }> {
  return apiCall<{ message: string; path: string }>("/api/files/rename", {
    method: "PATCH",
    body: JSON.stringify({ path, new_path: newPath }),
  });
}

export function deleteFilePath(path: string): Promise<{ message: string }> {
  const params = new URLSearchParams({ path });
  return apiCall<{ message: string }>(`/api/files?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function uploadFile(path: string, file: File): Promise<{ message: string; path: string; size: number }> {
  const token = getSession()?.token ?? null;
  const headers: HeadersInit = {};
  if (token) {
    (headers as Record<string, string>).Authorization = `Bearer ${token}`;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);

  const response = await fetch("/api/files/upload", {
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