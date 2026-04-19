import { memo, useCallback, useState, useRef, useEffect } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { NODE_TYPES_CONFIG, resolveSubtitle } from "./nodeTypes";
import { Ban, Power, Loader2, CheckCircle2, XCircle, SkipForward, Clock, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSession } from "@/lib/authStore";
import type { NodeExecutionStatus } from "@/lib/executionEngine";
import { getNodeBorderStyle, getNodeIconBgStyle } from "./nodes/shared/types";
import TruncatedMessage from "./nodes/shared/TruncatedMessage";
import NodeEditor from "./NodeEditor";


const execBgMap: Record<string, string> = {
  running: "bg-primary/10 border-primary/30",
  success: "bg-emerald-500/10 border-emerald-500/30",
  failed: "bg-red-500/10 border-red-500/30",
  skipped: "bg-muted/50 border-muted",
};

const execBorderMap: Record<string, string> = {
  running: "!border-primary !shadow-[0_0_24px_-3px_hsl(var(--primary)/0.5)]",
  success: "!border-emerald-500 !shadow-[0_0_24px_-3px_rgba(16,185,129,0.35)]",
  failed: "!border-red-500 !shadow-[0_0_24px_-3px_rgba(239,68,68,0.35)]",
  skipped: "!border-muted opacity-55",
};

const execTextMap: Record<string, string> = {
  running: "text-primary",
  success: "text-emerald-400",
  failed: "text-red-400",
  skipped: "text-muted-foreground",
};

const ExecutionIndicator = ({ status }: { status: NodeExecutionStatus }) => {
  switch (status) {
    case "running":
      return <Loader2 size={14} className="text-primary animate-spin shrink-0" />;
    case "success":
      return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
    case "failed":
      return <XCircle size={14} className="text-red-400 shrink-0" />;
    case "skipped":
      return <SkipForward size={14} className="text-muted-foreground shrink-0" />;
    default:
      return null;
  }
};

const statusLabel: Record<string, string> = {
  running: "Running...",
  success: "Success",
  failed: "Failed",
  skipped: "Skipped",
};

