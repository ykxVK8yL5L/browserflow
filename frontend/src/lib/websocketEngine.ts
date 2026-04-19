/**
 * WebSocket 执行引擎 - 连接后台真实执行
 * 
 * 使用方式：
 * 1. 在组件中使用 useFlowWebSocket hook
 * 2. 或者使用 createWebSocketExecutor 创建执行器实例
 */

import { type Node, type Edge } from "@xyflow/react";
import { cancelExecution } from "./flowApi";
import { getWebSocketTicket } from "./apiUtils";
import { v4 as uuidv4 } from 'uuid'
// ==================== 类型定义 ====================

export type NodeExecutionStatus = "idle" | "running" | "success" | "failed" | "skipped";

export interface NodeExecutionResult {
  nodeId: string;
  nodeType?: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  durationMs?: number;
  message?: string;
  error?: string;
  screenshot?: string;
  data?: unknown;
}

/** Normalize backend payload fields into UI-friendly shape. */
function normalizeNodeExecutionResult(raw: NodeExecutionResult): NodeExecutionResult {
  const anyRaw: any = raw as any;

  const normalized: NodeExecutionResult = { ...raw };

  // Backend sends durationMs; UI historically reads duration.
  if ((normalized.duration == null || Number.isNaN(normalized.duration as any)) && anyRaw.durationMs != null) {
    const ms = Number(anyRaw.durationMs);
    if (!Number.isNaN(ms)) normalized.duration = ms;
  }

  // Backend can attach screenshot in data.
  if (!normalized.screenshot && anyRaw.data && typeof anyRaw.data === "object") {
    if (typeof anyRaw.data.filename === "string" || typeof anyRaw.data.path === "string") {
      // keep filename/path in data; screenshot itself is handled elsewhere
    }
  }

  // Normalize non-standard statuses from some handlers.
  if ((normalized as any).status === "completed") {
    (normalized as any).status = "success";
  }

  return normalized;
}

export interface FlowExecutionState {
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  startedAt?: string;
  finishedAt?: string;
  nodeResults: Record<string, NodeExecutionResult>;
  logs: ExecutionLog[];
}

export interface ExecutionLog {
  timestamp: string;
  nodeId?: string;
  nodeName?: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// 截图数据
export interface ScreenshotData {
  image: string;  // base64 data URL
  timestamp: string;
}

// WebSocket 消息类型（后台 -> 前端）
interface WebSocketMessage {
  type: "connected" | "nodeStart" | "nodeComplete" | "flowComplete" | "error" | "authRequired" | "screenshot" | "log" | "pong";
  executionId?: string;
  result?: NodeExecutionResult;
  status?: "completed" | "failed" | "stopped" | "cancelled";
  message?: string;
  data?: ScreenshotData;
}

// 认证信息
export interface AuthInfo {
  token?: string;
  userId?: string;
}

export interface ExecutionCallbacks {
  onNodeStart: (nodeId: string, result: NodeExecutionResult) => void;
  onNodeComplete: (result: NodeExecutionResult) => void;
  onLog: (log: ExecutionLog) => void;
  onFlowComplete: (status: "completed" | "failed" | "stopped") => void;
  onConnectionChange?: (state: ConnectionState) => void;
  onAuthRequired?: () => void;
  onScreenshot?: (data: ScreenshotData) => void;  // 实时截图回调
}

// ==================== WebSocket 执行器类 ====================

export class WebSocketFlowExecutor {
  private ws: WebSocket | null = null;
  private clientId: string;
  private auth: AuthInfo | null = null;
  private callbacks: ExecutionCallbacks;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentExecutionId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly heartbeatIntervalMs = 15000;
  private readonly heartbeatTimeoutMs = 10000;

  private normalizeFlowStatus(status?: WebSocketMessage["status"]): "completed" | "failed" | "stopped" {
    if (status === "stopped" || status === "cancelled") {
      return "stopped";
    }
    if (status === "failed") {
      return "failed";
    }
    return "completed";
  }
  private pendingExecution: {
    nodes: Node[];
    edges: Edge[];
    flowId?: string;
    options?: {
      identityId?: string;
      userAgentId?: string;
      headless?: boolean;
      viewport?: { width: number; height: number };
      locale?: string;
      timezone?: string;
      proxy?: string;
      humanize?: boolean;
    };
  } | null = null;

  constructor(
    callbacks: ExecutionCallbacks,
    options?: { clientId?: string; auth?: AuthInfo }
  ) {
    this.callbacks = callbacks;
    this.clientId = options?.clientId ?? uuidv4();
    this.auth = options?.auth ?? null;
  }

