import { type Node, type Edge } from "@xyflow/react";

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

export interface FlowExecutionState {
  status: "idle" | "running" | "completed" | "failed" | "stopped";
  startedAt?: string;
  finishedAt?: string;
  nodeResults: Record<string, NodeExecutionResult>;
  logs: ExecutionLog[];
  screenshot?: string;
}

export interface ExecutionLog {
  timestamp: string;
  nodeId?: string;
  nodeName?: string;
  level: "info" | "success" | "error" | "warn";
  message: string;
}

/** Get topologically sorted node IDs based on edges */
function topoSort(nodes: Node[], edges: Edge[]): string[] {
  const adj: Record<string, string[]> = {};
  const inDeg: Record<string, number> = {};
  nodes.forEach((n) => { adj[n.id] = []; inDeg[n.id] = 0; });
  edges.forEach((e) => {
    adj[e.source]?.push(e.target);
    inDeg[e.target] = (inDeg[e.target] || 0) + 1;
  });

  const queue: string[] = [];
  nodes.forEach((n) => { if (inDeg[n.id] === 0) queue.push(n.id); });

  const sorted: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const next of adj[id] || []) {
      inDeg[next]--;
      if (inDeg[next] === 0) queue.push(next);
    }
  }
  return sorted;
}

export type ExecutionCallbacks = {
  onNodeStart: (nodeId: string) => void;
  onNodeComplete: (result: NodeExecutionResult) => void;
  onLog: (log: ExecutionLog) => void;
  onFlowComplete: (status: "completed" | "failed" | "stopped") => void;
};

/** Mock execution engine — runs nodes sequentially with simulated delays */
export async function executeFlow(
  nodes: Node[],
  edges: Edge[],
  callbacks: ExecutionCallbacks,
  signal: AbortSignal
): Promise<void> {
  const order = topoSort(nodes, edges);

  for (const nodeId of order) {
    if (signal.aborted) {
      callbacks.onFlowComplete("stopped");
      return;
    }

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;

    const rawData = node.data as Record<string, unknown>;
    const nodeName = (rawData.label as string) || "Node";
    const disabled = Boolean(rawData.disabled);

    // 保留原始 credential 占位符，前端不做解析
    const data: Record<string, unknown> = { ...rawData };

    if (disabled) {
      callbacks.onNodeComplete({
        nodeId, status: "skipped",
        message: "Node is disabled",
      });
      callbacks.onLog({
        timestamp: new Date().toISOString(),
        nodeId, nodeName, level: "warn",
        message: `Skipped (disabled)`,
      });
      continue;
    }

    callbacks.onNodeStart(nodeId);
    callbacks.onLog({
      timestamp: new Date().toISOString(),
      nodeId, nodeName, level: "info",
      message: `Executing ${data.nodeType}...`,
    });
    const startTime = Date.now();
    // Simulate execution delay (800-2500ms)
    const delay = 800 + Math.random() * 1700;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("Aborted")); }, { once: true });
    }).catch(() => {
      callbacks.onFlowComplete("stopped");
      return;
    });

    if (signal.aborted) {
      callbacks.onFlowComplete("stopped");
      return;
    }

    const duration = Date.now() - startTime;

    // Mock: 85% success rate
    const success = Math.random() > 0.15;

    const result: NodeExecutionResult = {
      nodeId,
      status: success ? "success" : "failed",
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      duration,
      message: success ? `${data.nodeType} completed` : `${data.nodeType} failed`,
      error: success ? undefined : `Simulated error: Element not found`,
    };

    callbacks.onNodeComplete(result);
    callbacks.onLog({
      timestamp: new Date().toISOString(),
      nodeId, nodeName,
      level: success ? "success" : "error",
      message: success ? `Completed in ${duration}ms` : `Failed: ${result.error}`,
    });

    if (!success) {
      callbacks.onFlowComplete("failed");
      return;
    }
  }

  callbacks.onFlowComplete("completed");
}