const BrowserNode = ({ id, data, selected }: NodeProps) => {
  const { setNodes } = useReactFlow();
  const nodeData = data as Record<string, unknown>;
  const nodeType = (nodeData.nodeType as string) || "navigate";
  const config = NODE_TYPES_CONFIG.find((n) => n.type === nodeType);
  const execStatus = (nodeData._execStatus as NodeExecutionStatus) || "idle";
  const execMessage = (nodeData._execMessage as string) || "";
  const execDuration = nodeData._execDuration as number | undefined;
  const execError = (nodeData._execError as string) || "";
  const execScreenshot = nodeData._execScreenshot as string | undefined;
  const isExec = execStatus !== "idle";

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [screenshotOpen, setScreenshotOpen] = useState(false);
  const [screenshotObjectUrl, setScreenshotObjectUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const clickTimeoutRef = useRef<number | null>(null);

  const toggleDisabled = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n
      )
    );
  }, [id, setNodes]);

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const currentLabel = (nodeData.label as string) || config?.label || "";
    setEditValue(currentLabel);
    setIsEditing(true);
  }, [nodeData.label, config?.label]);

  const handleNodeClick = useCallback((e: React.MouseEvent) => {
    if (!isExec) return;
    // Allow event to bubble up to FlowCanvas for double-click handling
  }, [isExec]);

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    const trimmed = editValue.trim();
    if (trimmed) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, label: trimmed } } : n
        )
      );
    }
  }, [id, editValue, setNodes]);

  const loadScreenshot = useCallback(async () => {
    if (!execScreenshot) return;
    setScreenshotLoading(true);
    setScreenshotError(null);
    setScreenshotObjectUrl(null);
    try {
      const token = getSession()?.token;
      const response = await fetch(execScreenshot, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setScreenshotObjectUrl(objectUrl);
    } catch (error) {
      console.error("Failed to load screenshot:", error);
      setScreenshotError("截图加载失败");
    } finally {
      setScreenshotLoading(false);
    }
  }, [execScreenshot]);

  const handleScreenshotClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setScreenshotOpen(true);
    loadScreenshot();
  }, [loadScreenshot]);

  useEffect(() => {
    return () => {
      if (screenshotObjectUrl) {
        URL.revokeObjectURL(screenshotObjectUrl);
      }
    };
  }, [screenshotObjectUrl]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        window.clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  if (!config) return null;

  const Icon = config.icon;
  const subtitle = resolveSubtitle(config, nodeData);
  const disabled = Boolean(nodeData.disabled);
  const description = nodeData.description as string | undefined;
  const isReadOnlyNode = isExec;

  const borderClass = isExec
    ? execBorderMap[execStatus] || ""
    : disabled
      ? "opacity-45 border-muted"
      : getNodeBorderStyle(nodeType);

  return (
    <div
      className={`group bg-card border-2 rounded-lg min-w-[200px] max-w-[260px] relative transition-all duration-300 ${borderClass} ${selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
        }`}
      onClick={handleNodeClick}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-primary !border-background !w-4 !h-4 !-top-2"
        isConnectable
      />

      {/* Main content */}
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div
          className={`p-1.5 rounded-md ${disabled ? "bg-muted text-muted-foreground" : getNodeIconBgStyle(nodeType)
            }`}
        >
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <input
              ref={inputRef}
              className="text-sm font-mono font-semibold text-foreground bg-secondary border border-border rounded px-1 py-0 w-full outline-none focus:ring-1 focus:ring-primary"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setIsEditing(false);
              }}
            />
          ) : (
            <p
              className={`text-sm font-mono font-semibold cursor-text ${disabled ? "text-muted-foreground line-through" : "text-foreground"}`}
              onDoubleClick={startEditing}
            >
              {(nodeData.label as string) || config.label}
            </p>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground font-mono truncate">{subtitle}</p>
          )}
          {description && !isExec && (
            <p className="text-[10px] text-muted-foreground/70 font-mono truncate mt-0.5">{description}</p>
          )}
        </div>
        <ExecutionIndicator status={execStatus} />
        {!isExec && (
          <button
            onClick={toggleDisabled}
            className={`p-0.5 rounded shrink-0 transition-colors hover:bg-secondary ${disabled ? "text-destructive" : "text-muted-foreground/40"}`}
            title={disabled ? "Enable node" : "Disable node"}
          >
            <Power size={13} />
          </button>
        )}
        {isExec && execScreenshot && (
          <button
            onClick={handleScreenshotClick}
            className="p-0.5 rounded shrink-0 text-primary hover:bg-secondary"
            title="查看截图"
          >
            <Eye size={13} />
          </button>
        )}
      </div>

      {/* Execution result footer */}
      {isExec && (
        <div className={`border-t px-3 py-1.5 rounded-b-md ${execBgMap[execStatus] || ""}`}>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] font-mono font-medium ${execTextMap[execStatus] || "text-foreground"}`}>
              {statusLabel[execStatus] || execStatus}
            </span>
            {execDuration !== undefined && (
              <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
                <Clock size={9} />
                {execDuration}ms
              </span>
            )}
          </div>
          {execError && (
            <TruncatedMessage
              text={execError}
              dialogTitle="错误详情"
              className="text-[10px] font-mono text-red-400/90"
            />
          )}
          {!execError && execMessage && execStatus === "success" && (
            <TruncatedMessage
              text={execMessage}
              dialogTitle="执行结果"
              className="text-[10px] font-mono text-emerald-400/70"
            />
          )}
        </div>
      )}

      {!(["foreach", "while", "for"].includes(nodeType)) && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!bg-primary !border-background !w-4 !h-4 !-bottom-2"
          isConnectable
        />
      )}

      {["foreach", "while", "for"].includes(nodeType) && (
        <>
          <div className="absolute -bottom-6 left-1/4 flex flex-col items-center gap-1">
            <Handle
              type="source"
              position={Position.Bottom}
              id="body"
              className="!bg-primary !border-background !w-4 !h-4 !-bottom-2"
              isConnectable
            />
            <span className="text-[8px] font-mono text-primary font-bold uppercase">Body</span>
          </div>
          <div className="absolute -bottom-6 left-3/4 flex flex-col items-center gap-1">
            <Handle
              type="source"
              position={Position.Bottom}
              id="done"
              className="!bg-emerald-500 !border-background !w-4 !h-4 !-bottom-2"
              isConnectable
            />
            <span className="text-[8px] font-mono text-emerald-500 font-bold uppercase">Done</span>
          </div>
        </>
      )}

      <Dialog open={screenshotOpen} onOpenChange={(open) => !open && setScreenshotOpen(false)}>
        <DialogContent className="max-w-5xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">截图预览</DialogTitle>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto rounded-md border border-border bg-background p-2">
            {screenshotLoading ? (
              <div className="flex min-h-[240px] items-center justify-center text-sm font-mono text-muted-foreground">
                正在加载截图...
              </div>
            ) : screenshotError ? (
              <div className="flex min-h-[240px] items-center justify-center text-sm font-mono text-destructive">
                {screenshotError}
              </div>
            ) : screenshotObjectUrl ? (
              <img src={screenshotObjectUrl} alt="截图" className="w-full h-auto rounded-md object-contain" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>        </div>
  );
};

export default memo(BrowserNode);