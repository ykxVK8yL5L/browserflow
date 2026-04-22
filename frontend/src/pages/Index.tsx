import { ReactFlowProvider } from "@xyflow/react";
import FlowCanvas from "@/components/flow/FlowCanvas";
import Sidebar from "@/components/flow/Sidebar";
import ExecutionPanel from "@/components/flow/ExecutionPanel";
import ExecutionsPanel from "@/components/flow/ExecutionsPanel";
import LiveFeedPanel from "@/components/flow/LiveFeedPanel";
import {
  Workflow,
  PanelLeftOpen,
  PanelLeftClose,
  ArrowLeft,
  ArrowUpRight,
  Play,
  Square,
  Terminal,
  Monitor,
  Save,
  RotateCcw,
  Eraser,
  History,
  Download,
  Upload,
  LayoutTemplate,
  KeyRound,
  MoreVertical,
  Settings2,
} from "lucide-react";
import CredentialsManager from "@/components/flow/CredentialsManager";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getFlow, updateFlowAsync, fetchFlow } from "@/lib/flowStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { loadUserAgents } from "@/lib/userAgentStore";
import { type UserAgent } from "@/lib/userAgentApi";
import {
  executeFlow,
  type FlowExecutionState,
  type NodeExecutionResult,
  type ExecutionLog,
} from "@/lib/executionEngine";
import {
  createWebSocketExecutor,
  type WebSocketFlowExecutor,
} from "@/lib/websocketEngine";
import { getSession } from "@/lib/authStore";
import { saveExecution, type ExecutionRecord } from "@/lib/executionHistory";
import type { Node, Edge } from "@xyflow/react";
import { toast } from "sonner";
import { v4 as uuidv4 } from 'uuid'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import type { RunSettings } from "@/lib/flowApi";
import { getTemplateIndex, getTemplateItem, type TemplateIndexItem } from "@/lib/templateApi";

const initialExecState: FlowExecutionState = {
  status: "idle",
  nodeResults: {},
  logs: [],
  screenshot: undefined,
};

// 执行模式：mock 使用本地模拟，websocket 连接后台真实执行
// TODO: 后续可以从配置或环境变量读取
const EXECUTION_MODE: "mock" | "websocket" = "websocket";

// 设备选项列表（与后端 device_profiles 对应）
const DEVICE_OPTIONS = [
  "Desktop Chrome",
  "Desktop Edge",
  "Desktop Firefox",
  "Desktop Safari",
  "iPhone 6",
  "iPhone 6 Plus",
  "iPhone 7",
  "iPhone 7 Plus",
  "iPhone 8",
  "iPhone 8 Plus",
  "iPhone SE",
  "iPhone SE (3rd gen)",
  "iPhone X",
  "iPhone XR",
  "iPhone 11",
  "iPhone 11 Pro",
  "iPhone 11 Pro Max",
  "iPhone 12",
  "iPhone 12 Pro",
  "iPhone 12 Pro Max",
  "iPhone 12 Mini",
  "iPhone 13",
  "iPhone 13 Pro",
  "iPhone 13 Pro Max",
  "iPhone 13 Mini",
  "iPhone 14",
  "iPhone 14 Plus",
  "iPhone 14 Pro",
  "iPhone 14 Pro Max",
  "iPhone 15",
  "iPhone 15 Plus",
  "iPhone 15 Pro",
  "iPhone 15 Pro Max",
  "iPad (gen 5)",
  "iPad (gen 6)",
  "iPad (gen 7)",
  "iPad (gen 11)",
  "iPad Mini",
  "iPad Pro 11",
  "Galaxy S III",
  "Galaxy S5",
  "Galaxy S8",
  "Galaxy S9+",
  "Galaxy S24",
  "Galaxy A55",
  "Galaxy Tab S4",
  "Galaxy Tab S9",
  "Pixel 2",
  "Pixel 2 XL",
  "Pixel 3",
  "Pixel 4",
  "Pixel 4a (5G)",
  "Pixel 5",
  "Pixel 7",
  "Moto G4",
  "Nexus 5",
  "Nexus 5X",
  "Nexus 6",
  "Nexus 6P",
  "Nexus 7",
  "Nexus 10",
  "BlackBerry Z30",
  "Blackberry PlayBook",
  "Kindle Fire HDX",
  "LG Optimus L70",
  "Microsoft Lumia 550",
  "Microsoft Lumia 950",
  "Nokia Lumia 520",
  "Nokia N9",
];

const DEFAULT_RUN_SETTINGS: Required<RunSettings> = {
  headless: true,
  userAgentId: "device", // "device" 表示使用设备配置的 userAgent
  viewport: {
    width: 1920,
    height: 1080,
  },
  locale: "en-US",
  timezone: "America/New_York",
  proxy: "",
  humanize: true,
  device: "Desktop Chrome",
};

const TEMPLATE_PAGE_SIZE = 6;

