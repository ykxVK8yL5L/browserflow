import React, { useCallback } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { Square, Loader2, CheckCircle2, XCircle, SkipForward, Clock, Power } from "lucide-react";
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

const StopNodeComponent = ({ id, data }: NodeProps) => {
    const { setNodes } = useReactFlow();
    const nodeData = data as Record<string, unknown>;
    const nodeLabel = (nodeData.label as string) || (nodeData.stopType === "error" ? "Error Stop" : "Success Stop");
    const stopType = (nodeData.stopType as string) || "success";
    const errorMessage = (nodeData.errorMessage as string) || "";
    const execMessage = (nodeData._execMessage as string) || "";
    const execStatus = (nodeData._execStatus as NodeExecutionStatus) || "idle";
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

    const isError = stopType === "error";
    const colorClass = isError
        ? "border-red-500 bg-red-500/5"
        : "border-emerald-500 bg-emerald-500/5";
    const iconClass = isError ? "text-red-500" : "text-emerald-500";

    const borderClass = isExec
        ? execBorderMap[execStatus] || ""
        : disabled
            ? "border-2 border-muted opacity-45"
            : `border-2 ${colorClass}`;

    const fallbackMessage = isError && errorMessage
        ? errorMessage
        : (isError ? "Terminating with error:" + errorMessage : "Flow completed successfully:" + errorMessage);
    const displayMessage = execMessage || fallbackMessage;

    return (
        <div className={`min-w-[150px] rounded-lg ${borderClass} shadow-sm overflow-hidden transition-all duration-300`}>
            <div className={`flex items-center gap-2 px-3 py-2 ${isError ? "bg-red-500/10" : "bg-emerald-500/10"} border-b border-border`}>
                <Square size={14} className={disabled ? "text-muted-foreground" : iconClass} />
                <span className={`text-xs font-mono font-bold truncate flex-1 ${disabled ? "text-muted-foreground line-through" : "text-foreground"}`}>
                    {nodeLabel}
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
            <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground truncate">
                {displayMessage}
            </div>

            {/* Execution result footer */}
            {isExec && (
                <div className={`border-t px-3 py-1.5 ${execBgMap[execStatus] || ""}`}>
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
                </div>
            )}

            {/* Only Input Handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="w-3 h-3 bg-border border-2 border-background"
            />
        </div>
    );
};

export default StopNodeComponent;
