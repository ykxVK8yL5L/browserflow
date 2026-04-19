import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { SearchCheck, Loader2, CheckCircle2, XCircle, SkipForward, Clock } from "lucide-react";
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

const ExecutionIndicator = ({ status }: { status: string }) => {
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

const CheckExistenceNodeComponent = ({ data, selected }: NodeProps) => {
    const execStatus = (data._execStatus as string) || "idle";
    const execDuration = data._execDuration as number | undefined;
    const execError = (data._execError as string) || "";
    const execMessage = (data._execMessage as string) || "";
    const selectorText = typeof data.selector === "string" ? data.selector : "No selector provided";
    const isExec = execStatus !== "idle";
    const borderClass = isExec ? execBorderMap[execStatus] || "" : "border-blue-500";

    return (
        <div className={`min-w-[170px] rounded-lg border-2 bg-blue-500/5 shadow-sm relative transition-all duration-300 ${borderClass} ${selected ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}>
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border-b border-border rounded-t-lg">
                <SearchCheck size={14} className="text-blue-500" />
                <span className="text-xs font-mono font-bold text-foreground truncate">
                    Check Existence
                </span>
                <div className="ml-auto">
                    <ExecutionIndicator status={execStatus} />
                </div>
            </div>
            <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground truncate">
                {selectorText}
            </div>
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
                    {execError ? (
                        <TruncatedMessage
                            text={execError}
                            dialogTitle="错误详情"
                            className="text-[10px] font-mono text-red-400/90"
                        />
                    ) : execMessage ? (
                        <TruncatedMessage
                            text={execMessage}
                            dialogTitle="执行结果"
                            className="text-[10px] font-mono text-muted-foreground"
                        />
                    ) : null}
                </div>
            )}

            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Top}
                className="w-3 h-3 bg-border border-2 border-background"
            />

            {/* True Output Handle */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="true"
                style={{ left: "30%" }}
                className="w-3 h-3 bg-emerald-500 border-2 border-background z-10"
            />
            <div className="absolute -bottom-4 left-[30%] -translate-x-1/2 pointer-events-none">
                <span className="text-[8px] font-bold text-emerald-600 uppercase">True</span>
            </div>

            {/* False Output Handle */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="false"
                style={{ left: "70%" }}
                className="w-3 h-3 bg-red-500 border-2 border-background z-10"
            />
            <div className="absolute -bottom-4 left-[70%] -translate-x-1/2 pointer-events-none">
                <span className="text-[8px] font-bold text-red-600 uppercase">False</span>
            </div>
        </div>
    );
};

export default CheckExistenceNodeComponent;