const mergeRunSettings = (settings?: RunSettings | null): Required<RunSettings> => ({
  ...DEFAULT_RUN_SETTINGS,
  ...(settings || {}),
  viewport: {
    ...DEFAULT_RUN_SETTINGS.viewport,
    ...((settings && settings.viewport) || {}),
  },
});

const appendImportedFlow = (
  currentNodes: Node[],
  currentEdges: Edge[],
  importedNodes: Node[],
  importedEdges: Edge[],
) => {
  const existingIds = new Set(currentNodes.map((node) => node.id));
  const idMap = new Map<string, string>();

  const nextNodeId = (originalId: string) => {
    let candidate = originalId;
    while (existingIds.has(candidate) || idMap.has(candidate)) {
      candidate = `${originalId}_${Math.random().toString(36).slice(2, 8)}`;
    }
    existingIds.add(candidate);
    return candidate;
  };

  const baseMaxY = currentNodes.length
    ? Math.max(...currentNodes.map((node) => node.position.y))
    : 0;
  const importedMinX = importedNodes.length
    ? Math.min(...importedNodes.map((node) => node.position.x))
    : 0;
  const importedMinY = importedNodes.length
    ? Math.min(...importedNodes.map((node) => node.position.y))
    : 0;
  const offsetX = currentNodes.length ? 80 : 0;
  const offsetY = currentNodes.length ? baseMaxY - importedMinY + 180 : 0;

  const appendedNodes: Node[] = importedNodes.map((node) => {
    const nextId = nextNodeId(node.id);
    idMap.set(node.id, nextId);
    return {
      ...node,
      id: nextId,
      selected: false,
      position: {
        x: node.position.x - importedMinX + offsetX,
        y: node.position.y + offsetY,
      },
      data: {
        ...node.data,
        _execStatus: undefined,
        _execMessage: undefined,
        _execError: undefined,
        _execDuration: undefined,
      },
    };
  });

  const appendedEdges: Edge[] = importedEdges.map((edge, index) => ({
    ...edge,
    id: `${edge.id || "edge"}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    source: idMap.get(edge.source) || edge.source,
    target: idMap.get(edge.target) || edge.target,
    selected: false,
  }));

  return {
    nodes: [...currentNodes, ...appendedNodes],
    edges: [...currentEdges, ...appendedEdges],
  };
};

const Index = () => {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const addNodeFnRef = useRef<((nodeType: string) => void) | null>(null);
  const resetFnRef = useRef<((nodes: Node[], edges: Edge[]) => void) | null>(
    null,
  );
  const [execState, setExecState] =
    useState<FlowExecutionState>(initialExecState);
  const [panelOpen, setPanelOpen] = useState(false);
  const [liveFeedOpen, setLiveFeedOpen] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [executionsOpen, setExecutionsOpen] = useState(false);
  const [executionsRefreshKey, setExecutionsRefreshKey] = useState(0);
  const [canvasHasResults, setCanvasHasResults] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<{
    nodes: Node[];
    edges: Edge[];
  } | null>(null);
  const [historyNodeResults, setHistoryNodeResults] = useState<ExecutionRecord["nodeResults"]>({});
  const [historyViewingExecution, setHistoryViewingExecution] = useState<ExecutionRecord | null>(null);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [runSettingsOpen, setRunSettingsOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateImportingId, setTemplateImportingId] = useState<string | null>(null);
  const [templateItems, setTemplateItems] = useState<TemplateIndexItem[]>([]);
  const [templateCategories, setTemplateCategories] = useState<Record<string, { label: string; description: string }>>({});
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<string>("all");
  const [templateKeyword, setTemplateKeyword] = useState("");
  const [templatePage, setTemplatePage] = useState(1);
  const [runSettings, setRunSettings] = useState<Required<RunSettings>>(DEFAULT_RUN_SETTINGS);
  const [userAgents, setUserAgents] = useState<UserAgent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const savedNodesRef = useRef<Node[]>([]);
  const savedEdgesRef = useRef<Edge[]>([]);
  const savedRunSettingsRef = useRef<Required<RunSettings>>(DEFAULT_RUN_SETTINGS);
  const isMobile = useIsMobile();
  const setNodeExecStatusRef = useRef<
    | ((
      nodeId: string,
      status: string,
      detail?: { message?: string; error?: string; duration?: number },
    ) => void)
    | null
  >(null);

  // WebSocket 执行器实例（用于 websocket 模式）
  const wsExecutorRef = useRef<WebSocketFlowExecutor | null>(null);

  const [flow, setFlow] = useState<ReturnType<typeof getFlow>>(undefined);
  const [loading, setLoading] = useState(true);


  // 根据屏幕自动控制
  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false); // 手机默认关闭
    } else {
      setSidebarOpen(true); // 桌面默认打开
    }
  }, [isMobile]);

  // 从 API 加载 Flow
  useEffect(() => {
    if (flowId) {
      setLoading(true);
      fetchFlow(flowId)
        .then(setFlow)
        .catch((err) => {
          console.error("Failed to load flow:", err);
          // 尝试从本地缓存加载
          const localFlow = getFlow(flowId);
          setFlow(localFlow);
        })
        .finally(() => setLoading(false));
    } else {
      setFlow(undefined);
      setLoading(false);
    }

    loadUserAgents().then(setUserAgents).catch(console.error);
  }, [flowId]);

  // Strip execution data from nodes so they load clean
  const stripExecData = (nodes: Node[]) =>
    nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        _execStatus: undefined,
        _execMessage: undefined,
        _execError: undefined,
        _execDuration: undefined,
      },
    }));

  useEffect(() => {
    if (!flow) return;

    const cleanNodes = stripExecData(flow.nodes);
    const mergedRunSettings = mergeRunSettings(flow.run_settings);
    savedNodesRef.current = cleanNodes;
    savedEdgesRef.current = flow.edges;
    savedRunSettingsRef.current = mergedRunSettings;
    nodesRef.current = cleanNodes;
    edgesRef.current = flow.edges;
    setRunSettings(mergedRunSettings);
    setHasUnsaved(false);
  }, [flow]);

  const updateRunSettings = useCallback(
    (updater: Required<RunSettings> | ((prev: Required<RunSettings>) => Required<RunSettings>)) => {
      setRunSettings((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        setHasUnsaved(true);
        return next;
      });
    },
    [],
  );

  const handleAddNode = (nodeType: string) => {
    addNodeFnRef.current?.(nodeType);
  };

  const handleFlowChange = useCallback((nodes: Node[], edges: Edge[]) => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    setHasUnsaved(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (flowId) {
      try {
        const cleanNodes = stripExecData(nodesRef.current);
        const updatedFlow = await updateFlowAsync(flowId, {
          nodes: cleanNodes,
          edges: edgesRef.current,
          run_settings: runSettings,
        });
        setFlow(updatedFlow);
        savedNodesRef.current = cleanNodes;
        savedEdgesRef.current = edgesRef.current;
        savedRunSettingsRef.current = runSettings;
        setHasUnsaved(false);
        toast.success("Flow saved");
      } catch (error) {
        console.error("Failed to save flow:", error);
        toast.error("Failed to save flow");
      }
    }
  }, [flowId, runSettings]);

  const handleReset = useCallback(() => {
    resetFnRef.current?.(savedNodesRef.current, savedEdgesRef.current);
    nodesRef.current = savedNodesRef.current;
    edgesRef.current = savedEdgesRef.current;
    setRunSettings(savedRunSettingsRef.current);
    setHasUnsaved(false);
  }, []);

  const handleExport = useCallback(() => {
    const data = {
      name: flow?.name || "flow",
      description: flow?.description || "",
      nodes: stripExecData(nodesRef.current),
      edges: edgesRef.current,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(flow?.name || "flow").replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Flow exported");
  }, [flow]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          if (!data.nodes || !Array.isArray(data.nodes)) {
            toast.error("Invalid flow file");
            return;
          }
          const cleanNodes = stripExecData(data.nodes);
          const merged = appendImportedFlow(
            nodesRef.current,
            edgesRef.current,
            cleanNodes,
            data.edges || [],
          );
          resetFnRef.current?.(merged.nodes, merged.edges);
          nodesRef.current = merged.nodes;
          edgesRef.current = merged.edges;
          setHasUnsaved(true);
          toast.success(
            `Imported "${data.name || "flow"}" (${cleanNodes.length} nodes)`,
          );
        } catch {
          toast.error("Failed to parse flow file");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, []);

  const loadTemplateIndex = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const data = await getTemplateIndex();
      setTemplateItems(data.items || []);
      setTemplatePage(1);
      setTemplateCategories(
        Object.fromEntries(
          (data.categories || []).map((category) => [
            category.key,
            { label: category.label, description: category.description },
          ]),
        ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "加载模板列表失败");
      throw error;
    } finally {
      setTemplateLoading(false);
    }
  }, []);

  const handleOpenTemplateDialog = useCallback(async () => {
    setTemplateDialogOpen(true);
    if (templateItems.length > 0) {
      return;
    }
    await loadTemplateIndex();
  }, [loadTemplateIndex, templateItems.length]);

  const handleImportTemplate = useCallback(async (templateId: string) => {
    setTemplateImportingId(templateId);
    try {
      const template = await getTemplateItem(templateId);
      const cleanNodes = stripExecData(template.nodes as Node[]);
      const cleanEdges = (template.edges || []) as Edge[];
      const merged = appendImportedFlow(
        nodesRef.current,
        edgesRef.current,
        cleanNodes,
        cleanEdges,
      );
      resetFnRef.current?.(merged.nodes, merged.edges);
      nodesRef.current = merged.nodes;
      edgesRef.current = merged.edges;
      setHasUnsaved(true);
      setTemplateDialogOpen(false);
      toast.success(`已导入模板“${template.name}”`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入模板失败");
    } finally {
      setTemplateImportingId(null);
    }
  }, []);

  const filteredTemplateItems = useMemo(() => {
    const keyword = templateKeyword.trim().toLowerCase();
    return templateItems.filter((item) => {
      const matchesCategory = templateCategoryFilter === "all" || item.category === templateCategoryFilter;
      const matchesKeyword =
        !keyword ||
        item.name.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword) ||
        item.tags.some((tag) => tag.toLowerCase().includes(keyword));
      return matchesCategory && matchesKeyword;
    });
  }, [templateCategoryFilter, templateItems, templateKeyword]);

  const templatePageCount = Math.max(1, Math.ceil(filteredTemplateItems.length / TEMPLATE_PAGE_SIZE));
  const pagedTemplateItems = useMemo(() => {
    const safePage = Math.min(templatePage, templatePageCount);
    const start = (safePage - 1) * TEMPLATE_PAGE_SIZE;
    return filteredTemplateItems.slice(start, start + TEMPLATE_PAGE_SIZE);
  }, [filteredTemplateItems, templatePage, templatePageCount]);

  useEffect(() => {
    setTemplatePage(1);
  }, [templateCategoryFilter, templateKeyword]);

  useEffect(() => {
    if (templatePage > templatePageCount) {
      setTemplatePage(templatePageCount);
    }
  }, [templatePage, templatePageCount]);

  const handleRun = useCallback(() => {
    if (execState.status === "running") {
      // 停止执行
      if (EXECUTION_MODE === "websocket" && wsExecutorRef.current) {
        wsExecutorRef.current
          .stopExecution()
          .then(() => {
            setExecState((prev) => ({
              ...prev,
              status: "stopped",
              finishedAt: new Date().toISOString(),
            }));
            toast.success("已请求停止执行");
          })
          .catch((error) => {
            console.error("Failed to stop execution:", error);
            toast.error(error instanceof Error ? error.message : "停止执行失败");
          });
      } else {
        abortRef.current?.abort();
      }
      return;
    }
    const nodes = nodesRef.current;
    const edges = edgesRef.current;
    if (nodes.length === 0) return;
    // Reset all node statuses
    setNodeExecStatusRef.current?.("__reset__", "idle");
    setCanvasHasResults(false);
    setExecState({
      status: "running",
      startedAt: new Date().toISOString(),
      nodeResults: {},
      logs: [],
      screenshot: undefined,
    });
    setPanelOpen(true);

    if (EXECUTION_MODE === "websocket") {
      // WebSocket 模式：连接后台真实执行
      wsExecutorRef.current?.disconnect();

      const executor = createWebSocketExecutor(
        {
          onNodeStart: (nodeId: string) => {
            setNodeExecStatusRef.current?.(nodeId, "running");
            setExecState((prev) => ({
              ...prev,
              nodeResults: {
                ...prev.nodeResults,
                [nodeId]: { nodeId, status: "running" },
              },
            }));
          },
          onNodeComplete: (result: NodeExecutionResult) => {
            setCanvasHasResults(true);
            setNodeExecStatusRef.current?.(result.nodeId, result.status, {
              message: result.message,
              error: result.error,
              duration: result.duration,
            });
            setExecState((prev) => ({
              ...prev,
              nodeResults: { ...prev.nodeResults, [result.nodeId]: result },
            }));
          },
          onLog: (log: ExecutionLog) => {
            setExecState((prev) => ({ ...prev, logs: [...prev.logs, log] }));
          },
          onFlowComplete: (status) => {
            setExecState((prev) => {
              const finishedState = {
                ...prev,
                status,
                finishedAt: new Date().toISOString(),
              };
              const results = Object.values(finishedState.nodeResults);
              const record: ExecutionRecord = {
                id: uuidv4(),
                flowId: flowId || "unknown",
                status: finishedState.status,
                startedAt: finishedState.startedAt || new Date().toISOString(),
                finishedAt: finishedState.finishedAt,
                duration: finishedState.startedAt
                  ? new Date(finishedState.finishedAt!).getTime() -
                  new Date(finishedState.startedAt).getTime()
                  : undefined,
                nodeResults: finishedState.nodeResults,
                logs: finishedState.logs,
                nodeCount: results.length,
                successCount: results.filter((r) => r.status === "success")
                  .length,
                failedCount: results.filter((r) => r.status === "failed")
                  .length,
                skippedCount: results.filter((r) => r.status === "skipped")
                  .length,
              };
              saveExecution(record);
              setExecutionsRefreshKey((k) => k + 1);
              return finishedState;
            });

            if (wsExecutorRef.current === executor) {
              wsExecutorRef.current = null;
            }
            executor.disconnect();
          },
          onConnectionChange: (state) => {
            if (state === "error") toast.error("无法连接到后台服务器");
            else if (state === "connected") toast.success("已连接到后台服务器");
          },
          onAuthRequired: () => {
            if (wsExecutorRef.current === executor) {
              wsExecutorRef.current = null;
            }
            executor.disconnect();
            toast.error("需要登录验证");
          },
          onScreenshot: (data) => {
            // 更新实时截图
            setExecState((prev) => ({
              ...prev,
              screenshot: data.image,
            }));
          },
        },
        {
          auth: {
            token: getSession()?.token,
          },
        },
      );
      wsExecutorRef.current = executor;
      executor.executeFlow(nodes, edges, flowId, {
        identityId: flow?.identityId,
        userAgentId: runSettings.userAgentId,
        headless: runSettings.headless,
        viewport: runSettings.viewport,
        locale: runSettings.locale,
        timezone: runSettings.timezone,
        proxy: runSettings.proxy,
        humanize: runSettings.humanize,
        device: runSettings.device,
      });
    } else {
      // Mock 模式：本地模拟执行
      const controller = new AbortController();
      abortRef.current = controller;
      executeFlow(
        nodes,
        edges,
        {
          onNodeStart: (nodeId: string) => {
            setNodeExecStatusRef.current?.(nodeId, "running");
            setExecState((prev) => ({
              ...prev,
              nodeResults: {
                ...prev.nodeResults,
                [nodeId]: { nodeId, status: "running" },
              },
            }));
          },
          onNodeComplete: (result: NodeExecutionResult) => {
            setCanvasHasResults(true);
            setNodeExecStatusRef.current?.(result.nodeId, result.status, {
              message: result.message,
              error: result.error,
              duration: result.duration,
            });
            setExecState((prev) => ({
              ...prev,
              nodeResults: { ...prev.nodeResults, [result.nodeId]: result },
            }));
          },
          onLog: (log: ExecutionLog) => {
            setExecState((prev) => ({ ...prev, logs: [...prev.logs, log] }));
          },
          onFlowComplete: (status) => {
            setExecState((prev) => {
              const finishedState = {
                ...prev,
                status,
                finishedAt: new Date().toISOString(),
              };
              const results = Object.values(finishedState.nodeResults);
              const record: ExecutionRecord = {
                id: uuidv4(),
                flowId: flowId || "unknown",
                status: finishedState.status,
                startedAt: finishedState.startedAt || new Date().toISOString(),
                finishedAt: finishedState.finishedAt,
                duration: finishedState.startedAt
                  ? new Date(finishedState.finishedAt!).getTime() -
                  new Date(finishedState.startedAt).getTime()
                  : undefined,
                nodeResults: finishedState.nodeResults,
                logs: finishedState.logs,
                nodeCount: results.length,
                successCount: results.filter((r) => r.status === "success")
                  .length,
                failedCount: results.filter((r) => r.status === "failed")
                  .length,
                skippedCount: results.filter((r) => r.status === "skipped")
                  .length,
              };
              saveExecution(record);
              setExecutionsRefreshKey((k) => k + 1);
              return finishedState;
            });
          },
        },
        controller.signal,
      );
    }
  }, [execState.status, flow?.identityId, flowId, runSettings]);

  useEffect(() => {
    return () => {
      wsExecutorRef.current?.disconnect();
      wsExecutorRef.current = null;
    };
  }, []);

  const exitHistoryView = useCallback(() => {
    setHistorySnapshot(null);
    setHistoryNodeResults({});
    setHistoryViewingExecution(null);
    setCanvasHasResults(false);
    setNodeExecStatusRef.current?.("__reset__", "idle");
  }, []);

  const isRunning = execState.status === "running";
  const isViewingHistory = Boolean(historySnapshot);
  const baseDisplayNodes = useMemo(() => stripExecData(flow?.nodes || []), [flow?.nodes]);
  const displayNodes = useMemo(() => {
    if (!historySnapshot?.nodes) {
      return baseDisplayNodes;
    }

    return historySnapshot.nodes.map((node) => {
      const result = historyNodeResults[node.id];
      if (!result) {
        return node;
      }

      return {
        ...node,
        data: {
          ...node.data,
          _execStatus: result.status,
          _execMessage: result.message,
          _execError: result.error,
          _execDuration: result.duration,
          _execScreenshot: result.screenshot,
        },
      };
    });
  }, [baseDisplayNodes, historySnapshot, historyNodeResults]);

  if (!flow) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-muted-foreground font-mono text-sm mb-4">
            Flow not found
          </p>
          <button
            onClick={() => navigate("/")}
            className="text-primary font-mono text-sm hover:underline"
          >
            ← Back to flows
          </button>
        </div>
      </div>
    );
  }

  const displayEdges = historySnapshot?.edges ?? flow.edges;
  const hasExecutionData =
    canvasHasResults ||
    execState.status !== "idle" ||
    execState.logs.length > 0 ||
    Object.keys(execState.nodeResults).length > 0;
  const headerIconButtonClass =
    "h-9 min-w-9 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center";
  const headerPrimaryButtonClass = `h-9 px-3 rounded-md text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${isRunning
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-primary text-primary-foreground hover:bg-primary/90"
    }`;

  return (
    <div className="h-dvh flex flex-col bg-background">
      <header className={`border-b border-border bg-card shrink-0 px-3 sm:px-4 py-2 ${isMobile ? "flex flex-col gap-2" : "h-12 flex items-center gap-3"}`}>
        <div className="min-w-0 flex items-center gap-2 flex-1">
          <button
            onClick={() => navigate("/")}
            className={headerIconButtonClass}
          >
            <ArrowLeft size={18} />
          </button>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={headerIconButtonClass}
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeftOpen size={18} />
            )}
          </button>
          <Workflow size={18} className="text-primary shrink-0" />
          <h1 className="font-mono font-bold text-sm text-foreground tracking-wide truncate min-w-0 flex-1">
            {flow.name}
          </h1>
        </div>

        <div className={`flex items-center gap-1.5 ${isMobile ? "w-full flex-wrap justify-between" : "shrink-0"}`}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={handleReset}
              disabled={!hasUnsaved}
              className={headerIconButtonClass}
              title="Reset to last saved"
            >
              <RotateCcw size={16} />
            </button>
            <button
              onClick={handleSave}
              disabled={!hasUnsaved}
              className={`${headerIconButtonClass} ${hasUnsaved ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
              title="Save flow"
            >
              <Save size={16} />
            </button>

          </div>

          {!isMobile && <div className="w-px h-5 bg-border mx-1" />}

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <button
              onClick={() => setLiveFeedOpen((v) => !v)}
              className={`${headerIconButtonClass} relative ${liveFeedOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
              title="Live browser view"
            >
              <Monitor size={18} />
              {isRunning && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary animate-pulse" />
              )}
            </button>

            <button
              onClick={() => setExecutionsOpen((v) => !v)}
              className={`${headerIconButtonClass} ${executionsOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
              title="Execution history"
            >
              <History size={18} />
            </button>
            {isViewingHistory && (
              <button
                onClick={exitHistoryView}
                className="h-9 px-3 rounded-md text-xs font-mono font-semibold flex items-center gap-1.5 bg-secondary text-foreground hover:bg-secondary/80 transition-colors whitespace-nowrap"
                title="Back to current flow"
              >
                <ArrowUpRight size={13} />
                返回当前流程
              </button>
            )}
            <button
              onClick={handleRun}
              disabled={isViewingHistory}
              className={headerPrimaryButtonClass}
            >
              {isRunning ? <Square size={13} /> : <Play size={13} />}
              {isRunning ? "Stop" : "Run"}
            </button>


            <button
              onClick={() => setRunSettingsOpen(true)}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Run Settings"
            >
              <Settings2 size={18} />
            </button>


            {/* 把不常用的菜单放到下拉框里节省空间 */}
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className={`${headerIconButtonClass} cursor-pointer`}>
                  <MoreVertical size={18} className="text-muted-foreground hover:text-foreground transition-colors" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="min-w-0 w-auto">
                <DropdownMenuItem>

                  <button
                    onClick={() => {
                      if (isViewingHistory) {
                        exitHistoryView();
                      }
                      setNodeExecStatusRef.current?.("__reset__", "idle");
                      setCanvasHasResults(false);
                      setExecState(initialExecState);
                    }}
                    disabled={isRunning || !hasExecutionData}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                    title="Clear execution results"
                  >
                    <Eraser size={16} />
                  </button>

                </DropdownMenuItem>
                <DropdownMenuSeparator />


                <DropdownMenuItem>
                  <button
                    onClick={handleExport}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Export flow"
                  >
                    <Download size={16} />
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <button
                    onClick={handleImport}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Import flow"
                  >
                    <Upload size={16} />
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <button
                    onClick={() => void handleOpenTemplateDialog()}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Import template"
                  >
                    <LayoutTemplate size={16} />
                  </button>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <button
                    onClick={() => setCredentialsOpen(true)}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Credentials"
                  >
                    <KeyRound size={16} />
                  </button>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem color="red">
                  <button
                    onClick={() => setPanelOpen((v) => !v)}
                    className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors relative"
                    title="Execution logs"
                  >
                    <Terminal size={18} />
                    {execState.logs.length > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
                    )}
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      </header>

      {/* Run Settings Dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-3xl bg-card border-border h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">导入模板</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              模板会追加到当前画布，不会替换现有流程。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-mono text-muted-foreground">
                共 {filteredTemplateItems.length} / {templateItems.length} 个模板
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadTemplateIndex()} disabled={templateLoading}>
                刷新
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[180px_minmax(0,1fr)]">
              <Select value={templateCategoryFilter} onValueChange={setTemplateCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部分类</SelectItem>
                  {Object.entries(templateCategories).map(([key, category]) => (
                    <SelectItem key={key} value={key}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={templateKeyword}
                onChange={(e) => setTemplateKeyword(e.target.value)}
                placeholder="搜索模板名称、描述或标签"
                className="font-mono"
              />
            </div>

            <ScrollArea className="min-h-0 flex-1 h-full pr-3">
              <div className="space-y-4 pb-2">
                {templateLoading ? (
                  <div className="text-sm font-mono text-muted-foreground py-8 text-center">正在加载模板...</div>
                ) : filteredTemplateItems.length === 0 ? (
                  <div className="text-sm font-mono text-muted-foreground py-8 text-center">暂无可用模板</div>
                ) : (
                  Object.entries(
                    pagedTemplateItems.reduce<Record<string, TemplateIndexItem[]>>((acc, item) => {
                      acc[item.category] = acc[item.category] || [];
                      acc[item.category].push(item);
                      return acc;
                    }, {}),
                  ).map(([categoryKey, items]) => {
                    const category = templateCategories[categoryKey];
                    return (
                      <div key={categoryKey} className="space-y-2">
                        <div>
                          <div className="text-sm font-mono font-semibold text-foreground">
                            {category?.label || categoryKey}
                          </div>
                          {category?.description ? (
                            <div className="text-xs font-mono text-muted-foreground">{category.description}</div>
                          ) : null}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {items.map((item) => (
                            <div key={item.id} className="rounded-lg border border-border p-4 space-y-3">
                              <div className="space-y-1">
                                <div className="text-sm font-mono font-semibold text-foreground">{item.name}</div>
                                <div className="text-xs text-muted-foreground">{item.description || "无描述"}</div>
                                <div className="text-[11px] font-mono text-muted-foreground">
                                  作者：{item.author || "官方"} · 排序：{item.sort_order ?? 0}
                                </div>
                              </div>
                              {item.tags.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {item.tags.map((tag) => (
                                    <Badge key={`${item.id}-${tag}`} variant="secondary" className="font-mono">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  onClick={() => void handleImportTemplate(item.id)}
                                  disabled={templateImportingId === item.id}
                                >
                                  {templateImportingId === item.id ? "导入中..." : "导入模板"}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            {filteredTemplateItems.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-mono text-muted-foreground">
                  第 {templatePage} / {templatePageCount} 页
                </div>
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setTemplatePage((page) => Math.max(1, page - 1));
                        }}
                        className={templatePage <= 1 ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                    {Array.from({ length: templatePageCount }, (_, index) => index + 1).map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          href="#"
                          isActive={page === templatePage}
                          onClick={(e) => {
                            e.preventDefault();
                            setTemplatePage(page);
                          }}
                        >
                          {page}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          setTemplatePage((page) => Math.min(templatePageCount, page + 1));
                        }}
                        className={templatePage >= templatePageCount ? "pointer-events-none opacity-50" : ""}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runSettingsOpen} onOpenChange={setRunSettingsOpen}>
        <DialogContent className="sm:max-w-[425px] bg-card border-border max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">Run Settings</DialogTitle>
            <DialogDescription className="font-mono text-xs text-muted-foreground">
              Configure browser environment for this execution.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4 overflow-y-auto flex-1 pr-2">
            <div className="flex items-center justify-between">
              <div className="grid gap-1">
                <Label className="text-xs font-mono">Headless Mode</Label>
                <p className="text-[10px] text-muted-foreground font-mono">
                  Run browser without a visible window.
                </p>
              </div>
              <Switch
                checked={runSettings.headless}
                onCheckedChange={(v) => updateRunSettings(prev => ({ ...prev, headless: v }))}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-mono">Device</Label>
              <Select
                value={runSettings.device}
                onValueChange={(v) => updateRunSettings(prev => ({ ...prev, device: v }))}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder="Select Device" />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_OPTIONS.map(device => (
                    <SelectItem key={device} value={device} className="font-mono text-xs">
                      {device}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-mono">User-Agent</Label>
              <Select
                value={runSettings.userAgentId}
                onValueChange={(v) => updateRunSettings(prev => ({ ...prev, userAgentId: v }))}
              >
                <SelectTrigger className="font-mono text-xs">
                  <SelectValue placeholder="Select User-Agent" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="device" className="font-mono text-xs">
                    使用设备配置
                  </SelectItem>
                  <SelectItem value="random" className="font-mono text-xs">
                    Random User-Agent
                  </SelectItem>
                  {userAgents.map(ua => (
                    <SelectItem key={ua.id} value={ua.id} className="font-mono text-xs">
                      {ua.is_default ? `Default: ${ua.value.substring(0, 40)}...` : ua.value.substring(0, 40) + "..."}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs font-mono">视口</Label>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use-device-viewport"
                  checked={runSettings.viewport.width === 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      updateRunSettings(prev => ({ ...prev, viewport: { width: 0, height: 0 } }));
                    } else {
                      updateRunSettings(prev => ({ ...prev, viewport: { width: 1920, height: 1080 } }));
                    }
                  }}
                  className="h-4 w-4"
                />
                <label htmlFor="use-device-viewport" className="text-xs font-mono text-muted-foreground">
                  使用设备视口
                </label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-xs font-mono">Viewport Width</Label>
                <input
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs"
                  type="number"
                  min={1}
                  value={runSettings.viewport.width}
                  onChange={(e) => updateRunSettings(prev => ({
                    ...prev,
                    viewport: {
                      ...prev.viewport,
                      width: Math.max(1, Number(e.target.value) || 1),
                    },
                  }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs font-mono">Viewport Height</Label>
                <input
                  className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs"
                  type="number"
                  min={1}
                  value={runSettings.viewport.height}
                  onChange={(e) => updateRunSettings(prev => ({
                    ...prev,
                    viewport: {
                      ...prev.viewport,
                      height: Math.max(1, Number(e.target.value) || 1),
                    },
                  }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-mono">Locale</Label>
              <input
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs"
                value={runSettings.locale}
                onChange={(e) => updateRunSettings(prev => ({ ...prev, locale: e.target.value || "en-US" }))}
                placeholder="en-US"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-mono">Timezone</Label>
              <input
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs"
                value={runSettings.timezone}
                onChange={(e) => updateRunSettings(prev => ({ ...prev, timezone: e.target.value || "America/New_York" }))}
                placeholder="America/New_York"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-xs font-mono">Proxy</Label>
              <input
                className="w-full rounded-md border border-border bg-secondary px-3 py-2 font-mono text-xs"
                value={runSettings.proxy}
                onChange={(e) => updateRunSettings(prev => ({ ...prev, proxy: e.target.value }))}
                placeholder="http://127.0.0.1:7890"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="grid gap-1">
                <Label className="text-xs font-mono">Humanize</Label>
                <p className="text-[10px] text-muted-foreground font-mono">
                  Enable human-like runtime behavior.
                </p>
              </div>
              <Switch
                checked={runSettings.humanize}
                onCheckedChange={(v) => updateRunSettings(prev => ({ ...prev, humanize: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setRunSettingsOpen(false)} className="font-mono text-xs">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-1 overflow-hidden relative">
        <ReactFlowProvider>
          {sidebarOpen && <Sidebar onAddNode={handleAddNode} />}
          {isViewingHistory && (
            <div className="absolute left-4 top-4 z-20 rounded-md border border-border bg-card/95 px-3 py-2 shadow-sm backdrop-blur">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-xs font-mono font-semibold text-foreground">历史查看模式</p>
                  <p className="text-[11px] font-mono text-muted-foreground">
                    {historyViewingExecution?.startedAt
                      ? new Date(historyViewingExecution.startedAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })
                      : "已加载历史快照"}
                  </p>
                </div>
                <button
                  onClick={exitHistoryView}
                  className="text-xs font-mono text-primary hover:underline"
                >
                  返回编辑
                </button>
              </div>
            </div>
          )}
          <FlowCanvas
            initialNodes={displayNodes}
            initialEdges={displayEdges}
            isRunning={isRunning}
            readOnly={Boolean(historySnapshot)}
            allowNodeEditingInReadOnly={Boolean(historySnapshot)}
            onFlowChange={handleFlowChange}
            onAddNodeRef={(fn) => {
              addNodeFnRef.current = fn;
            }}
            onPaneClick={() => setSidebarOpen(false)}
            onSetNodeExecStatusRef={(fn) => {
              setNodeExecStatusRef.current = fn;
            }}
            onResetRef={(fn) => {
              resetFnRef.current = fn;
            }}
          />
        </ReactFlowProvider>
      </div>

      <ExecutionPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        state={execState}
      />
      <LiveFeedPanel
        open={liveFeedOpen}
        onClose={() => setLiveFeedOpen(false)}
        isRunning={isRunning}
        screenshot={execState.screenshot}
      />
      <ExecutionsPanel
        open={executionsOpen}
        onClose={() => setExecutionsOpen(false)}
        flowId={flowId || ""}
        refreshKey={executionsRefreshKey}
        onShowOnCanvas={(record) => {
          if (record) {
            setHistoryViewingExecution(record);
            setHistoryNodeResults(record.nodeResults);
            const snapshot = record.flowSnapshot;
            if (snapshot?.nodes && snapshot?.edges) {
              setHistorySnapshot({
                nodes: stripExecData(snapshot.nodes as Node[]),
                edges: snapshot.edges as Edge[],
              });
            } else {
              setHistorySnapshot(null);
            }

            setCanvasHasResults(Object.keys(record.nodeResults).length > 0);
          } else {
            exitHistoryView();
          }
        }}
      />
      <CredentialsManager
        open={credentialsOpen}
        onClose={() => setCredentialsOpen(false)}
      />
    </div>
  );
};

export default Index;
