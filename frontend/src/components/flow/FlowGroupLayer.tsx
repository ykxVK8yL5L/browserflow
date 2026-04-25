import { ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { memo, useMemo, useRef } from "react";
import { ViewportPortal, type Node } from "@xyflow/react";
import { computeGroupBounds, type FlowGroup } from "@/lib/flowGroups";

const COLLAPSED_GROUP_WIDTH = 280;
const COLLAPSED_GROUP_HEADER_HEIGHT = 44;

type GroupRect = {
    id: string;
    title: string;
    description?: string;
    color?: string;
    collapsed?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
};

interface FlowGroupLayerProps {
    groups: FlowGroup[];
    nodes: Node[];
    selectedGroupId?: string | null;
    isConnecting?: boolean;
    onSelectGroup?: (groupId: string) => void;
    onUngroup?: (groupId: string) => void;
    onToggleCollapse?: (groupId: string) => void;
    onDragGroup?: (groupId: string, nextClientX: number, nextClientY: number, prevClientX: number, prevClientY: number) => void;
}

function computeGroupRect(group: FlowGroup, nodes: Node[]): GroupRect | null {
    const bounds = computeGroupBounds(group, nodes);
    if (!bounds) {
        return null;
    }

    return {
        id: group.id,
        title: group.title,
        description: group.description,
        color: group.color,
        collapsed: group.collapsed,
        x: bounds.x,
        y: bounds.y,
        width: group.collapsed ? COLLAPSED_GROUP_WIDTH : bounds.width,
        height: group.collapsed ? COLLAPSED_GROUP_HEADER_HEIGHT : bounds.height,
    };
}

const FlowGroupLayer = memo(function FlowGroupLayer({
    groups,
    nodes,
    selectedGroupId,
    isConnecting = false,
    onSelectGroup,
    onUngroup,
    onToggleCollapse,
    onDragGroup,
}: FlowGroupLayerProps) {
    const dragStateRef = useRef<{ groupId: string; clientX: number; clientY: number } | null>(null);

    const rects = useMemo(
        () => groups.map((group) => computeGroupRect(group, nodes)).filter((group): group is GroupRect => Boolean(group)),
        [groups, nodes],
    );

    const stopDragging = () => {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", handleWindowMouseMove);
        window.removeEventListener("mouseup", handleWindowMouseUp);
    };

    function handleWindowMouseMove(event: MouseEvent) {
        const dragState = dragStateRef.current;
        if (!dragState) return;

        onDragGroup?.(dragState.groupId, event.clientX, event.clientY, dragState.clientX, dragState.clientY);
        dragStateRef.current = {
            groupId: dragState.groupId,
            clientX: event.clientX,
            clientY: event.clientY,
        };
    }

    function handleWindowMouseUp() {
        stopDragging();
    }

    return (
        <ViewportPortal>
            <div className="pointer-events-none absolute inset-0 z-0">
                {rects.map((group) => {
                    const selected = group.id === selectedGroupId;
                    const collapsed = Boolean(group.collapsed);

                    const startDrag = (event: React.MouseEvent) => {
                        event.stopPropagation();
                        onSelectGroup?.(group.id);

                        if (event.button !== 0) return;
                        dragStateRef.current = {
                            groupId: group.id,
                            clientX: event.clientX,
                            clientY: event.clientY,
                        };
                        window.addEventListener("mousemove", handleWindowMouseMove);
                        window.addEventListener("mouseup", handleWindowMouseUp);
                    };

                    return (
                        <div
                            key={group.id}
                            className={[
                                "pointer-events-none absolute z-0 rounded-2xl border bg-clip-padding",
                                selected ? "ring-2 ring-primary/50 border-primary/70" : "border-border/70",
                            ].join(" ")}
                            style={{
                                left: group.x,
                                top: group.y,
                                width: group.width,
                                height: group.height,
                                background: group.color || "rgba(59, 130, 246, 0.08)",
                                overflow: "visible",
                            }}
                            onMouseDown={(event) => {
                                event.stopPropagation();
                                onSelectGroup?.(group.id);
                            }}
                        >
                            {collapsed ? (
                                <div
                                    className={[
                                        "relative z-10 rounded-2xl border bg-clip-padding flex h-full items-center justify-between gap-3 bg-background/85 px-3 py-2",
                                        isConnecting ? "pointer-events-none" : "pointer-events-auto",
                                    ].join(" ")}
                                    onMouseDown={startDrag}
                                >
                                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                        <button
                                            type="button"
                                            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                            onMouseDown={(event) => {
                                                event.stopPropagation();
                                            }}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onToggleCollapse?.(group.id);
                                            }}
                                        >
                                            <ChevronRight size={13} />
                                        </button>
                                        <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
                                        <div className="min-w-0 flex-1 overflow-hidden">
                                            <div className="truncate text-xs font-semibold text-foreground">{group.title}</div>
                                            {group.description ? (
                                                <div className="truncate text-[11px] text-muted-foreground">{group.description}</div>
                                            ) : null}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                        onMouseDown={(event) => {
                                            event.stopPropagation();
                                        }}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            onUngroup?.(group.id);
                                        }}
                                    >
                                        解组
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <div
                                        className={[
                                            "absolute rounded-2xl border bg-clip-padding inset-x-0 top-0 z-10 flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background px-3",
                                            isConnecting ? "pointer-events-none" : "pointer-events-auto",
                                        ].join(" ")}
                                        onMouseDown={startDrag}
                                    >
                                        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                                            <button
                                                type="button"
                                                className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:text-foreground"
                                                onMouseDown={(event) => {
                                                    event.stopPropagation();
                                                }}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onToggleCollapse?.(group.id);
                                                }}
                                            >
                                                <ChevronDown size={13} />
                                            </button>
                                            <FolderOpen size={14} className="shrink-0 text-muted-foreground" />
                                            <div className="min-w-0 overflow-hidden pr-1">
                                                <div className="truncate text-xs font-semibold text-foreground">{group.title}</div>
                                                {group.description ? (
                                                    <div className="truncate text-[11px] text-muted-foreground">{group.description}</div>
                                                ) : null}
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            className="shrink-0 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                            onMouseDown={(event) => {
                                                event.stopPropagation();
                                            }}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onUngroup?.(group.id);
                                            }}
                                        >
                                            解组
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </ViewportPortal>
    );
});

export default FlowGroupLayer;
