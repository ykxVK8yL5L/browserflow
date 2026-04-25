/**
 * Flow API - 连接后端 Flow API
 *
 * 所有 Flow 数据存储在数据库中，通过 API 调用
 */

import { type Node, type Edge } from "@xyflow/react";
import { API_BASE, apiCall, getSession } from "./apiUtils";
import type { FlowNotificationRule } from "./notificationApi";
import type { FlowGroup } from "./flowGroups";

// ─── Types ──────────────────────────────────────────────

export interface RunSettings {
  headless?: boolean;
  userAgentId?: string;
  viewport?: { width: number; height: number };
  locale?: string;
  timezone?: string;
  proxy?: string;
  humanize?: boolean;
  // 新增设备字段，使用设备名称对应后端的 device_profiles
  device?: string;
}

export interface Flow {
  id: string;
  name: string;
  description?: string;
  flow_data: {
    nodes: Node[];
    edges: Edge[];
    groups?: FlowGroup[];
  };
  run_settings?: RunSettings;
  tags: string[];
  is_template: boolean;
  is_active: boolean;
  identity_id?: string;
  notification_enabled: boolean;
  notification_rules: FlowNotificationRule[];
  created_at: string;
  updated_at: string;
}

export interface FlowListPageResponse {
  items: Flow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface FlowCreateInput {
  name: string;
  description?: string;
  flow_data: {
    nodes: Node[];
    edges: Edge[];
    groups?: FlowGroup[];
  };
  run_settings?: RunSettings;
  tags?: string[];
  is_template?: boolean;
  identity_id?: string;
  notification_enabled?: boolean;
  notification_rules?: FlowNotificationRule[];
}

export interface FlowUpdateInput {
  name?: string;
  description?: string;
  flow_data?: {
    nodes: Node[];
    edges: Edge[];
    groups?: FlowGroup[];
  };
  run_settings?: RunSettings;
  tags?: string[];
  is_template?: boolean;
  is_active?: boolean;
  identity_id?: string;
  notification_enabled?: boolean;
  notification_rules?: FlowNotificationRule[];
}

// ─── Flow API ───────────────────────────────────────────

/**
 * 获取所有 Flow 列表
 */
export async function getFlows(params?: {
  is_template?: boolean;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}): Promise<FlowListPageResponse> {
  const query = new URLSearchParams();
  if (params?.is_template !== undefined) {
    query.append("is_template", String(params.is_template));
  }
  if (params?.is_active !== undefined) {
    query.append("is_active", String(params.is_active));
  }
  if (params?.page !== undefined) {
    query.append("page", String(params.page));
  }
  if (params?.page_size !== undefined) {
    query.append("page_size", String(params.page_size));
  }
  const queryString = query.toString();
  const endpoint = `/api/flows${queryString ? `?${queryString}` : ""}`;
  return apiCall<FlowListPageResponse>(endpoint);
}

/**
 * 获取单个 Flow
 */
export async function getFlow(id: string): Promise<Flow> {
  return apiCall<Flow>(`/api/flows/${id}`);
}

/**
 * 创建 Flow
 */
export async function createFlow(input: FlowCreateInput): Promise<Flow> {
  return apiCall<Flow>("/api/flows", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * 更新 Flow
 */
export async function updateFlow(id: string, input: FlowUpdateInput): Promise<Flow> {
  return apiCall<Flow>(`/api/flows/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * 删除 Flow
 */
export async function deleteFlow(id: string): Promise<void> {
  await apiCall(`/api/flows/${id}`, {
    method: "DELETE",
  });
}

/**
 * 保存 Flow 数据（创建或更新）
 */
export async function saveFlowData(
  id: string | undefined,
  data: {
    name: string;
    description?: string;
    nodes: Node[];
    edges: Edge[];
    groups?: FlowGroup[];
  }
): Promise<Flow> {
  const flowData = {
    nodes: data.nodes,
    edges: data.edges,
    groups: data.groups || [],
  };

  if (id) {
    // 更新现有 Flow
    return updateFlow(id, {
      name: data.name,
      description: data.description,
      flow_data: flowData,
    });
  } else {
    // 创建新 Flow
    return createFlow({
      name: data.name,
      description: data.description,
      flow_data: flowData,
    });
  }
}

// ─── Execution API ──────────────────────────────────────

export interface Execution {
  id: string;
  flow_id: string;
  flow_name?: string;
  identity_id?: string;
  identity_name?: string;
  status: string;
  result?: Record<string, unknown>;
  error_message?: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
}

/**
 * 执行 Flow
 */
export async function executeFlow(
  flowId: string, 
  identityId?: string, 
  userAgentId?: string, 
  headless?: boolean
): Promise<Execution> {
  return apiCall<Execution>("/api/executions", {
    method: "POST",
    body: JSON.stringify({
      flow_id: flowId,
      identity_id: identityId,
      user_agent_id: userAgentId,
      headless: headless,
    }),
  });
}

/**
 * 获取执行列表
 */
export async function getExecutions(params?: {
  flow_id?: string;
  status?: string;
  limit?: number;
}): Promise<Execution[]> {
  const query = new URLSearchParams();
  if (params?.flow_id) {
    query.append("flow_id", params.flow_id);
  }
  if (params?.status) {
    query.append("status", params.status);
  }
  if (params?.limit) {
    query.append("limit", String(params.limit));
  }
  const queryString = query.toString();
  const endpoint = `/api/executions${queryString ? `?${queryString}` : ""}`;
  return apiCall<Execution[]>(endpoint);
}

/**
 * 获取单个执行
 */
export async function getExecution(executionId: string): Promise<Execution> {
  return apiCall<Execution>(`/api/executions/${executionId}`);
}

/**
 * 取消执行
 */
export async function cancelExecution(executionId: string): Promise<void> {
  await apiCall(`/api/executions/${executionId}/cancel`, {
    method: "POST",
  });
}
