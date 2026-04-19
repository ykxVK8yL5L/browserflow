import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Monitor, Loader2, MonitorOff, Maximize2, Minimize2, X } from "lucide-react";

interface LiveFeedPanelProps {
  open: boolean;
  onClose: () => void;
  isRunning: boolean;
  /** 实时截图（base64 data URL） */
  screenshot?: string;
  /** URL of the live browser view — when connected to a real backend */
  streamUrl?: string;
}

const LiveFeedPanel = ({ open, onClose, isRunning, screenshot, streamUrl }: LiveFeedPanelProps) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (!isFullscreen) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.error("Failed to enter fullscreen:", err);
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.error("Failed to exit fullscreen:", err);
      }
    }
  };

  // 监听全屏变化事件
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        showCloseButton={false}
        side="right"
        className={`bg-card border-border flex flex-col p-0 ${isFullscreen ? "w-screen h-screen max-w-none" : "w-[520px] sm:w-[600px]"}`}
      >
        <SheetHeader className="px-5 py-4 border-b border-border shrink-0 flex flex-row items-center justify-between">
          <SheetTitle className="font-mono text-sm flex items-center gap-2">
            <Monitor size={16} className="text-primary" />
            Live Browser View
            {isRunning && (
              <span className="flex items-center gap-1 text-xs font-normal text-primary">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Live
              </span>
            )}
          </SheetTitle>
          <div>
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>

            <SheetClose asChild>
              <button title="Close" className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
            </SheetClose>
          </div>
        </SheetHeader>

        <div ref={containerRef} className="flex-1 flex items-center justify-center p-4">
          {screenshot ? (
            <img
              src={screenshot}
              alt="Live browser screenshot"
              className="w-full h-full object-contain rounded-md border border-border bg-background"
            />
          ) : streamUrl ? (
            <iframe
              src={streamUrl}
              className="w-full h-full rounded-md border border-border bg-background"
              title="Live browser view"
            />
          ) : isRunning ? (
            <div className="text-center space-y-4">
              <div className="w-full aspect-video rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center justify-center gap-3">
                <Loader2 size={32} className="text-primary animate-spin" />
                <p className="text-sm font-mono text-primary">Executing flow...</p>
                <p className="text-xs font-mono text-muted-foreground max-w-[280px]">
                  Connect a browser automation backend to see the live browser screen here.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-full aspect-video rounded-lg border-2 border-dashed border-border bg-muted/30 flex flex-col items-center justify-center gap-3">
                <MonitorOff size={32} className="text-muted-foreground" />
                <p className="text-sm font-mono text-muted-foreground">No active session</p>
                <p className="text-xs font-mono text-muted-foreground/70 max-w-[280px]">
                  Click "Run" to start the flow. The live browser view will appear here when connected to a backend.
                </p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default LiveFeedPanel;
