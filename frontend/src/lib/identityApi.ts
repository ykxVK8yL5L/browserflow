// const getApiBase = () => {
//   if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;
//   if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
//     return "http://localhost:8000";
//   }
//   return `${window.location.protocol}//${window.location.hostname}:8000`;
// };

// const API_BASE = getApiBase();

async function apiCall<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const sessionStr = localStorage.getItem("bf_session");
  const token = sessionStr ? JSON.parse(sessionStr).token : null;
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  
  const response = await fetch(`${endpoint}`, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Request failed" }));
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
  const token = localStorage.getItem("bf_session") ? JSON.parse(localStorage.getItem("bf_session")!).token : null;
  
  const headers: HeadersInit = {};
  if (token) (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  
  const response = await fetch(`/api/identities/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(error.detail || "Upload failed");
  }
  return response.json();
}
