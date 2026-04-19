import { type Node, type Edge } from "@xyflow/react";
import { v4 as uuidv4 } from 'uuid'
import {
  getFlows as apiGetFlows,
  getFlow as apiGetFlow,
  createFlow as apiCreateFlow,
  updateFlow as apiUpdateFlow,
  deleteFlow as apiDeleteFlow,
  type Flow as ApiFlow,
  type FlowListPageResponse as ApiFlowListPageResponse,
  type RunSettings,
} from "./flowApi";
import type { FlowNotificationRule } from "./notificationApi";

// ─── Types ──────────────────────────────────────────────

export interface Flow {
  id: string;
  name: string;
  description: string;
  nodes: Node[];
  edges: Edge[];
  run_settings?: RunSettings;
  createdAt: string;
  updatedAt: string;
  identityId?: string;
  notificationEnabled: boolean;
  notificationRules?: FlowNotificationRule[];
}

export interface FlowListPage {
  items: Flow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Local Storage (用于离线缓存) ──────────────────────

const STORAGE_KEY = "browserflow-flows";

function getLocalFlows(): Flow[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }
  return JSON.parse(raw);
}

function saveLocalFlows(flows: Flow[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(flows));
}

// ─── API <-> Local 转换 ────────────────────────────────

function apiToLocalFlow(apiFlow: ApiFlow): Flow {
  return {
    id: apiFlow.id,
    name: apiFlow.name,
    description: apiFlow.description || "",
    nodes: apiFlow.flow_data?.nodes || [],
    edges: apiFlow.flow_data?.edges || [],
    run_settings: apiFlow.run_settings,
    createdAt: apiFlow.created_at,
    updatedAt: apiFlow.updated_at,
    identityId: apiFlow.identity_id,
    notificationEnabled: apiFlow.notification_enabled,
    notificationRules: apiFlow.notification_rules || [],
  };
}

function localToApiInput(flow: Partial<Flow>): {
  name?: string;
  description?: string;
  flow_data?: { nodes: Node[]; edges: Edge[] };
  run_settings?: RunSettings;
  identity_id?: string;
  notification_enabled?: boolean;
  notification_rules?: FlowNotificationRule[];
} {
  const result: {
    name?: string;
    description?: string;
    flow_data?: { nodes: Node[]; edges: Edge[] };
    run_settings?: RunSettings;
    identity_id?: string;
    notification_enabled?: boolean;
    notification_rules?: FlowNotificationRule[];
  } = {};

  if (flow.name !== undefined) {
    result.name = flow.name;
  }
  if (flow.description !== undefined) {
    result.description = flow.description;
  }
  if (flow.nodes !== undefined || flow.edges !== undefined) {
    result.flow_data = {
      nodes: flow.nodes || [],
      edges: flow.edges || [],
    };
  }
  if (flow.run_settings !== undefined) {
    result.run_settings = flow.run_settings;
  }
  if (flow.identityId !== undefined) {
    result.identity_id = flow.identityId;
  }
  if (flow.notificationEnabled !== undefined) {
    result.notification_enabled = flow.notificationEnabled;
  }
  if (flow.notificationRules !== undefined) {
    result.notification_rules = flow.notificationRules;
  }

  return result;
}

// ─── API 函数 (异步版本) ────────────────────────────────

/**
 * 获取所有 Flow 列表（从 API）
 */
