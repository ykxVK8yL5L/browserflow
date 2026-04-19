import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { type ExecutionRecord, type PaginatedExecutions, getExecutionsPaginatedFromBackend, clearExecutions, deleteExecutionFromBackend } from "@/lib/executionHistory";
import { CheckCircle2, XCircle, Clock, SkipForward, Trash2, ChevronDown, ChevronRight, StopCircle, Eye, EyeOff, ChevronLeft, ChevronsLeft, ChevronsRight, X, Copy, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSession } from "@/lib/authStore";

interface ExecutionsPanelProps {
  open: boolean;
  onClose: () => void;
  flowId: string;
  refreshKey: number;
  onShowOnCanvas?: (record: ExecutionRecord | null) => void;
}

const PAGE_SIZE = 8;

const statusConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  completed: { icon: <CheckCircle2 size={14} className="text-green-400" />, label: "Completed", color: "text-green-400" },
  failed: { icon: <XCircle size={14} className="text-red-400" />, label: "Failed", color: "text-red-400" },
  stopped: { icon: <StopCircle size={14} className="text-yellow-400" />, label: "Stopped", color: "text-yellow-400" },
  cancelled: { icon: <StopCircle size={14} className="text-yellow-400" />, label: "Stopped", color: "text-yellow-400" },
  idle: { icon: <Clock size={14} className="text-muted-foreground" />, label: "Idle", color: "text-muted-foreground" },
  running: { icon: <Clock size={14} className="text-primary" />, label: "Running", color: "text-primary" },
};

const logLevelColor: Record<string, string> = {
  info: "text-muted-foreground",
  success: "text-green-400",
  error: "text-red-400",
  warn: "text-yellow-400",
};

const nodeStatusIcon: Record<string, React.ReactNode> = {
  success: <CheckCircle2 size={12} className="text-green-400" />,
  failed: <XCircle size={12} className="text-red-400" />,
  skipped: <SkipForward size={12} className="text-muted-foreground" />,
};