  /** 设置认证信息 */
  setAuth(auth: AuthInfo) {
    this.auth = auth;
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  private startHeartbeat(ws: WebSocket) {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws !== ws || ws.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }

      try {
        ws.send(JSON.stringify({
          type: "ping",
          timestamp: new Date().toISOString(),
        }));
      } catch {
        ws.close();
        return;
      }

      if (this.heartbeatTimeoutTimer) {
        clearTimeout(this.heartbeatTimeoutTimer);
      }

      this.heartbeatTimeoutTimer = setTimeout(() => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          console.warn("[WebSocketExecutor] Heartbeat timeout, reconnecting");
          ws.close();
        }
      }, this.heartbeatTimeoutMs);
    }, this.heartbeatIntervalMs);
  }

  /** 构建 WebSocket URL */
  private async buildUrl(): Promise<string> {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    let url = `${protocol}//${host}/ws/flow/${this.clientId}`;

    if (this.auth?.token) {
      const ticket = await getWebSocketTicket();
      url += `?ticket=${encodeURIComponent(ticket)}`;
    }

    return url;
  }

  /** 连接 WebSocket */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.callbacks.onConnectionChange?.("connecting");

      this.buildUrl()
        .then((url) => {
          const ws = new WebSocket(url);
          this.ws = ws;

          ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.callbacks.onConnectionChange?.("connected");
            console.log("[WebSocketExecutor] Connected:", this.clientId);
            this.startHeartbeat(ws);
            resolve();

            // 如果有待执行的流程，立即发送
            if (this.pendingExecution) {
              this.sendFlow(
                this.pendingExecution.nodes,
                this.pendingExecution.edges,
                this.pendingExecution.flowId,
                this.pendingExecution.options,
              );
              this.pendingExecution = null;
            }
          };

          ws.onclose = (event) => {
            if (this.ws === ws) {
              this.ws = null;
            }
            this.stopHeartbeat();
            this.callbacks.onConnectionChange?.("disconnected");
            console.log("[WebSocketExecutor] Disconnected:", event.code, event.reason);

            // 非正常关闭时自动重连
            if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
              this.reconnectAttempts++;
              const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
              console.log(`[WebSocketExecutor] Reconnecting in ${delay}ms`);
              this.reconnectTimer = setTimeout(() => {
                void this.connect();
              }, delay);
            }
          };

          ws.onerror = (error) => {
            this.callbacks.onConnectionChange?.("error");
            console.error("[WebSocketExecutor] Error:", error);
            reject(new Error("WebSocket connection error"));
          };

          ws.onmessage = (event) => {
            this.handleMessage(event.data);
          };
        })
        .catch((error) => {
          this.callbacks.onConnectionChange?.("error");
          reject(error instanceof Error ? error : new Error("Failed to get WebSocket ticket"));
        });
    });
  }

  /** 处理消息 */
  private handleMessage(data: string) {
    try {
      const msg: WebSocketMessage = JSON.parse(data);

      if (msg.executionId) {
        this.currentExecutionId = msg.executionId;
      }

      switch (msg.type) {
        case "connected":
          break;

        case "pong":
          if (this.heartbeatTimeoutTimer) {
            clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = null;
          }
          break;

        case "nodeStart":
          if (msg.result) {
            this.callbacks.onNodeStart(msg.result.nodeId, normalizeNodeExecutionResult(msg.result));
            this.callbacks.onLog({
              timestamp: new Date().toISOString(),
              nodeId: msg.result.nodeId,
              level: "info",
              message: `开始执行节点 ${msg.result.nodeId}`,
            });
          }
          break;

        case "nodeComplete":
          if (msg.result) {
            this.callbacks.onNodeComplete(normalizeNodeExecutionResult(msg.result));
            this.callbacks.onLog({
              timestamp: new Date().toISOString(),
              nodeId: msg.result.nodeId,
              level: msg.result.status === "success" ? "success" 
                : msg.result.status === "failed" ? "error" : "warn",
              message: msg.result.message || `节点 ${msg.result.nodeId} ${msg.result.status}`,
            });
          }
          break;

        case "flowComplete":
          this.currentExecutionId = null;
          {
            const normalizedStatus = this.normalizeFlowStatus(msg.status);
            this.callbacks.onFlowComplete(normalizedStatus);
            this.callbacks.onLog({
              timestamp: new Date().toISOString(),
              level:
                normalizedStatus === "completed"
                  ? "success"
                  : normalizedStatus === "stopped"
                    ? "warn"
                    : "error",
              message:
                normalizedStatus === "completed"
                  ? "流程执行完成"
                  : normalizedStatus === "stopped"
                    ? "流程已停止"
                    : "流程执行失败",
            });
          }
          break;

        case "error":
          this.callbacks.onLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: msg.message || "未知错误",
          });
          break;

        case "authRequired":
          this.callbacks.onAuthRequired?.();
          this.callbacks.onLog({
            timestamp: new Date().toISOString(),
            level: "warn",
            message: "需要登录验证",
          });
          break;

        case "screenshot":
          // 处理实时截图
          if (msg.data?.image) {
            this.callbacks.onScreenshot?.(msg.data);
          }
          break;

        case "log":
          if (msg.data) {
            const log = msg.data as unknown as ExecutionLog;
            this.callbacks.onLog({
              timestamp: log.timestamp || new Date().toISOString(),
              nodeId: log.nodeId,
              nodeName: log.nodeName,
              level: log.level || "info",
              message: log.message || "",
            });
          }
          break;
      }
    } catch (e) {
      console.error("[WebSocketExecutor] Failed to parse message:", data, e);
    }
  }

  /** 发送流程数据 */
  private sendFlow(
    nodes: Node[], 
    edges: Edge[], 
    flowId?: string, 
    options?: {
      identityId?: string;
      userAgentId?: string;
      headless?: boolean;
      viewport?: { width: number; height: number };
      locale?: string;
      timezone?: string;
      proxy?: string;
      humanize?: boolean;
    }
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    // 保留原始 credential 占位符，仅在后端执行时解析
    const processedNodes = nodes.map(node => {
      const rawData = node.data as Record<string, unknown>;
      const data: Record<string, unknown> = { ...rawData };
      // 为每个 node 添加 flowId 字段
      if (flowId) {
        data.flowId = flowId;
        console.log("[DEBUG] Added flowId to node:", node.id, flowId);
      }
      return { ...node, data };
    });
    // 构建消息
    const message: Record<string, unknown> = { 
      type: "execute",
      nodes: processedNodes, 
      edges,
      options: options || {}
    };
    this.ws.send(JSON.stringify(message));
  }

  /** 执行流程 */
  async executeFlow(
    nodes: Node[], 
    edges: Edge[], 
    flowId?: string, 
    options?: {
      identityId?: string;
      userAgentId?: string;
      headless?: boolean;
      viewport?: { width: number; height: number };
      locale?: string;
      timezone?: string;
      proxy?: string;
      humanize?: boolean;
      device?:string;
    }
  ): Promise<void> {    
    console.log("[DEBUG] executeFlow called with flowId:", flowId);    // 如果未连接，先连接
    this.currentExecutionId = null;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingExecution = { nodes, edges, flowId, options };
      await this.connect();
      return;
    }

    this.sendFlow(nodes, edges, flowId, options);
  }

  /** 停止当前执行 */
  async stopExecution(): Promise<void> {
    if (!this.currentExecutionId) {
      throw new Error("No running execution to stop");
    }
    await cancelExecution(this.currentExecutionId);
    this.callbacks.onLog({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: `已请求停止执行 ${this.currentExecutionId}`,
    });
  }

  /** 断开连接 */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, "User disconnect");
      this.ws = null;
    }
  }

  /** 获取连接状态 */
  get readyState(): ConnectionState {
    if (!this.ws) return "disconnected";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return "connecting";
      case WebSocket.OPEN: return "connected";
      case WebSocket.CLOSING:
      case WebSocket.CLOSED: return "disconnected";
      default: return "error";
    }
  }
}

// ==================== 工厂函数 ====================

/**
 * 创建 WebSocket 执行器实例
 * 
 * @example
 * ```ts
 * const executor = createWebSocketExecutor({
 *   onNodeStart: (nodeId, result) => console.log("开始:", nodeId),
 *   onNodeComplete: (result) => console.log("完成:", result),
 *   onLog: (log) => console.log("日志:", log),
 *   onFlowComplete: (status) => console.log("流程结束:", status),
 * });
 * 
 * // 执行流程
 * await executor.executeFlow(nodes, edges);
 * 
 * // 断开连接
 * executor.disconnect();
 * ```
 */
export function createWebSocketExecutor(
  callbacks: ExecutionCallbacks,
  options?: { clientId?: string; auth?: AuthInfo }
): WebSocketFlowExecutor {
  return new WebSocketFlowExecutor(callbacks, options);
}
