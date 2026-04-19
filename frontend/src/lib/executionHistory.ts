import { type FlowExecutionState } from "./executionEngine";

// API 基础路径（使用 Vite 代理，不需要完整 URL）
const API_BASE = "/api/executions";

// 获取认证 token（从 bf_session 中获取）
interface StoredSession {
  userId: string;
  username: string;
  sessionId: string;
  token: string;
}

function getAuthToken(): string | null {
  const sessionStr = localStorage.getItem("bf_session");
  if (!sessionStr) return null;
  try {
    const session: StoredSession = JSON.parse(sessionStr);
    return session.token || null;
  } catch {
    return null;
  }
}

// 通用请求函数
async function apiRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options?.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export interface NodeExecutionRecord {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: string;
  status: string;
  message?: string;
  error?: string;
  result_data?: Record<string, unknown>;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  created_at: string;
}

export interface FlowSnapshot {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

export interface ExecutionRecord {
  id: string;
  flowId: string;
  flowName?: string;
  identityId?: string;
  identityName?: string;
  status: FlowExecutionState["status"];
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  nodeResults: FlowExecutionState["nodeResults"];
  logs: FlowExecutionState["logs"];
  nodeCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  flowSnapshot?: FlowSnapshot;
  nodeExecutions?: NodeExecutionRecord[];
}

export interface BackendNodeResult {
  nodeId: string;
  nodeType: string;
  status: string;
  message?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  screenshot?: string | null;
}

export interface PaginatedExecutions {
  records: ExecutionRecord[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STORAGE_KEY = "browserflow-executions";
const MAX_RECORDS = 50;

/** Get all executions for a flow (unpaginated, for backward compat) */
export function getExecutions(flowId: string): ExecutionRecord[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const all: ExecutionRecord[] = JSON.parse(raw);
  return all.filter((r) => r.flowId === flowId).sort((a, b) =>
    new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime()
  );
}

/** Get paginated executions for a flow (local storage) */
export function getExecutionsPaginated(
  flowId: string,
  page: number = 1,
  pageSize: number = 10
): PaginatedExecutions {
  const all = getExecutions(flowId);
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const records = all.slice(start, start + pageSize);
  return { records, total, page: safePage, pageSize, totalPages };
}

/** Get paginated executions for a flow from backend */
export async function getExecutionsPaginatedFromBackend(
  flowId: string,
  page: number = 1,
  pageSize: number = 10
): Promise<PaginatedExecutions> {
  const params = new URLSearchParams({
    flow_id: flowId,
    page: String(page),
    pageSize: String(pageSize),
  });

  const data = await apiRequest<{
    records: Array<{
      id: string;
      flow_id: string;
      flow_name?: string;
      identity_id?: string;
      identity_name?: string;
      status: string;
      started_at?: string;
      finished_at?: string;
      created_at: string;
      flow_snapshot?: FlowSnapshot;
      logs?: Array<{
        timestamp: string;
        nodeId?: string;
        nodeName?: string;
        level: "info" | "success" | "error" | "warn";
        message: string;
      }>;
      node_results?: Record<string, BackendNodeResult>;
      node_count?: number;
      success_count?: number;
      failed_count?: number;
      skipped_count?: number;
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }>(`${API_BASE}/paginated?${params}`);

  // 转换字段名以匹配前端格式
  return {
    records: data.records.map((r) => ({
      id: r.id,
      flowId: r.flow_id,
      flowName: r.flow_name,
      identityId: r.identity_id,
      identityName: r.identity_name,
      status: r.status as FlowExecutionState["status"],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      flowSnapshot: r.flow_snapshot,
      nodeResults: r.node_results || {},
      logs:  r.logs || [],
      nodeCount: r.node_count ?? 0,
      successCount: r.success_count ?? 0,
      failedCount: r.failed_count ?? 0,
      skippedCount: r.skipped_count ?? 0,
    })),
    total: data.total,
    page: data.page,
    pageSize: data.pageSize,
    totalPages: data.totalPages,
  };
}

/** Get execution detail with node executions from backend */
export async function getExecutionDetail(executionId: string): Promise<ExecutionRecord | null> {
  try {
    const data = await apiRequest<{
      id: string;
      flow_id: string;
      flow_name?: string;
      identity_id?: string;
      identity_name?: string;
      status: string;
      started_at?: string;
      finished_at?: string;
      created_at: string;
      flow_snapshot?: FlowSnapshot;
      node_executions?: Array<{
        id: string;
        execution_id: string;
        node_id: string;
        node_type: string;
        status: string;
        message?: string;
        error?: string;
        result_data?: Record<string, unknown>;
        started_at?: string;
        finished_at?: string;
        duration_ms?: number;
        created_at: string;
      }>;
    }>(`${API_BASE}/${executionId}/detail`);

    return {
      id: data.id,
      flowId: data.flow_id,
      flowName: data.flow_name,
      identityId: data.identity_id,
      identityName: data.identity_name,
      status: data.status as FlowExecutionState["status"],
      startedAt: data.started_at,
      finishedAt: data.finished_at,
      flowSnapshot: data.flow_snapshot,
      nodeResults: {},
      logs: [],
      nodeCount: data.node_executions?.length || 0,
      successCount: data.node_executions?.filter((n) => n.status === "success").length || 0,
      failedCount: data.node_executions?.filter((n) => n.status === "failed").length || 0,
      skippedCount: data.node_executions?.filter((n) => n.status === "skipped").length || 0,
      nodeExecutions: data.node_executions?.map((n) => ({
        id: n.id,
        execution_id: n.execution_id,
        node_id: n.node_id,
        node_type: n.node_type,
        status: n.status,
        message: n.message,
        error: n.error,
        result_data: n.result_data,
        started_at: n.started_at,
        finished_at: n.finished_at,
        duration_ms: n.duration_ms,
        created_at: n.created_at,
      })),
    };
  } catch {
    return null;
  }
}

export function saveExecution(record: ExecutionRecord): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  const all: ExecutionRecord[] = raw ? JSON.parse(raw) : [];
  all.unshift(record);
  // Keep only the latest records
  if (all.length > MAX_RECORDS) all.length = MAX_RECORDS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function deleteExecution(id: string): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  const all: ExecutionRecord[] = JSON.parse(raw);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter((r) => r.id !== id)));
}

/** Delete execution from backend */
export async function deleteExecutionFromBackend(id: string): Promise<void> {
  await apiRequest(`${API_BASE}/${id}`, { method: "DELETE" });
}

export interface CleanupExecutionsResult {
  deleted_executions: number;
  deleted_node_executions: number;
  deleted_screenshot_dirs: number;
  kept_executions: number;
  database_compacted: boolean;
  freelist_before?: number | null;
  freelist_after?: number | null;
  page_count_before?: number | null;
  page_count_after?: number | null;
}

export async function cleanupExecutions(flowId: string): Promise<CleanupExecutionsResult> {
  return apiRequest<CleanupExecutionsResult>(`${API_BASE}/cleanup`, {
    method: "POST",
    body: JSON.stringify({
      flow_id: flowId,
      keep_latest: 0,
      vacuum: true,
    }),
  });
}

export async function clearExecutions(flowId: string): Promise<void> {
  await cleanupExecutions(flowId);

  // 清除本地 localStorage
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const all: ExecutionRecord[] = JSON.parse(raw);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.filter((r) => r.flowId !== flowId)));
  }
}
