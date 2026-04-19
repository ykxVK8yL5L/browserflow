/**
 * User-Agent API - 连接后端 User-Agent API
 */

import {
  getApiBase,
  apiCall,
  getSession,
} from "./apiUtils";

export interface UserAgent {
  id: string;
  value: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserAgentCreateInput {
  value: string;
  is_default?: boolean;
}

export interface UserAgentUpdateInput {
  value?: string;
  is_default?: boolean;
}

export async function fetchUserAgents(): Promise<UserAgent[]> {
  return apiCall<UserAgent[]>("/api/user-agents");
}

export async function createUserAgent(data: UserAgentCreateInput): Promise<UserAgent> {
  return apiCall<UserAgent>("/api/user-agents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateUserAgent(id: string, data: UserAgentUpdateInput): Promise<UserAgent> {
  return apiCall<UserAgent>("/api/user-agents/" + id, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteUserAgent(id: string): Promise<void> {
  return apiCall<void>("/api/user-agents/" + id, {
    method: "DELETE",
  });
}
