import React, { useCallback } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { GitBranch, Loader2, CheckCircle2, XCircle, SkipForward, Clock, Power } from "lucide-react";
import type { NodeExecutionStatus } from "@/lib/executionEngine";
import TruncatedMessage from "./shared/TruncatedMessage";

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

const statusLabel: Record<string, string> = {
    running: "Running...",
    success: "Success",
    failed: "Failed",
    skipped: "Skipped",
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

const IfNodeComponent = ({ id, data }: NodeProps) => {
    const { setNodes } = useReactFlow();
    const nodeData = data as Record<string, unknown>;
    const execStatus = (nodeData._execStatus as NodeExecutionStatus) || "idle";
    const execMessage = (nodeData._execMessage as string) || "";
    const execDuration = nodeData._execDuration as number | undefined;
    const execError = (nodeData._execError as string) || "";
    const isExec = execStatus !== "idle";
    const disabled = Boolean(nodeData.disabled);

    const toggleDisabled = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setNodes((nds) =>
            nds.map((n) =>
                n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n
            )
        );
    }, [id, setNodes]);

    const borderClass = isExec
        ? execBorderMap[execStatus] || ""
        : disabled
            ? "border-muted opacity-45"
            : "border-border";

    return (
        <div className={`min-w-[120px] max-w-[220px] rounded-lg border-2 bg-card shadow-sm relative transition-all duration-300 ${borderClass}`}>
            <div className="flex items-center gap-2 px-3 py-2 bg-secondary/50 border-b border-border rounded-t-lg">
                <GitBranch size={14} className={disabled ? "text-muted-foreground" : "text-primary"} />
                <span className={`text-xs font-mono font-bold truncate flex-1 ${disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {(data.label as string) || "If Condition"}
                </span>
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
            </div>
            <div className="min-w-0 px-3 py-2 text-[10px] font-mono text-muted-foreground truncate">
                {(data.condition as string) || "No condition"}
            </div>

            {/* Execution result footer */}
            {isExec && (
                <div className={`min-w-0 border-t px-3 py-1.5 rounded-b-md ${execBgMap[execStatus] || ""}`}>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className={`min-w-0 truncate text-[11px] font-mono font-medium ${execTextMap[execStatus] || "text-foreground"}`}>
                            {statusLabel[execStatus] || execStatus}
                        </span>
                        {execDuration !== undefined && (
                            <span className="shrink-0 text-[10px] font-mono text-muted-foreground flex items-center gap-0.5">
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

            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="w-3 h-3 bg-border border-2 border-background"
            />

            {/* True Output Handle */}
            <div className="absolute -bottom-3 left-1/4 flex flex-col items-center gap-0.5">
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id="true"
                    className="w-3 h-3 bg-green-500 border-2 border-background"
                />
                <span className="text-[8px] font-mono text-green-500 font-bold uppercase mb-1">True</span>
            </div>

            {/* False Output Handle */}
            <div className="absolute -bottom-3 left-2/4 flex flex-col items-center gap-0.5">
                <Handle
                    type="source"
                    position={Position.Bottom}
                    id="false"
                    className="w-3 h-3 bg-red-500 border-2 border-background"
                />
                <span className="text-[8px] font-mono text-red-500 font-bold uppercase mb-1">False</span>
            </div>
        </div>
    );
};

export default IfNodeComponent;
