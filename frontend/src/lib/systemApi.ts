import { API_BASE, getSession } from "./apiUtils";

export interface RestoreBackupResponse {
  message: string;
  restored_by: string;
  scope: string;
  table_count: number;
  file_root_count: number;
}

export interface DownloadSystemBackupOptions {
  scope?: string;
}

function getAuthHeaders(): HeadersInit {
  const session = getSession();
  if (!session?.token) {
    return {};
  }
  return {
    Authorization: `Bearer ${session.token}`,
  };
}

export async function downloadSystemBackup(options: DownloadSystemBackupOptions = {}): Promise<void> {
  const scope = options.scope ?? "current_user";
  const response = await fetch(`${API_BASE}/api/system/backup?scope=${encodeURIComponent(scope)}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "备份下载失败" }));
    throw new Error(error.detail || "备份下载失败");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const disposition = response.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const contentType = response.headers.get("Content-Type") || "";
  const defaultExt = contentType.includes("application/json") ? "json" : "zip";
  const filename = filenameMatch?.[1] || `browserflow-backup-${new Date().toISOString().slice(0, 10)}.${defaultExt}`;

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export async function restoreSystemBackup(file: File): Promise<RestoreBackupResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/api/system/restore`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "还原失败" }));
    throw new Error(error.detail || "还原失败");
  }

  return response.json();
}
