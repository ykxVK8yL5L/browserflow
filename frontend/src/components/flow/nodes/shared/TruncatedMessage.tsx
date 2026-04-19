import { useState } from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TruncatedMessageProps {
    className?: string;
    dialogTitle?: string;
    text: string;
}

export default function TruncatedMessage({
    className = "",
    dialogTitle = "完整信息",
    text,
}: TruncatedMessageProps) {
    const [open, setOpen] = useState(false);

    if (!text) return null;

    return (
        <>
            <div className="flex min-w-0 items-start gap-1.5 mt-0.5">
                <p className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${className}`}>
                    {text}
                </p>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(true);
                    }}
                    className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title="查看完整信息"
                >
                    <Info size={12} />
                </button>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-2xl border-border bg-card">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-sm">{dialogTitle}</DialogTitle>
                    </DialogHeader>
                    <div className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background p-3">
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                            {text}
                        </pre>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