const ExecutionsPanel = ({ open, onClose, flowId, refreshKey, onShowOnCanvas }: ExecutionsPanelProps) => {
  const [paginated, setPaginated] = useState<PaginatedExecutions>({
    records: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 1
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState<{ url: string; title: string } | null>(null);
  const [screenshotObjectUrl, setScreenshotObjectUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadPage = useCallback(async (page: number) => {
    setLoading(true);
    try {
      const result = await getExecutionsPaginatedFromBackend(flowId, page, PAGE_SIZE);
      setPaginated(result);
      setCurrentPage(result.page);
    } catch (error) {
      console.error("Failed to load executions:", error);
    } finally {
      setLoading(false);
    }
  }, [flowId]);

  useEffect(() => {
    if (open) {
      loadPage(currentPage);
    }
  }, [open, flowId, refreshKey, loadPage, currentPage]);

  // Reset viewing state when panel closes, but keep canvas results visible
  useEffect(() => {
    if (!open) {
      setViewingId(null);
    }
  }, [open]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const loadScreenshot = async () => {
      if (!selectedScreenshot) {
        setScreenshotLoading(false);
        setScreenshotError(null);
        setScreenshotObjectUrl(null);
        return;
      }

      setScreenshotLoading(true);
      setScreenshotError(null);
      setScreenshotObjectUrl(null);

      try {
        const token = getSession()?.token;
        const response = await fetch(selectedScreenshot.url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);

        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setScreenshotObjectUrl(objectUrl);
      } catch (error) {
        if (!active) return;
        console.error("Failed to load screenshot:", error);
        setScreenshotError("截图加载失败，请重新登录后重试");
      } finally {
        if (active) {
          setScreenshotLoading(false);
        }
      }
    };

    loadScreenshot();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedScreenshot]);

  const handleClear = async () => {
    setLoading(true);
    try {
      await clearExecutions(flowId);
      setCurrentPage(1);
      setPaginated({ records: [], total: 0, page: 1, pageSize: PAGE_SIZE, totalPages: 1 });
      if (viewingId) {
        setViewingId(null);
        onShowOnCanvas?.(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const goToPage = (page: number) => {
    setExpandedId(null);
    loadPage(page);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error("Failed to copy ID:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this execution?")) return;
    setLoading(true);
    try {
      await deleteExecutionFromBackend(id);
      await loadPage(currentPage);
    } catch (error) {
      console.error("Failed to delete execution:", error);
    } finally {
      setLoading(false);
    }
  };

  const { records, total, page, totalPages } = paginated;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-[420px] sm:w-[520px] bg-card border-border flex flex-col p-0">
        <SheetHeader className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="font-mono text-sm">
              Executions
              {total > 0 && (
                <span className="text-muted-foreground font-normal ml-2">({total})</span>
              )}
            </SheetTitle>
            <div className="flex items-center gap-2">
              {total > 0 && (
                <button
                  onClick={handleClear}
                  disabled={loading}
                  className="text-xs font-mono text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <Trash2 size={12} />
                  Clear all
                </button>
              )}
              <SheetClose asChild>
                <button title="Close" className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
              </SheetClose>
            </div>
          </div>
        </SheetHeader>


        <ScrollArea className="flex-1">
          {records.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-xs text-muted-foreground font-mono">No executions yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {records.map((record) => {
                const config = statusConfig[record.status] || statusConfig.idle;
                const isExpanded = expandedId === record.id;
                const isViewing = viewingId === record.id;

                return (
                  <div key={record.id}>
                    {/* Summary row */}
                    <div className="flex items-center">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : record.id)}
                        className="flex-1 px-5 py-3 flex items-center gap-3 hover:bg-secondary/50 transition-colors text-left"
                      >
                        {isExpanded ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
                        {config.icon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono font-medium ${config.color}`}>
                              {config.label}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {formatDuration(record.duration)}
                            </span>
                          </div>
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {formatTime(record.startedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono shrink-0">
                          <span className="text-green-400">{record.successCount}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-red-400">{record.failedCount}</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-muted-foreground">{record.skippedCount}</span>
                        </div>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopyId(record.id);
                        }}
                        className="p-2 mr-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="Copy execution ID"
                      >
                        {copiedId === record.id ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                      <button
                        onClick={() => {
                          const newId = isViewing ? null : record.id;
                          setViewingId(newId);
                          onShowOnCanvas?.(newId ? record : null);
                          if (newId) {
                            onClose();
                          }
                        }}
                        className={`p-2 mr-2 rounded-md transition-colors ${isViewing ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                        title={isViewing ? "Hide from canvas" : "Show on canvas"}
                      >
                        {isViewing ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(record.id);
                        }}
                        className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Delete execution"
                        disabled={loading}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="bg-secondary/30 border-t border-border">
                        {/* Node results */}
                        <div className="px-5 py-3 border-b border-border/50">
                          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Nodes</p>
                          <div className="space-y-1">
                            {Object.values(record.nodeResults).map((r) => (
                              <div key={r.nodeId} className="flex items-center gap-2 text-xs font-mono">
                                {nodeStatusIcon[r.status] || <Clock size={12} className="text-muted-foreground" />}
                                <span className="text-foreground truncate flex-1">
                                  {r.message || r.nodeId}
                                </span>
                                {r.screenshot && (
                                  <button
                                    onClick={() => setSelectedScreenshot({ url: r.screenshot!, title: r.message || `Screenshot · ${r.nodeId}`, })}
                                    className="shrink-0 p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                                    title="查看截图"
                                  >
                                    <Eye size={14} />
                                  </button>
                                )}
                                {r.duration != null && (
                                  <span className="text-muted-foreground shrink-0">{r.duration}ms</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Logs */}
                        <div className="px-5 py-3 max-h-[240px] overflow-y-auto">
                          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Logs</p>
                          <div className="space-y-1">


                            {record.logs.map((log, i) => {
                              const time = new Date(log.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
                              return (
                                <div key={i} className="flex gap-2 text-xs font-mono leading-relaxed overflow-auto">
                                  <span className="text-muted-foreground/50 shrink-0">{time}</span>
                                  {log.nodeName && <span className="text-primary/70 shrink-0">[{log.nodeName}]</span>}
                                  <span className={logLevelColor[log.level] || "text-foreground overflow-auto"}>{log.message}</span>
                                </div>
                              );
                            })}

                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>


        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="px-5 py-3 border-t border-border shrink-0 flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => goToPage(1)}
                disabled={page <= 1}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                title="First page"
              >
                <ChevronsLeft size={14} />
              </button>
              <button
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => goToPage(page + 1)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
              <button
                onClick={() => goToPage(totalPages)}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
                title="Last page"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          </div>
        )}
      </SheetContent>
      <Dialog open={Boolean(selectedScreenshot)} onOpenChange={(open) => !open && setSelectedScreenshot(null)}>
        <DialogContent className="max-w-5xl bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              {selectedScreenshot?.title || "截图预览"}
            </DialogTitle>
          </DialogHeader>
          {selectedScreenshot && (
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
                <img
                  src={screenshotObjectUrl}
                  alt={selectedScreenshot.title}
                  className="w-full h-auto rounded-md object-contain"
                />
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Sheet >
  );
};

export default ExecutionsPanel;