export async function fetchFlows(params?: {
  is_template?: boolean;
  is_active?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<FlowListPage> {
  try {
    const apiResponse = await apiGetFlows({
      is_template: params?.is_template,
      is_active: params?.is_active,
      page: params?.page,
      page_size: params?.pageSize,
    });
    const flows = apiResponse.items.map(apiToLocalFlow);
    // 更新本地缓存
    saveLocalFlows(flows);
    return {
      items: flows,
      total: apiResponse.total,
      page: apiResponse.page,
      pageSize: apiResponse.page_size,
      totalPages: apiResponse.total_pages,
    };
  } catch (error) {
    console.error("Failed to fetch flows from API, using local cache:", error);
    const flows = getLocalFlows();
    return {
      items: flows,
      total: flows.length,
      page: 1,
      pageSize: flows.length || 1,
      totalPages: 1,
    };
  }
}

/**
 * 获取单个 Flow（从 API）
 */
export async function fetchFlow(id: string): Promise<Flow | undefined> {
  try {
    const apiFlow = await apiGetFlow(id);
    return apiToLocalFlow(apiFlow);
  } catch (error) {
    console.error("Failed to fetch flow from API:", error);
    return getLocalFlows().find((f) => f.id === id);
  }
}

/**
 * 创建 Flow（保存到 API）
 */
export async function createFlowAsync(
  name: string,
  description: string,
  identityId?: string,
  notificationEnabled?: boolean,
  notificationRules?: FlowNotificationRule[]
): Promise<Flow> {
  const apiFlow = await apiCreateFlow({
    name,
    description,
    flow_data: { nodes: [], edges: [] },
    identity_id: identityId,
    notification_enabled: notificationEnabled,
    notification_rules: notificationRules,
  });
  const flow = apiToLocalFlow(apiFlow);

  // 更新本地缓存
  const localFlows = getLocalFlows();
  localFlows.push(flow);
  saveLocalFlows(localFlows);

  return flow;
}

/**
 * 更新 Flow（保存到 API）
 */
export async function updateFlowAsync(
  id: string,
  updates: Partial<Pick<Flow, "name" | "description" | "nodes" | "edges" | "run_settings" | "identityId" | "notificationEnabled" | "notificationRules">>
): Promise<Flow> {
  const apiInput = localToApiInput(updates);
  const apiFlow = await apiUpdateFlow(id, apiInput);
  const flow = apiToLocalFlow(apiFlow);

  // 更新本地缓存
  const localFlows = getLocalFlows();
  const idx = localFlows.findIndex((f) => f.id === id);
  if (idx !== -1) {
    localFlows[idx] = flow;
    saveLocalFlows(localFlows);
  }

  return flow;
}

/**
 * 删除 Flow（从 API）
 */
export async function deleteFlowAsync(id: string): Promise<void> {
  await apiDeleteFlow(id);

  // 更新本地缓存
  const localFlows = getLocalFlows().filter((f) => f.id !== id);
  saveLocalFlows(localFlows);
}

// ─── 同步版本（兼容旧代码，使用本地缓存）──────────────

/**
 * 获取本地缓存的 Flow 列表
 * @deprecated 使用 fetchFlows() 从 API 获取
 */
export function getFlows(): Flow[] {
  return getLocalFlows();
}

/**
 * 保存 Flow 列表到本地
 * @deprecated 使用 createFlowAsync/updateFlowAsync 保存到 API
 */
export function saveFlows(flows: Flow[]): void {
  saveLocalFlows(flows);
}

/**
 * 获取本地缓存的单个 Flow
 * @deprecated 使用 fetchFlow() 从 API 获取
 */
export function getFlow(id: string): Flow | undefined {
  return getLocalFlows().find((f) => f.id === id);
}

/**
 * 创建 Flow（仅本地）
 * @deprecated 使用 createFlowAsync() 保存到 API
 */
export function createFlow(name: string, description: string): Flow {
  const newFlow: Flow = {
    id: uuidv4(),
    name,
    description,
    nodes: [],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const flows = getLocalFlows();
  flows.push(newFlow);
  saveLocalFlows(flows);

  return newFlow;
}

/**
 * 更新 Flow（仅本地）
 * @deprecated 使用 updateFlowAsync() 保存到 API
 */
export function updateFlow(
  id: string,
  updates: Partial<Pick<Flow, "name" | "description" | "nodes" | "edges">>
): void {
  const flows = getLocalFlows();
  const idx = flows.findIndex((f) => f.id === id);
  if (idx === -1) return;

  flows[idx] = {
    ...flows[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveLocalFlows(flows);
}

/**
 * 删除 Flow（仅本地）
 * @deprecated 使用 deleteFlowAsync() 从 API 删除
 */
export function deleteFlow(id: string): void {
  const flows = getLocalFlows().filter((f) => f.id !== id);
  saveLocalFlows(flows);
}
