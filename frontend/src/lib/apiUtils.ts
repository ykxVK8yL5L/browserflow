/**
 * API 实用工具 - 共享 API 调用逻辑
 */

// 动态获取 API 地址
// export const getApiBase = () => {
//   if (import.meta.env.VITE_API_BASE) {
//     return import.meta.env.VITE_API_BASE;
//   }
//   if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
//     return "http://localhost:8000";
//   }
//   return `${window.location.protocol}//${window.location.hostname}:8000`;
// };

// export const API_BASE = getApiBase();

export const API_BASE = '';

// ─── Storage Keys ───────────────────────────────────────

export const SESSION_KEY = "bf_session";

// ─── Helper Functions ───────────────────────────────────

export function getSession(): { token: string } | null {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const session = getSession();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (session?.token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${session.token}`;
  }

  const response = await fetch(`${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || "Request failed");
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export async function getWebSocketTicket(): Promise<string> {
  const response = await apiCall<{ ticket: string }>("/api/ws-ticket", {
    method: "POST",
  });
  return response.ticket;
}
