import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { type FlowExecutionState, type ExecutionLog, type NodeExecutionResult } from "@/lib/executionEngine";
import { CheckCircle2, XCircle, Loader2, Clock, SkipForward, AlertTriangle, X } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useRef } from "react";

function extractResultPreview(r: NodeExecutionResult): string | null {
  const data: any = (r as any).data;
  if (!data) return null;

  const candidate = data.result ?? data.items ?? data.value ?? data;
  try {
    const text =
      typeof candidate === "string"
        ? candidate
        : JSON.stringify(candidate, null, 2);
    if (!text) return null;
    const max = 180;
    return text.length > max ? text.slice(0, max) + "…" : text;
  } catch {
    try {
      return String(candidate);
    } catch {
      return null;
    }
  }
}

interface ExecutionPanelProps {
  open: boolean;
  onClose: () => void;
  state: FlowExecutionState;
}

const statusIcon = {
  idle: <Clock size={14} className="text-muted-foreground" />,
  running: <Loader2 size={14} className="text-primary animate-spin" />,
  success: <CheckCircle2 size={14} className="text-green-400" />,
  failed: <XCircle size={14} className="text-red-400" />,
  skipped: <SkipForward size={14} className="text-muted-foreground" />,
};

const flowStatusLabel: Record<string, { label: string; color: string }> = {
  idle: { label: "Ready", color: "text-muted-foreground" },
  running: { label: "Running...", color: "text-primary" },
  completed: { label: "Completed", color: "text-green-400" },
  failed: { label: "Failed", color: "text-red-400" },
  stopped: { label: "Stopped", color: "text-yellow-400" },
  cancelled: { label: "Stopped", color: "text-yellow-400" },
};

const logLevelColor: Record<string, string> = {
  info: "text-muted-foreground",
  success: "text-green-400",
  error: "text-red-400",
  warn: "text-yellow-400",
};

const ExecutionPanel = ({ open, onClose, state }: ExecutionPanelProps) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const flowStatus = flowStatusLabel[state.status] || flowStatusLabel.idle;

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.logs.length]);

  const nodeResults = Object.values(state.nodeResults);
  const successCount = nodeResults.filter((r) => r.status === "success").length;
  const failedCount = nodeResults.filter((r) => r.status === "failed").length;
  const skippedCount = nodeResults.filter((r) => r.status === "skipped").length;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[480px] bg-card border-border flex flex-col p-0">
        <SheetHeader className="px-5 py-4 border-b border-border shrink-0 ">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-mono text-sm flex items-center gap-2">
              Execution Results
              <span className={`text-xs font-normal ${flowStatus.color}`}>{flowStatus.label}</span>
            </SheetTitle>
            <div className="flex items-center gap-2">
              <SheetClose asChild>
                <button title="Close" className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
              </SheetClose>
            </div>
          </div>
        </SheetHeader>
        <ScrollArea className="flex-1 px-5">
          {/* Stats */}
          {nodeResults.length > 0 && (
            <div className="flex gap-4 px-5 py-3 border-b border-border text-xs font-mono shrink-0">
              <span className="text-green-400">{successCount} passed</span>
              <span className="text-red-400">{failedCount} failed</span>
              <span className="text-muted-foreground">{skippedCount} skipped</span>
            </div>
          )}

          {/* Node Results */}
          {nodeResults.length > 0 && (
            <div className="px-5 py-3 border-b border-border shrink-0">
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Nodes</p>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                {nodeResults.map((r) => (
                  <div key={r.nodeId} className="text-xs font-mono">
                    <div className="flex items-center gap-2">
                      {statusIcon[r.status]}
                      <span className="text-foreground truncate flex-1">
                        {r.message || r.nodeId}
                      </span>
                      {(r.duration ?? (r as any).durationMs) && (
                        <span className="text-muted-foreground shrink-0">
                          {Math.round((r.duration ?? (r as any).durationMs) as number)}ms
                        </span>
                      )}
                    </div>

                    {extractResultPreview(r) && (
                      <pre className="mt-1 ml-5 text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-words">
                        {extractResultPreview(r)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Logs */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider px-5 pt-3 pb-2 shrink-0">Logs</p>

            {state.logs.length === 0 ? (
              <p className="text-xs text-muted-foreground font-mono py-4">No logs yet. Click Run to start.</p>
            ) : (
              <div className="space-y-1 pb-4">
                {state.logs.map((log, i) => (
                  <LogLine key={i} log={log} />
                ))}
                <div ref={logEndRef} />
              </div>
            )}

          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet >
  );
};

const LogLine = ({ log }: { log: ExecutionLog }) => {
  const time = new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className="flex gap-2 text-xs font-mono leading-relaxed">
      <span className="text-muted-foreground/50 shrink-0">{time}</span>
      {log.nodeName && <span className="text-primary/70 shrink-0">[{log.nodeName}]</span>}
      <span className={logLevelColor[log.level] || "text-foreground"}>{log.message}</span>
    </div>
  );
};

export default ExecutionPanel;
