import { useCallback, useEffect, useRef, useState } from "react";
import { type Node, type Edge } from "@xyflow/react";
import { v4 as uuidv4 } from 'uuid'
import { getWebSocketTicket } from "@/lib/apiUtils";

// ==================== 类型定义 ====================

export type NodeExecutionStatus = "idle" | "running" | "success" | "failed" | "skipped";

export interface NodeExecutionResult {
  nodeId: string;
  status: NodeExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  duration?: number;
  message?: string;
  error?: string;
  screenshot?: string;
}

export interface ExecutionLog {
  timestamp: string;
  nodeId?: string;
  nodeName?: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

export type FlowExecutionStatus = "idle" | "running" | "completed" | "failed" | "stopped";

export interface FlowExecutionState {
  status: FlowExecutionStatus;
  startedAt?: string;
  finishedAt?: string;
  nodeResults: Record<string, NodeExecutionResult>;
  logs: ExecutionLog[];
  screenshot?: string;  // 最新截图（base64 data URL）
}

// WebSocket 消息类型（后台 -> 前端）
export interface ScreenshotData {
  image: string;  // base64 data URL
  timestamp: string;
}

export interface WebSocketMessage {
  type: "nodeStart" | "nodeComplete" | "flowComplete" | "error" | "screenshot";
  result?: NodeExecutionResult;
  status?: "completed" | "failed" | "stopped";
  message?: string;
  data?: ScreenshotData;
}

// WebSocket 连接状态
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

// 认证信息（预留扩展）
export interface AuthInfo {
  token?: string;
  userId?: string;
  // 后续可扩展: refreshToken, expiresAt 等
}

// ==================== Hook ====================

interface UseFlowWebSocketOptions {
  /** 客户端 ID，不传则自动生成 */
  clientId?: string;
  /** 认证信息（预留） */
  auth?: AuthInfo;
  /** 节点开始回调 */
  onNodeStart?: (nodeId: string, result: NodeExecutionResult) => void;
  /** 节点完成回调 */
  onNodeComplete?: (result: NodeExecutionResult) => void;
  /** 流程完成回调 */
  onFlowComplete?: (status: "completed" | "failed" | "stopped") => void;
  /** 错误回调 */
  onError?: (message: string) => void;
  /** 连接状态变化回调 */
  onConnectionChange?: (state: ConnectionState) => void;
}

export function useFlowWebSocket(options: UseFlowWebSocketOptions = {}) {
  const {
    clientId = uuidv4(),
    auth,
    onNodeStart,
    onNodeComplete,
    onFlowComplete,
    onError,
    onConnectionChange,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [executionState, setExecutionState] = useState<FlowExecutionState>({
    status: "idle",
    nodeResults: {},
    logs: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  // 构建 WebSocket URL（包含短期 ticket）
  const buildWebSocketUrl = useCallback(async () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    let url = `${protocol}//${host}/ws/flow/${clientId}`;

    if (auth?.token) {
      const ticket = await getWebSocketTicket();
      url += `?ticket=${encodeURIComponent(ticket)}`;
    }

    return url;
  }, [clientId, auth?.token]);

  // 连接 WebSocket
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionState("connecting");
    onConnectionChange?.("connecting");

    try {
      const url = await buildWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState("connected");
        onConnectionChange?.("connected");
        reconnectAttemptsRef.current = 0;
        console.log("[WebSocket] Connected:", clientId);
      };

      ws.onclose = (event) => {
        setConnectionState("disconnected");
        onConnectionChange?.("disconnected");
        console.log("[WebSocket] Disconnected:", event.code, event.reason);

        // 自动重连（非正常关闭时）
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimerRef.current = setTimeout(() => {
            void connect();
          }, delay);
        }
      };

      ws.onerror = (error) => {
        setConnectionState("error");
        onConnectionChange?.("error");
        console.error("[WebSocket] Error:", error);
        onError?.("WebSocket connection error");
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          handleMessage(data);
        } catch (e) {
          console.error("[WebSocket] Failed to parse message:", event.data, e);
        }
      };
    } catch (error) {
      setConnectionState("error");
      onConnectionChange?.("error");
      onError?.(error instanceof Error ? error.message : "WebSocket connection error");
    }
  }, [clientId, buildWebSocketUrl, onConnectionChange, onError]);

  // 处理消息
  const handleMessage = useCallback((data: WebSocketMessage) => {
    switch (data.type) {
      case "nodeStart":
        if (data.result) {
          onNodeStart?.(data.result.nodeId, data.result);
          setExecutionState((prev) => ({
            ...prev,
            status: "running",
            nodeResults: {
              ...prev.nodeResults,
              [data.result!.nodeId]: data.result!,
            },
            logs: [
              ...prev.logs,
              {
                timestamp: new Date().toISOString(),
                nodeId: data.result!.nodeId,
                level: "info",
                message: `Node ${data.result!.nodeId} started`,
              },
            ],
          }));
        }
        break;

      case "nodeComplete":
        if (data.result) {
          onNodeComplete?.(data.result);
          setExecutionState((prev) => ({
            ...prev,
            nodeResults: {
              ...prev.nodeResults,
              [data.result!.nodeId]: data.result!,
            },
            logs: [
              ...prev.logs,
              {
                timestamp: new Date().toISOString(),
                nodeId: data.result!.nodeId,
                level: data.result!.status === "success" ? "success" 
                  : data.result!.status === "failed" ? "error" : "warn",
                message: data.result!.message || `Node ${data.result!.nodeId} ${data.result!.status}`,
              },
            ],
          }));
        }
        break;

      case "flowComplete":
        const completeStatus: FlowExecutionStatus = data.status || "completed";
        setExecutionState((prev) => ({
          ...prev,
          status: completeStatus,
          finishedAt: new Date().toISOString(),
          logs: [
            ...prev.logs,
            {
              timestamp: new Date().toISOString(),
              level: completeStatus === "completed" ? "success" : "error",
              message: `Flow ${completeStatus}`,
            },
          ],
        }));
        onFlowComplete?.(completeStatus as "completed" | "failed" | "stopped");
        break;

      case "error":
        onError?.(data.message || "Unknown error");
        setExecutionState((prev) => ({
          ...prev,
          logs: [
            ...prev.logs,
            {
              timestamp: new Date().toISOString(),
              level: "error",
              message: data.message || "Unknown error",
            },
          ],
        }));
        break;

      case "screenshot":
        // 更新当前截图
        if (data.data?.image) {
          setExecutionState((prev) => ({
            ...prev,
            screenshot: data.data!.image,
          }));
        }
        break;
    }
  }, [onNodeStart, onNodeComplete, onFlowComplete, onError]);

  // 断开连接
  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }
    wsRef.current?.close(1000, "User disconnect");
    wsRef.current = null;
  }, []);

  // 执行流程
  const executeFlow = useCallback((nodes: Node[], edges: Edge[]) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      onError?.("WebSocket not connected");
      return false;
    }

    const flowData = { nodes, edges };
    wsRef.current.send(JSON.stringify(flowData));

    setExecutionState((prev) => ({
      ...prev,
      status: "running",
      startedAt: new Date().toISOString(),
      logs: [
        ...prev.logs,
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: "Flow execution started",
        },
      ],
    }));

    return true;
  }, [onError]);

  // 停止执行（预留，后台需要支持）
  const stopExecution = useCallback(() => {
    // TODO: 后台需要添加停止执行的接口
    console.log("[WebSocket] Stop execution requested (not implemented)");
  }, []);

  // 重置状态
  const resetState = useCallback(() => {
    setExecutionState({
      status: "idle",
      nodeResults: {},
      logs: [],
      screenshot: undefined,
    });
  }, []);

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    // 状态
    connectionState,
    executionState,
    isConnecting: connectionState === "connecting",
    isConnected: connectionState === "connected",
    isRunning: executionState.status === "running",
    
    // 方法
    connect,
    disconnect,
    executeFlow,
    stopExecution,
    resetState,
  };
}
