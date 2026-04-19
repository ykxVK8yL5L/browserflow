import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CircleSlash2, Loader2, CheckCircle2, XCircle, SkipForward, Clock } from "lucide-react";
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

const BreakNodeComponent = ({ data }: NodeProps) => {
    const nodeData = data as Record<string, unknown>;
    const execStatus = (nodeData._execStatus as NodeExecutionStatus) || "idle";
    const execDuration = nodeData._execDuration as number | undefined;
    const execError = (nodeData._execError as string) || "";
    const isExec = execStatus !== "idle";

    const borderClass = isExec
        ? execBorderMap[execStatus] || ""
        : "border-2 border-amber-500";

    return (
        <div className={`min-w-[150px] overflow-hidden rounded-lg ${borderClass} bg-amber-500/5 shadow-sm transition-all duration-300`}>
            <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-3 py-2">
                <CircleSlash2 size={14} className="text-amber-500" />
                <span className="truncate text-xs font-mono font-bold text-foreground flex-1">Break</span>
                <ExecutionIndicator status={execStatus} />
            </div>
            <div className="px-3 py-2 text-[10px] font-mono text-muted-foreground">
                End current foreach loop
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

            <Handle
                type="target"
                position={Position.Top}
                className="h-3 w-3 border-2 border-background bg-border"
            />
        </div>
    );
};

export default BreakNodeComponent;
