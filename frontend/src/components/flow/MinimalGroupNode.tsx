import { ChevronDown, ChevronRight, FolderOpen, Pencil } from "lucide-react";
import { useMemo } from "react";
import { type NodeProps } from "@xyflow/react";
import GroupProxyHandles from "./GroupProxyHandles";

type GroupActionType = "select" | "toggleCollapse" | "ungroup" | "rename";

const dispatchGroupAction = (
    action: GroupActionType,
    groupId?: string,
    event?: Pick<React.MouseEvent<HTMLElement>, "metaKey" | "ctrlKey" | "shiftKey" | "button">,
) => {
    if (!groupId) return;
    window.dispatchEvent(new CustomEvent("flow-group-action", {
        detail: {
            action,
            groupId,
            metaKey: event?.metaKey,
            ctrlKey: event?.ctrlKey,
            shiftKey: event?.shiftKey,
            button: event?.button,
        },
    }));
};

interface MinimalGroupNodeData {
    groupId?: string;
    title?: string;
    description?: string;
    color?: string;
    highlighted?: boolean;
    collapsed?: boolean;
    isConnecting?: boolean;
    proxy?: {
        showTarget?: boolean;
        sourceHandles?: Array<string | undefined>;
        width?: number;
        height?: number;
    };
}

const MinimalGroupNode = ({ data, selected }: NodeProps) => {
    const nodeData = (data || {}) as MinimalGroupNodeData;
    const isHighlighted = Boolean(nodeData.highlighted);
    const isCollapsed = Boolean(nodeData.collapsed);
    const isConnecting = Boolean(nodeData.isConnecting);
    const title = nodeData.title || "Group";
    const description = nodeData.description?.trim();
    const baseColor = nodeData.color || "rgba(59, 130, 246, 0.16)";
    const borderClassName = useMemo(() => {
        if (selected) return "border-primary/70 ring-2 ring-primary/50";
        if (isHighlighted) return "border-primary/50 ring-1 ring-primary/30";
        return "border-border/70";
    }, [isHighlighted, selected]);
    const highlightGlowStyle = useMemo(() => {
        if (!isHighlighted || selected) {
            return undefined;
        }

        return {
            boxShadow: "0 0 0 1px rgba(59, 130, 246, 0.18), 0 0 0 6px rgba(59, 130, 246, 0.08)",
        };
    }, [isHighlighted, selected]);
    const shellStyle = useMemo(() => ({
        background: `linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(15, 23, 42, 0.84) 100%), ${baseColor}`,
    }), [baseColor]);
    const headerStyle = useMemo(() => ({
        background: "linear-gradient(180deg, rgba(15, 23, 42, 0.82) 0%, rgba(15, 23, 42, 0.66) 100%)",
        backdropFilter: "blur(10px)",
    }), []);

    const stopEvent = (event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleToggleCollapse = (event: React.MouseEvent<HTMLElement>) => {
        if (isConnecting) return;
        stopEvent(event);
        dispatchGroupAction("toggleCollapse", nodeData.groupId);
    };

    const handleUngroup = (event: React.MouseEvent<HTMLElement>) => {
        if (isConnecting) return;
        stopEvent(event);
        dispatchGroupAction("ungroup", nodeData.groupId);
    };

    const handleRename = (event: React.MouseEvent<HTMLElement>) => {
        if (isConnecting) return;
        stopEvent(event);
        dispatchGroupAction("rename", nodeData.groupId, event);
    };

    const handleSelectGroup = (event: React.MouseEvent<HTMLElement>) => {
        if (isConnecting || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        dispatchGroupAction("select", nodeData.groupId, event);
    };

    return (
        <div
            className={[
                "relative h-full w-full overflow-visible cursor-pointer rounded-[20px] text-white shadow-lg transition-shadow duration-200",
                borderClassName,
            ].join(" ")}
            style={shellStyle}
            onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onMouseDown={handleSelectGroup}
            onClick={handleSelectGroup}
        >
            <div
                className="pointer-events-auto absolute inset-0 rounded-[20px] border bg-clip-padding"
                style={shellStyle}
                onMouseDown={handleSelectGroup}
                onClick={handleSelectGroup}
            />
            {!isCollapsed ? (
                <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-[20px] opacity-70"
                    style={{
                        background: "linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.03) 72%, transparent 100%)",
                    }}
                />
            ) : null}
            {isHighlighted && !selected ? (
                <div
                    className="pointer-events-none absolute inset-0 rounded-[20px] border border-primary/30 bg-primary/5"
                    style={highlightGlowStyle}
                />
            ) : null}
            <div className="pointer-events-none absolute inset-0 rounded-[20px] border border-white/10 bg-black/5" />
            {isCollapsed ? (
                <div
                    className={[
                        "relative z-20 flex h-full items-center justify-between gap-3 rounded-[20px] border border-white/10 px-3 py-2 text-foreground shadow-sm backdrop-blur-sm",
                        isConnecting ? "pointer-events-none" : "pointer-events-auto",
                    ].join(" ")}
                    style={headerStyle}
                    onMouseDown={handleSelectGroup}
                    onClick={handleSelectGroup}
                >
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-muted-foreground shadow-sm transition-colors hover:bg-black/35 hover:text-foreground"
                            onMouseDown={stopEvent}
                            onDoubleClick={stopEvent}
                            onClick={handleToggleCollapse}
                        >
                            <ChevronRight size={13} />
                        </button>
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <FolderOpen size={14} />
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden text-left">
                            <div className="truncate text-xs font-semibold text-foreground">{title}</div>
                            {description ? (
                                <div className="truncate text-[11px] text-muted-foreground">{description}</div>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-muted-foreground shadow-sm transition-colors hover:bg-black/35 hover:text-foreground"
                            onMouseDown={stopEvent}
                            onDoubleClick={stopEvent}
                            onClick={handleRename}
                            title="重命名"
                        >
                            <Pencil size={12} />
                        </button>
                        <button
                            type="button"
                            className="shrink-0 rounded-lg border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm transition-colors hover:bg-black/35 hover:text-foreground"
                            onMouseDown={stopEvent}
                            onDoubleClick={stopEvent}
                            onClick={handleUngroup}
                        >
                            解组
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div
                        className={[
                            "absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-3 rounded-t-[20px] border-b border-white/10 px-3.5",
                            isConnecting ? "pointer-events-none" : "pointer-events-auto",
                        ].join(" ")}
                        style={headerStyle}
                        onMouseDown={handleSelectGroup}
                        onClick={handleSelectGroup}
                    >
                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                            <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                                onMouseDown={stopEvent}
                                onDoubleClick={stopEvent}
                                onClick={handleToggleCollapse}
                            >
                                <ChevronDown size={13} />
                            </button>
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm">
                                <FolderOpen size={14} />
                            </div>
                            <div className="min-w-0 overflow-hidden pr-1 text-left">
                                <div className="truncate text-xs font-semibold text-foreground">{title}</div>
                                {description ? (
                                    <div className="truncate text-[11px] text-muted-foreground">{description}</div>
                                ) : null}
                            </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                            <button
                                type="button"
                                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/70 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                                onMouseDown={stopEvent}
                                onDoubleClick={stopEvent}
                                onClick={handleRename}
                                title="重命名"
                            >
                                <Pencil size={12} />
                            </button>
                            <button
                                type="button"
                                className="shrink-0 rounded-lg border border-border/70 bg-background/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                                onMouseDown={stopEvent}
                                onDoubleClick={stopEvent}
                                onClick={handleUngroup}
                            >
                                解组
                            </button>
                        </div>
                    </div>
                    <div className="pointer-events-none absolute inset-x-3 bottom-3 top-[60px] rounded-2xl border border-white/8 bg-black/10" />
                    <div className="pointer-events-none absolute inset-x-4 bottom-4 top-[68px] rounded-[14px] bg-gradient-to-b from-white/4 to-transparent opacity-70" />
                </>
            )}
            <div className="absolute inset-0 pointer-events-none">
                <GroupProxyHandles
                    proxy={{
                        showTarget: Boolean(nodeData.proxy?.showTarget),
                        sourceHandles: nodeData.proxy?.sourceHandles || [undefined],
                        width: nodeData.proxy?.width || 0,
                        height: nodeData.proxy?.height || 0,
                    }}
                />
            </div>
        </div>
    );
};

export default MinimalGroupNode;
