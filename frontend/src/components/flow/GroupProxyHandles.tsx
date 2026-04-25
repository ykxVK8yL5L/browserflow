import { Handle, Position } from "@xyflow/react";

type ProxyHandleId = string | undefined;

export interface GroupProxyConfig {
    showTarget?: boolean;
    sourceHandles?: ProxyHandleId[];
    width?: number;
    height?: number;
}

const getSourceHandleClassName = (handleId: ProxyHandleId, leftPercent?: number) => {
    const base = [
        "!absolute !-bottom-2 !h-4 !w-4 !-translate-x-1/2 !rounded-full !border-2 !border-background !pointer-events-auto nodrag nopan",
    ];

    if (handleId === "true") {
        base.push("!bg-emerald-500");
    } else if (handleId === "false") {
        base.push("!bg-red-500");
    } else if (handleId === "done") {
        base.push("!bg-emerald-600");
    } else {
        base.push("!bg-blue-600");
    }

    return base.join(" ");
};

const getHandleLabel = (handleId: ProxyHandleId) => {
    if (handleId === "true") return "True";
    if (handleId === "false") return "False";
    if (handleId === "body") return "Body";
    if (handleId === "done") return "Done";
    return null;
};

const getLabelClassName = (handleId: ProxyHandleId, leftPercent?: number) => {
    const base = [
        "absolute -bottom-4 -translate-x-1/2 text-[8px] font-mono font-bold uppercase pointer-events-none",
    ];

    if (handleId === "true") {
        base.push("text-emerald-500");
    } else if (handleId === "false") {
        base.push("text-red-500");
    } else if (handleId === "done") {
        base.push("text-emerald-600");
    } else {
        base.push("text-blue-600");
    }

    return base.join(" ");
};

const GroupProxyHandles = ({ proxy }: { proxy: GroupProxyConfig }) => {
    const sourceHandles = proxy.sourceHandles || [];
    const width = proxy.width || 1;
    const height = proxy.height || 1;
    const positions = sourceHandles.length > 1
        ? sourceHandles.map((_, index) => (index === 0 ? 30 : 70))
        : [50];

    return (
        <div
            className="relative overflow-visible pointer-events-none nodrag nopan"
            style={{ width, height }}
        >
            {proxy.showTarget ? (
                <Handle
                    type="target"
                    position={Position.Top}
                    className="!left-1/2 !top-0 !h-4 !w-4 !-translate-x-1/2 !-translate-y-1/2 !rounded-full !border-2 !border-background !bg-blue-600 !pointer-events-auto nodrag nopan"
                    isConnectable
                />
            ) : null}

            {sourceHandles.map((handleId, index) => {
                const leftPercent = positions[index] ?? 50;
                const label = getHandleLabel(handleId);
                return (
                    <div key={`${handleId || "default"}-${index}`}>
                        <Handle
                            id={handleId}
                            type="source"
                            position={Position.Bottom}
                            className={getSourceHandleClassName(handleId, leftPercent)}
                            style={{ left: `${leftPercent}%` }}
                            isConnectable
                        />
                        {label ? <span className={getLabelClassName(handleId, leftPercent)} style={{ left: `${leftPercent}%` }}>{label}</span> : null}
                    </div>
                );
            })}
        </div>
    );
};

export default GroupProxyHandles;
