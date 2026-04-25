import { useCallback, useEffect, useRef, useState } from "react";
import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    ReactFlow,
    addEdge,
    type Connection,
    type Edge,
    type Node,
    type ReactFlowInstance,
    useEdgesState,
    useNodesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlignVerticalSpaceAround, Copy, Map as MapIcon, Trash2 } from "lucide-react";
import Dagre from "@dagrejs/dagre";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import type { FlowGroup } from "@/lib/flowGroups";
import { computeGroupBounds, createGroup, sanitizeGroups } from "@/lib/flowGroups";
import BrowserNode from "./BrowserNode";
import FlowGroupLayer from "./FlowGroupLayer";
import GroupProxyNode from "./GroupProxyNode";
import NodeEditor from "./NodeEditor";
import { buildDefaultData, NODE_TYPES_CONFIG } from "./nodeTypes";
import BreakNodeComponent from "./nodes/BreakNodeComponent";
import CheckExistenceNodeComponent from "./nodes/CheckExistenceNodeComponent";
import ContinueNodeComponent from "./nodes/ContinueNodeComponent";
import IfNodeComponent from "./nodes/IfNodeComponent";
import StopNodeComponent from "./nodes/StopNodeComponent";

const nodeTypes: Record<string, any> = {
    break: BreakNodeComponent,
    continue: ContinueNodeComponent,
    if: IfNodeComponent,
    stop: StopNodeComponent,
    check_existence: CheckExistenceNodeComponent,
    groupProxy: GroupProxyNode,
};

NODE_TYPES_CONFIG.forEach((config) => {
    if (!nodeTypes[config.type]) {
        nodeTypes[config.type] = BrowserNode;
    }
});

let id = Date.now();
const getId = () => `node_${id++}`;

const COLLAPSED_GROUP_WIDTH = 280;
const COLLAPSED_GROUP_HEADER_HEIGHT = 44;
const GROUP_PROXY_PREFIX = "__group_proxy__";

const getGroupProxyId = (groupId: string) => `${GROUP_PROXY_PREFIX}${groupId}`;
const isGroupProxyNodeId = (nodeId?: string | null) => Boolean(nodeId?.startsWith(GROUP_PROXY_PREFIX));
const getGroupIdFromProxy = (nodeId?: string | null) =>
    nodeId?.startsWith(GROUP_PROXY_PREFIX)
        ? nodeId.slice(GROUP_PROXY_PREFIX.length)
        : null;

const getNodeTypeName = (node?: Node | null) =>
    typeof node?.data?.nodeType === "string" ? node.data.nodeType : node?.type;

const getNodeSourceHandles = (node?: Node | null) => {
    const nodeType = getNodeTypeName(node);
    if (["if", "check_existence"].includes(nodeType || "")) {
        return ["true", "false"];
    }
    if (["foreach", "while", "for"].includes(nodeType || "")) {
        return ["body", "done"];
    }
    if (["stop", "break", "continue"].includes(nodeType || "")) {
        return [];
    }
    return [undefined];
};

const getPrimarySourceHandle = (node?: Node | null) => {
    const handles = getNodeSourceHandles(node);
    return handles[handles.length - 1];
};

const getGroupDisplayBounds = (group: FlowGroup, allNodes: Node[]) => {
    const bounds = computeGroupBounds(group, allNodes);
    if (!bounds) return null;

    return {
        x: bounds.x,
        y: bounds.y,
        width: group.collapsed ? COLLAPSED_GROUP_WIDTH : bounds.width,
        height: group.collapsed ? COLLAPSED_GROUP_HEADER_HEIGHT : bounds.height,
    };
};

const getNodeContentBounds = (group: FlowGroup, allNodes: Node[]) => {
    const memberNodes = allNodes.filter((node) => group.nodeIds.includes(node.id));
    if (memberNodes.length === 0) return null;

    const bounds = memberNodes.reduce(
        (acc, node) => {
            const width = Number(node.measured?.width) || 220;
            const height = Number(node.measured?.height) || 90;
            acc.minX = Math.min(acc.minX, node.position.x);
            acc.minY = Math.min(acc.minY, node.position.y);
            acc.maxX = Math.max(acc.maxX, node.position.x + width);
            acc.maxY = Math.max(acc.maxY, node.position.y + height);
            return acc;
        },
        {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
        },
    );

    return bounds;
};

const buildGroupProxyNodes = (groups: FlowGroup[], allNodes: Node[], allEdges: Edge[]): Node[] => {
    return groups
        .map((group) => {
            const bounds = getGroupDisplayBounds(group, allNodes);
            if (!bounds) return null;
            const exitNodeId = inferGroupExitNodeId(group, allEdges);
            const exitNode = allNodes.find((node) => node.id === exitNodeId) || null;

            return {
                id: getGroupProxyId(group.id),
                type: "groupProxy",
                position: { x: bounds.x, y: bounds.y },
                className: "nodrag nopan",
                data: {
                    groupId: group.id,
                    label: group.title,
                    proxy: {
                        showTarget: Boolean(inferGroupEntryNodeId(group, allEdges)),
                        sourceHandles: getNodeSourceHandles(exitNode),
                        width: bounds.width,
                        height: bounds.height,
                    },
                },
                draggable: false,
                selectable: false,
                focusable: false,
                deletable: false,
                connectable: true,
                zIndex: 100,
                style: {
                    width: bounds.width,
                    height: bounds.height,
                    opacity: 1,
                    pointerEvents: "none",
                    background: "transparent",
                    overflow: "visible",
                    zIndex: 100,
                },
            } as Node;
        })
        .filter((node): node is Node => Boolean(node));
};

const syncPersistentGroupProxyNodes = (allNodes: Node[], groups: FlowGroup[], allEdges: Edge[]) => {
    const contentNodes = allNodes.filter((node) => !isGroupProxyNodeId(node.id));
    const nextProxyNodes = buildGroupProxyNodes(groups, contentNodes, allEdges);
    const currentProxyNodes = allNodes.filter((node) => isGroupProxyNodeId(node.id));

    const sameLength = currentProxyNodes.length === nextProxyNodes.length;
    const sameProxies = sameLength && currentProxyNodes.every((node, index) => {
        const nextNode = nextProxyNodes[index];
        return (
            nextNode
            && node.id === nextNode.id
            && node.position.x === nextNode.position.x
            && node.position.y === nextNode.position.y
            && node.data?.label === nextNode.data?.label
            && JSON.stringify(node.data?.proxy) === JSON.stringify(nextNode.data?.proxy)
        );
    });

    if (sameProxies) {
        return allNodes;
    }

    return [...contentNodes, ...nextProxyNodes];
};

const findGroupByProxyNodeId = (groups: FlowGroup[], nodeId?: string | null) => {
    const groupId = getGroupIdFromProxy(nodeId);
    if (!groupId) return null;
    return groups.find((group) => group.id === groupId) || null;
};

const inferGroupEntryNodeId = (group: FlowGroup, allEdges: Edge[]) => {
    if (group.entryNodeId && group.nodeIds.includes(group.entryNodeId)) {
        return group.entryNodeId;
    }

    const groupNodeIds = new Set(group.nodeIds);
    const internalTargets = new Set(
        allEdges
            .filter((edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target))
            .map((edge) => edge.target),
    );

    return group.nodeIds.find((nodeId) => !internalTargets.has(nodeId)) || group.nodeIds[0];
};

const inferGroupExitNodeId = (group: FlowGroup, allEdges: Edge[]) => {
    if (group.exitNodeId && group.nodeIds.includes(group.exitNodeId)) {
        return group.exitNodeId;
    }

    const groupNodeIds = new Set(group.nodeIds);
    const internalSources = new Set(
        allEdges
            .filter((edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target))
            .map((edge) => edge.source),
    );

    return [...group.nodeIds].reverse().find((nodeId) => !internalSources.has(nodeId)) || group.nodeIds[group.nodeIds.length - 1];
};

const collectDownstreamNodeIds = (startNodeIds: string[], allEdges: Edge[], blockedNodeIds: Set<string>) => {
    const visited = new Set<string>();
    const queue = [...startNodeIds];

    while (queue.length > 0) {
        const currentNodeId = queue.shift();
        if (!currentNodeId || visited.has(currentNodeId) || blockedNodeIds.has(currentNodeId)) {
            continue;
        }

        visited.add(currentNodeId);
        allEdges.forEach((edge) => {
            if (edge.source === currentNodeId && !visited.has(edge.target) && !blockedNodeIds.has(edge.target)) {
                queue.push(edge.target);
            }
        });
    }

    return visited;
};

const findDirectedPathNodeIds = (startNodeId: string, endNodeId: string, allEdges: Edge[]) => {
    if (startNodeId === endNodeId) return [startNodeId];

    const queue: string[] = [startNodeId];
    const visited = new Set<string>([startNodeId]);
    const previous = new Map<string, string | null>([[startNodeId, null]]);

    while (queue.length > 0) {
        const currentNodeId = queue.shift();
        if (!currentNodeId) continue;

        const nextNodeIds = allEdges
            .filter((edge) => edge.source === currentNodeId)
            .map((edge) => edge.target);

        for (const nextNodeId of nextNodeIds) {
            if (visited.has(nextNodeId)) continue;
            visited.add(nextNodeId);
            previous.set(nextNodeId, currentNodeId);

            if (nextNodeId === endNodeId) {
                const path: string[] = [];
                let cursor: string | null = endNodeId;
                while (cursor) {
                    path.unshift(cursor);
                    cursor = previous.get(cursor) ?? null;
                }
                return path;
            }

            queue.push(nextNodeId);
        }
    }

    return null;
};

const collectReachableNodeIds = (startNodeId: string, allEdges: Edge[]) => {
    const visited = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
        const currentNodeId = queue.shift();
        if (!currentNodeId || visited.has(currentNodeId)) continue;

        visited.add(currentNodeId);
        allEdges.forEach((edge) => {
            if (edge.source === currentNodeId && !visited.has(edge.target)) {
                queue.push(edge.target);
            }
        });
    }

    return visited;
};

const collectReverseReachableNodeIds = (startNodeId: string, allEdges: Edge[]) => {
    const visited = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
        const currentNodeId = queue.shift();
        if (!currentNodeId || visited.has(currentNodeId)) continue;

        visited.add(currentNodeId);
        allEdges.forEach((edge) => {
            if (edge.target === currentNodeId && !visited.has(edge.source)) {
                queue.push(edge.source);
            }
        });
    }

    return visited;
};

const findBranchRangeNodeIds = (startNodeId: string, endNodeId: string, allEdges: Edge[]) => {
    const reachableFromStart = collectReachableNodeIds(startNodeId, allEdges);
    if (!reachableFromStart.has(endNodeId)) {
        return null;
    }

    const canReachEnd = collectReverseReachableNodeIds(endNodeId, allEdges);
    const selectedNodeIds = new Set(
        [...reachableFromStart].filter((nodeId) => canReachEnd.has(nodeId)),
    );

    const pendingNodeIds: string[] = [];

    selectedNodeIds.forEach((nodeId) => {
        const outgoingTargets = allEdges
            .filter((edge) => edge.source === nodeId)
            .map((edge) => edge.target);

        const hasSelectedTarget = outgoingTargets.some((targetNodeId) => selectedNodeIds.has(targetNodeId));
        const missingTargets = outgoingTargets.filter((targetNodeId) => !selectedNodeIds.has(targetNodeId));

        if (hasSelectedTarget && missingTargets.length > 0) {
            pendingNodeIds.push(...missingTargets);
        }
    });

    while (pendingNodeIds.length > 0) {
        const currentNodeId = pendingNodeIds.shift();
        if (!currentNodeId || selectedNodeIds.has(currentNodeId)) {
            continue;
        }

        selectedNodeIds.add(currentNodeId);

        allEdges.forEach((edge) => {
            if (edge.source === currentNodeId && !selectedNodeIds.has(edge.target)) {
                pendingNodeIds.push(edge.target);
            }
        });
    }

    return [...selectedNodeIds];
};

let clipboardNodes: Node[] = [];
let clipboardEdges: Edge[] = [];
let clipboardGroups: FlowGroup[] = [];

interface FlowCanvasProps {
    initialNodes?: Node[];
    initialEdges?: Edge[];
    initialGroups?: FlowGroup[];
    isRunning?: boolean;
    readOnly?: boolean;
    allowNodeEditingInReadOnly?: boolean;
    onFlowChange?: (nodes: Node[], edges: Edge[], groups: FlowGroup[]) => void;
    onAddNodeRef?: (fn: (nodeType: string) => void) => void;
    onPaneClick?: () => void;
    onSetNodeExecStatusRef?: (
        fn: (
            nodeId: string,
            status: string,
            detail?: { message?: string; error?: string; duration?: number },
        ) => void,
    ) => void;
    onResetRef?: (fn: (nodes: Node[], edges: Edge[], groups: FlowGroup[]) => void) => void;
}

const FlowCanvas = ({
    initialNodes = [],
    initialEdges = [],
    initialGroups = [],
    isRunning = false,
    readOnly = false,
    allowNodeEditingInReadOnly = false,
    onFlowChange,
    onAddNodeRef,
    onPaneClick,
    onSetNodeExecStatusRef,
    onResetRef,
}: FlowCanvasProps) => {
    const isMobile = useIsMobile();
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const suppressFlowChangeRef = useRef(0);
    const rangeSelectionAnchorRef = useRef<string | null>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [groups, setGroups] = useState<FlowGroup[]>(initialGroups);
    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
    const [showMinimap, setShowMinimap] = useState(false);
    const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
    const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
    const [editingNode, setEditingNode] = useState<Node | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [groupDraftTitle, setGroupDraftTitle] = useState("");
    const [isConnecting, setIsConnecting] = useState(false);
    const contentNodes = nodes.filter((node) => !isGroupProxyNodeId(node.id));

    const cloneGroupsWithIdMap = useCallback((sourceGroups: FlowGroup[], idMap: Map<string, string>) => {
        return sourceGroups
            .map((group) => ({
                ...group,
                id: createGroup({
                    title: group.title,
                    nodeIds: [],
                    description: group.description,
                    color: group.color,
                }).id,
                entryNodeId: group.entryNodeId ? idMap.get(group.entryNodeId) : undefined,
                exitNodeId: group.exitNodeId ? idMap.get(group.exitNodeId) : undefined,
                nodeIds: group.nodeIds
                    .map((nodeId) => idMap.get(nodeId))
                    .filter((nodeId): nodeId is string => Boolean(nodeId)),
            }))
            .filter((group) => group.nodeIds.length > 0);
    }, []);

    const duplicateClipboardToCanvas = useCallback(() => {
        if (clipboardNodes.length === 0) return false;

        const idMap = new Map<string, string>();
        clipboardNodes.forEach((node) => idMap.set(node.id, getId()));

        const newNodes: Node[] = clipboardNodes.map((node) => ({
            ...node,
            id: idMap.get(node.id)!,
            selected: true,
            position: { x: node.position.x + 50, y: node.position.y + 50 },
            data: {
                ...node.data,
                _execStatus: undefined,
                _execMessage: undefined,
                _execError: undefined,
                _execDuration: undefined,
            },
        }));

        const newEdges: Edge[] = clipboardEdges
            .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
            .map((edge) => ({
                ...edge,
                id: `e_${idMap.get(edge.source)}_${idMap.get(edge.target)}`,
                source: idMap.get(edge.source)!,
                target: idMap.get(edge.target)!,
                selected: false,
            }));

        const newGroups = cloneGroupsWithIdMap(clipboardGroups, idMap);

        setNodes((nds) => [
            ...nds.map((node) => ({ ...node, selected: false })),
            ...newNodes,
        ]);
        setEdges((eds) => [...eds.map((edge) => ({ ...edge, selected: false })), ...newEdges]);
        setGroups((prev) => [...prev, ...newGroups]);

        if (newGroups.length === 1) {
            setSelectedGroupId(newGroups[0].id);
            setGroupDraftTitle(newGroups[0].title);
            setSelectedNodes([]);
            setSelectedEdges([]);
        } else {
            setSelectedGroupId(null);
            setSelectedNodes(newNodes.map((node) => node.id));
            setSelectedEdges([]);
        }

        clipboardNodes = clipboardNodes.map((node) => ({
            ...node,
            position: { x: node.position.x + 50, y: node.position.y + 50 },
        }));

        return { nodeCount: newNodes.length, groupCount: newGroups.length };
    }, [cloneGroupsWithIdMap, setEdges, setNodes]);

    const collapsedGroupByNodeId = new Map<string, FlowGroup>();
    groups.forEach((group) => {
        if (!group.collapsed) return;
        group.nodeIds.forEach((nodeId) => {
            collapsedGroupByNodeId.set(nodeId, group);
        });
    });

    const hiddenNodeIds = new Set(collapsedGroupByNodeId.keys());
    const visibleNodes = nodes.filter((node) => isGroupProxyNodeId(node.id) || !hiddenNodeIds.has(node.id));
    const visibleEdges = edges
        .map((edge) => {
            const sourceCollapsedGroup = collapsedGroupByNodeId.get(edge.source);
            const targetCollapsedGroup = collapsedGroupByNodeId.get(edge.target);

            if (sourceCollapsedGroup && targetCollapsedGroup) {
                if (sourceCollapsedGroup.id === targetCollapsedGroup.id) {
                    return null;
                }

                return {
                    ...edge,
                    source: getGroupProxyId(sourceCollapsedGroup.id),
                    sourceHandle: edge.sourceHandle,
                    target: getGroupProxyId(targetCollapsedGroup.id),
                    targetHandle: undefined,
                };
            }

            if (sourceCollapsedGroup) {
                return {
                    ...edge,
                    source: getGroupProxyId(sourceCollapsedGroup.id),
                };
            }

            if (targetCollapsedGroup) {
                return {
                    ...edge,
                    target: getGroupProxyId(targetCollapsedGroup.id),
                    targetHandle: undefined,
                };
            }

            return edge;
        })
        .filter((edge): edge is Edge => Boolean(edge));

    useEffect(() => {
        setEdges((eds) => eds.map((edge) => ({ ...edge, animated: isRunning })));
    }, [isRunning, setEdges]);

    useEffect(() => {
        suppressFlowChangeRef.current += 1;
        setNodes(initialNodes);
    }, [initialNodes, setNodes]);

    useEffect(() => {
        setNodes((prev) => syncPersistentGroupProxyNodes(prev, groups, edges));
    }, [edges, groups, nodes, setNodes]);

    useEffect(() => {
        suppressFlowChangeRef.current += 1;
        setEdges(initialEdges);
    }, [initialEdges, setEdges]);

    useEffect(() => {
        suppressFlowChangeRef.current += 1;
        setGroups(initialGroups);
    }, [initialGroups]);

    useEffect(() => {
        if (suppressFlowChangeRef.current > 0) {
            suppressFlowChangeRef.current -= 1;
            return;
        }
        onFlowChange?.(contentNodes, edges, groups);
    }, [contentNodes, edges, groups, onFlowChange]);

    const addNodeToCenter = useCallback(
        (nodeType: string) => {
            const config = NODE_TYPES_CONFIG.find((item) => item.type === nodeType);
            if (!config) return;

            let position = { x: 250, y: 100 };
            if (reactFlowInstance && reactFlowWrapper.current) {
                const bounds = reactFlowWrapper.current.getBoundingClientRect();
                position = reactFlowInstance.screenToFlowPosition({
                    x: bounds.left + bounds.width / 2,
                    y: bounds.top + bounds.height / 2,
                });
            }

            position.x += (Math.random() - 0.5) * 40;
            position.y += (Math.random() - 0.5) * 40;

            const newNode: Node = {
                id: getId(),
                type: config.type,
                position,
                data: {
                    label: config.label,
                    nodeType: config.type,
                    captureScreenshot: false,
                    screenshotTiming: "after",
                    ...buildDefaultData(config),
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes],
    );

    const setNodeExecStatus = useCallback(
        (nodeId: string, status: string, detail?: { message?: string; error?: string; duration?: number }) => {
            if (nodeId === "__reset__") {
                setNodes((nds) =>
                    nds.map((node) => ({
                        ...node,
                        data: {
                            ...node.data,
                            _execStatus: "idle",
                            _execMessage: "",
                            _execError: "",
                            _execDuration: undefined,
                        },
                    })),
                );
                return;
            }

            setNodes((nds) =>
                nds.map((node) =>
                    node.id === nodeId
                        ? {
                            ...node,
                            data: {
                                ...node.data,
                                _execStatus: status,
                                _execMessage: detail?.message || "",
                                _execError: detail?.error || "",
                                _execDuration: detail?.duration,
                            },
                        }
                        : node,
                ),
            );
        },
        [setNodes],
    );

    useEffect(() => {
        onSetNodeExecStatusRef?.(setNodeExecStatus);
    }, [onSetNodeExecStatusRef, setNodeExecStatus]);

    useEffect(() => {
        onAddNodeRef?.(addNodeToCenter);
    }, [addNodeToCenter, onAddNodeRef]);

    useEffect(() => {
        onResetRef?.((newNodes: Node[], newEdges: Edge[], newGroups: FlowGroup[]) => {
            suppressFlowChangeRef.current += 3;
            setNodes(syncPersistentGroupProxyNodes(newNodes, newGroups, newEdges));
            setEdges(newEdges);
            setGroups(newGroups);
        });
    }, [onResetRef, setEdges, setNodes]);

    const onConnect = useCallback(
        (params: Connection) => {
            const sourceGroup = findGroupByProxyNodeId(groups, params.source);
            const targetGroup = findGroupByProxyNodeId(groups, params.target);

            let source = params.source || "";
            let target = params.target || "";
            let sourceHandle = params.sourceHandle;
            let targetHandle = params.targetHandle;

            if (sourceGroup) {
                const exitNodeId = inferGroupExitNodeId(sourceGroup, edges);
                if (!exitNodeId) {
                    toast.error("该分组没有可用的输出节点");
                    return;
                }
                const exitNode = contentNodes.find((node) => node.id === exitNodeId) || null;
                source = exitNodeId;
                sourceHandle = sourceHandle ?? getPrimarySourceHandle(exitNode);
            }

            if (targetGroup) {
                const entryNodeId = inferGroupEntryNodeId(targetGroup, edges);
                if (!entryNodeId) {
                    toast.error("该分组没有可用的输入节点");
                    return;
                }
                target = entryNodeId;
                targetHandle = undefined;
            }

            const edge = {
                ...params,
                source,
                sourceHandle,
                target,
                targetHandle,
                data: {
                    condition:
                        sourceHandle === "true"
                            ? "true"
                            : sourceHandle === "false"
                                ? "false"
                                : undefined,
                },
            };
            setEdges((eds) => addEdge(edge, eds));
        },
        [edges, groups, setEdges],
    );

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            if (readOnly || !reactFlowInstance || !reactFlowWrapper.current) return;
            event.preventDefault();

            const type = event.dataTransfer.getData("application/reactflow");
            const config = NODE_TYPES_CONFIG.find((item) => item.type === type);
            if (!config) return;

            const bounds = reactFlowWrapper.current.getBoundingClientRect();
            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
            });

            const newNode: Node = {
                id: getId(),
                type: config.type,
                position,
                data: {
                    label: config.label,
                    nodeType: config.type,
                    captureScreenshot: false,
                    screenshotTiming: "after",
                    ...buildDefaultData(config),
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, readOnly, setNodes],
    );

    const onSelectionChange = useCallback(
        ({ nodes: selectedNodeItems, edges: selectedEdgeItems }: { nodes: Node[]; edges: Edge[] }) => {
            setSelectedNodes(selectedNodeItems.map((node) => node.id));
            setSelectedEdges(selectedEdgeItems.map((edge) => edge.id));
            if (selectedNodeItems.length === 1) {
                rangeSelectionAnchorRef.current = selectedNodeItems[0].id;
            }
            if (selectedNodeItems.length > 0 || selectedEdgeItems.length > 0) {
                setSelectedGroupId(null);
            }
        },
        [],
    );

    const handleNodeClick = useCallback(
        (event: React.MouseEvent, node: Node) => {
            if (readOnly || isGroupProxyNodeId(node.id)) return;

            const anchorNodeId = rangeSelectionAnchorRef.current;
            if (!event.shiftKey || !anchorNodeId || anchorNodeId === node.id) {
                rangeSelectionAnchorRef.current = node.id;
                return;
            }

            const forwardSelection = findBranchRangeNodeIds(anchorNodeId, node.id, edges);
            const backwardSelection = findBranchRangeNodeIds(node.id, anchorNodeId, edges);
            const pathNodeIds = forwardSelection || backwardSelection;

            if (!pathNodeIds || pathNodeIds.length < 2) {
                rangeSelectionAnchorRef.current = node.id;
                return;
            }

            const selectedNodeIdSet = new Set(pathNodeIds);
            const selectedEdgeIdSet = new Set(
                edges
                    .filter((edge) => selectedNodeIdSet.has(edge.source) && selectedNodeIdSet.has(edge.target))
                    .map((edge) => edge.id),
            );

            setNodes((prev) =>
                prev.map((currentNode) =>
                    isGroupProxyNodeId(currentNode.id)
                        ? currentNode
                        : { ...currentNode, selected: selectedNodeIdSet.has(currentNode.id) },
                ),
            );
            setEdges((prev) =>
                prev.map((edgeItem) => ({
                    ...edgeItem,
                    selected: selectedEdgeIdSet.has(edgeItem.id),
                })),
            );
            setSelectedNodes(pathNodeIds);
            setSelectedEdges([...selectedEdgeIdSet]);
            setSelectedGroupId(null);
        },
        [edges, readOnly, setEdges, setNodes],
    );

    const deleteSelected = useCallback(() => {
        if (readOnly) return;

        let remainingNodes = contentNodes;
        const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;

        if (selectedGroup) {
            const groupNodeIds = new Set(selectedGroup.nodeIds);
            remainingNodes = contentNodes.filter((node) => !groupNodeIds.has(node.id));
            setNodes((prev) =>
                syncPersistentGroupProxyNodes(
                    prev.filter((node) => !groupNodeIds.has(node.id)),
                    groups.filter((group) => group.id !== selectedGroup.id),
                    edges.filter((edge) => !groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target)),
                ),
            );
            setEdges((eds) => eds.filter((edge) => !groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target)));
            setGroups((prev) => prev.filter((group) => group.id !== selectedGroup.id));
            setSelectedGroupId(null);
            setGroupDraftTitle("");
            setSelectedNodes([]);
            setSelectedEdges([]);
            return;
        }

        if (selectedNodes.length > 0) {
            remainingNodes = contentNodes.filter((node) => !selectedNodes.includes(node.id));
            setNodes((prev) => syncPersistentGroupProxyNodes(prev.filter((node) => !selectedNodes.includes(node.id)), groups, edges));
            setEdges((eds) =>
                eds.filter((edge) => !selectedNodes.includes(edge.source) && !selectedNodes.includes(edge.target)),
            );
            setGroups((prev) => sanitizeGroups(prev, new Set(remainingNodes.map((node) => node.id))));
        }

        if (selectedEdges.length > 0) {
            setEdges((eds) => eds.filter((edge) => !selectedEdges.includes(edge.id)));
        }

        setSelectedNodes([]);
        setSelectedEdges([]);
    }, [contentNodes, groups, readOnly, selectedEdges, selectedGroupId, selectedNodes, setEdges, setNodes]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (readOnly) return;

            const target = event.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
            const isWithinCanvas = Boolean(reactFlowWrapper.current?.contains(target)) || target === document.body;
            if (!isWithinCanvas) return;

            if (event.key === "Backspace" || event.key === "Delete") {
                if (!selectedGroupId && selectedNodes.length === 0 && selectedEdges.length === 0) return;
                event.preventDefault();
                deleteSelected();
                return;
            }

            const mod = event.ctrlKey || event.metaKey;
            if (!mod) return;

            if (event.key === "a") {
                event.preventDefault();
                setNodes((nds) => nds.map((node) => ({ ...node, selected: true })));
                setEdges((eds) => eds.map((edge) => ({ ...edge, selected: true })));
            }

            if (event.key === "c") {
                const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;
                const currentSelectedNodes = selectedGroup
                    ? contentNodes.filter((node) => selectedGroup.nodeIds.includes(node.id))
                    : contentNodes.filter((node) => node.selected);
                if (currentSelectedNodes.length === 0) return;
                event.preventDefault();
                const selectedIds = new Set(currentSelectedNodes.map((node) => node.id));
                clipboardNodes = currentSelectedNodes.map((node) => ({ ...node }));
                clipboardEdges = edges.filter(
                    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
                );
                clipboardGroups = selectedGroup
                    ? [
                        {
                            ...selectedGroup,
                            nodeIds: selectedGroup.nodeIds.filter((nodeId) => selectedIds.has(nodeId)),
                        },
                    ]
                    : [];
                toast.success(
                    selectedGroup
                        ? `已复制分组「${selectedGroup.title}」`
                        : `Copied ${currentSelectedNodes.length} node(s)`,
                );
            }

            if (event.key === "v") {
                if (clipboardNodes.length === 0) return;
                event.preventDefault();
                const result = duplicateClipboardToCanvas();
                if (!result) return;
                toast.success(
                    result.groupCount > 0
                        ? `已粘贴 ${result.groupCount} 个分组`
                        : `Pasted ${result.nodeCount} node(s)`,
                );
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [contentNodes, deleteSelected, duplicateClipboardToCanvas, edges, groups, readOnly, selectedEdges, selectedGroupId, selectedNodes]);

    const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0 || Boolean(selectedGroupId);
    const activeGroup = groups.find((group) => group.id === selectedGroupId) || null;

    const handleCreateGroup = useCallback(() => {
        if (readOnly || selectedNodes.length < 2) return;
        const next = createGroup({
            title: `分组 ${groups.length + 1}`,
            nodeIds: selectedNodes,
        });
        setGroups((prev) => [...prev, next]);
        setSelectedGroupId(next.id);
        setGroupDraftTitle(next.title);
        toast.success("已创建分组");
    }, [groups.length, readOnly, selectedNodes]);

    const handleUngroup = useCallback(
        (groupId: string) => {
            const targetGroup = groups.find((group) => group.id === groupId);
            if (!targetGroup) return;

            const currentBounds = getGroupDisplayBounds(targetGroup, contentNodes);
            const contentBounds = getNodeContentBounds(targetGroup, contentNodes);
            const nextGroups = groups.filter((group) => group.id !== groupId);

            setGroups(nextGroups);

            const groupNodeIdSet = new Set(targetGroup.nodeIds);
            const downstreamStartNodeIds = edges
                .filter((edge) => groupNodeIdSet.has(edge.source) && !groupNodeIdSet.has(edge.target))
                .map((edge) => edge.target);

            if (currentBounds && contentBounds && downstreamStartNodeIds.length > 0) {
                const currentBottom = currentBounds.y + currentBounds.height;
                const nextBottom = contentBounds.maxY;
                const deltaY = nextBottom - currentBottom;

                if (deltaY !== 0) {
                    const downstreamNodeIds = collectDownstreamNodeIds(downstreamStartNodeIds, edges, groupNodeIdSet);

                    if (downstreamNodeIds.size > 0) {
                        setNodes((prev) =>
                            syncPersistentGroupProxyNodes(
                                prev.map((node) =>
                                    downstreamNodeIds.has(node.id)
                                        ? {
                                            ...node,
                                            position: {
                                                ...node.position,
                                                y: node.position.y + deltaY,
                                            },
                                        }
                                        : node,
                                ),
                                nextGroups,
                                edges,
                            ),
                        );
                    }
                }
            }

            if (selectedGroupId === groupId) {
                setSelectedGroupId(null);
                setGroupDraftTitle("");
            }
            toast.success("已解组");
        },
        [contentNodes, edges, groups, selectedGroupId, setNodes],
    );

    const handleToggleGroupCollapse = useCallback((groupId: string) => {
        const targetGroup = groups.find((group) => group.id === groupId);
        if (!targetGroup) return;

        const currentBounds = getGroupDisplayBounds(targetGroup, contentNodes);
        const nextGroup = { ...targetGroup, collapsed: !targetGroup.collapsed };
        const nextBounds = getGroupDisplayBounds(nextGroup, contentNodes);

        setGroups((prev) =>
            prev.map((group) =>
                group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
            ),
        );

        if (!currentBounds || !nextBounds) return;

        const deltaY = nextBounds.height - currentBounds.height;
        if (deltaY === 0) return;

        const groupNodeIdSet = new Set(targetGroup.nodeIds);
        const downstreamStartNodeIds = edges
            .filter((edge) => groupNodeIdSet.has(edge.source) && !groupNodeIdSet.has(edge.target))
            .map((edge) => edge.target);

        if (downstreamStartNodeIds.length === 0) return;

        const downstreamNodeIds = collectDownstreamNodeIds(downstreamStartNodeIds, edges, groupNodeIdSet);
        if (downstreamNodeIds.size === 0) return;

        setNodes((prev) =>
            syncPersistentGroupProxyNodes(
                prev.map((node) =>
                    downstreamNodeIds.has(node.id)
                        ? {
                            ...node,
                            position: {
                                ...node.position,
                                y: node.position.y + deltaY,
                            },
                        }
                        : node,
                ),
                groups.map((group) => (group.id === groupId ? nextGroup : group)),
                edges,
            ),
        );
    }, [contentNodes, edges, groups, setNodes]);

    const handleDragGroup = useCallback(
        (groupId: string, nextClientX: number, nextClientY: number, prevClientX: number, prevClientY: number) => {
            if (readOnly || !reactFlowInstance) return;

            const nextPosition = reactFlowInstance.screenToFlowPosition({ x: nextClientX, y: nextClientY });
            const prevPosition = reactFlowInstance.screenToFlowPosition({ x: prevClientX, y: prevClientY });
            const deltaX = nextPosition.x - prevPosition.x;
            const deltaY = nextPosition.y - prevPosition.y;

            if (deltaX === 0 && deltaY === 0) return;

            const targetGroup = groups.find((group) => group.id === groupId);
            if (!targetGroup) return;

            const nodeIdSet = new Set(targetGroup.nodeIds);
            setNodes((prev) =>
                syncPersistentGroupProxyNodes(prev.map((node) =>
                    nodeIdSet.has(node.id)
                        ? {
                            ...node,
                            position: {
                                x: node.position.x + deltaX,
                                y: node.position.y + deltaY,
                            },
                        }
                        : node,
                ), groups, edges),
            );
        },
        [edges, groups, readOnly, reactFlowInstance, setNodes],
    );

    const handleGroupTitleSave = useCallback(() => {
        if (!selectedGroupId) return;
        const title = groupDraftTitle.trim();
        if (!title) return;
        setGroups((prev) => prev.map((group) => (group.id === selectedGroupId ? { ...group, title } : group)));
    }, [groupDraftTitle, selectedGroupId]);

    const tidyUp = useCallback(() => {
        const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
        graph.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

        const collapsedGroups = groups.filter((group) => group.collapsed);
        const collapsedGroupByNodeId = new Map<string, FlowGroup>();
        collapsedGroups.forEach((group) => {
            group.nodeIds.forEach((nodeId) => {
                collapsedGroupByNodeId.set(nodeId, group);
            });
        });

        const getLayoutNodeId = (nodeId: string) => {
            const collapsedGroup = collapsedGroupByNodeId.get(nodeId);
            return collapsedGroup ? getGroupProxyId(collapsedGroup.id) : nodeId;
        };

        const collapsedGroupBounds = new Map<string, ReturnType<typeof computeGroupBounds>>();
        collapsedGroups.forEach((group) => {
            collapsedGroupBounds.set(group.id, computeGroupBounds(group, contentNodes));
        });

        const addedLayoutNodeIds = new Set<string>();

        collapsedGroups.forEach((group) => {
            const layoutNodeId = getGroupProxyId(group.id);
            if (addedLayoutNodeIds.has(layoutNodeId)) return;
            addedLayoutNodeIds.add(layoutNodeId);

            graph.setNode(layoutNodeId, {
                width: COLLAPSED_GROUP_WIDTH,
                height: COLLAPSED_GROUP_HEADER_HEIGHT,
            });
        });

        contentNodes.forEach((node) => {
            if (collapsedGroupByNodeId.has(node.id)) return;

            graph.setNode(node.id, {
                width: Number(node.measured?.width) || 200,
                height: Number(node.measured?.height) || 60,
            });
            addedLayoutNodeIds.add(node.id);
        });

        const sortedEdges = [...edges].sort((a, b) => {
            const leftHandles = new Set(["true", "body"]);
            const rightHandles = new Set(["false", "done"]);
            const aIsLeft = leftHandles.has(a.sourceHandle || "");
            const bIsLeft = leftHandles.has(b.sourceHandle || "");
            const aIsRight = rightHandles.has(a.sourceHandle || "");
            const bIsRight = rightHandles.has(b.sourceHandle || "");
            if (aIsLeft && !bIsLeft) return -1;
            if (!aIsLeft && bIsLeft) return 1;
            if (aIsRight && !bIsRight) return 1;
            if (!aIsRight && bIsRight) return -1;
            return 0;
        });

        sortedEdges.forEach((edge) => {
            const source = getLayoutNodeId(edge.source);
            const target = getLayoutNodeId(edge.target);
            if (!source || !target || source === target) return;
            if (!addedLayoutNodeIds.has(source) || !addedLayoutNodeIds.has(target)) return;
            graph.setEdge(source, target);
        });

        Dagre.layout(graph);

        const nodePositions: Record<string, { x: number; y: number }> = {};
        contentNodes.forEach((node) => {
            if (collapsedGroupByNodeId.has(node.id)) return;
            const pos = graph.node(node.id);
            if (!pos) return;
            nodePositions[node.id] = { x: pos.x, y: pos.y };
        });

        collapsedGroups.forEach((group) => {
            const layoutNodeId = getGroupProxyId(group.id);
            const layoutNode = graph.node(layoutNodeId);
            const currentBounds = collapsedGroupBounds.get(group.id);
            if (!layoutNode || !currentBounds) return;

            const targetBounds = {
                x: layoutNode.x - COLLAPSED_GROUP_WIDTH / 2,
                y: layoutNode.y - COLLAPSED_GROUP_HEADER_HEIGHT / 2,
            };
            const deltaX = targetBounds.x - currentBounds.x;
            const deltaY = targetBounds.y - currentBounds.y;

            group.nodeIds.forEach((nodeId) => {
                const existingNode = contentNodes.find((node) => node.id === nodeId);
                if (!existingNode) return;
                nodePositions[nodeId] = {
                    x: existingNode.position.x + deltaX + ((Number(existingNode.measured?.width) || 200) / 2),
                    y: existingNode.position.y + deltaY + ((Number(existingNode.measured?.height) || 60) / 2),
                };
            });
        });

        const collectReachable = (startNodeId: string) => {
            const reachable = new Set<string>();
            const queue = [startNodeId];
            while (queue.length > 0) {
                const currentId = queue.shift()!;
                if (reachable.has(currentId)) continue;
                reachable.add(currentId);
                edges.forEach((edge) => {
                    if (edge.source === currentId) queue.push(edge.target);
                });
            }
            return reachable;
        };

        const shiftReachableNodes = (reachable: Set<string>, deltaX: number) => {
            reachable.forEach((nodeId) => {
                const pos = nodePositions[nodeId];
                if (pos) pos.x += deltaX;
            });
        };

        const BRANCH_BASE_OFFSET = 180;
        const DIRECT_BRANCH_MIN_GAP = 140;
        const DIRECT_BRANCH_EXTRA_GAP = 90;

        contentNodes.forEach((node) => {
            const outgoing = edges.filter((edge) => edge.source === node.id);
            const trueEdge = outgoing.find((edge) => edge.sourceHandle === "true" || edge.sourceHandle === "body");
            const falseEdge = outgoing.find((edge) => edge.sourceHandle === "false" || edge.sourceHandle === "done");
            if (!trueEdge || !falseEdge) return;

            const trueTargetPos = nodePositions[trueEdge.target];
            const falseTargetPos = nodePositions[falseEdge.target];
            if (!trueTargetPos || !falseTargetPos) return;

            if (trueTargetPos.x >= falseTargetPos.x) {
                const trueReachable = collectReachable(trueEdge.target);
                const falseReachable = collectReachable(falseEdge.target);
                const overlap = new Set([...trueReachable].filter((nodeId) => falseReachable.has(nodeId)));
                const trueOnly = new Set([...trueReachable].filter((nodeId) => !overlap.has(nodeId)));
                const falseOnly = new Set([...falseReachable].filter((nodeId) => !overlap.has(nodeId)));
                const gap = Math.max(
                    DIRECT_BRANCH_MIN_GAP,
                    Math.abs(trueTargetPos.x - falseTargetPos.x) / 2 + DIRECT_BRANCH_EXTRA_GAP,
                );
                shiftReachableNodes(trueOnly, -gap);
                shiftReachableNodes(falseOnly, gap);
            }
        });

        const trueReachable = new Set<string>();
        const falseReachable = new Set<string>();

        const traverse = (startNodeId: string, reachableSet: Set<string>) => {
            const queue = [startNodeId];
            while (queue.length > 0) {
                const currentId = queue.shift()!;
                if (reachableSet.has(currentId)) continue;
                reachableSet.add(currentId);
                edges.forEach((edge) => {
                    if (edge.source === currentId) queue.push(edge.target);
                });
            }
        };

        edges.forEach((edge) => {
            if (edge.sourceHandle === "true" || edge.sourceHandle === "body") traverse(edge.target, trueReachable);
            if (edge.sourceHandle === "false" || edge.sourceHandle === "done") traverse(edge.target, falseReachable);
        });

        contentNodes.forEach((node) => {
            const pos = nodePositions[node.id];
            if (!pos) return;
            const isTrue = trueReachable.has(node.id);
            const isFalse = falseReachable.has(node.id);
            if (isTrue && !isFalse) pos.x -= BRANCH_BASE_OFFSET;
            else if (isFalse && !isTrue) pos.x += BRANCH_BASE_OFFSET;
        });

        setNodes((prev) =>
            syncPersistentGroupProxyNodes(prev.map((node) =>
                isGroupProxyNodeId(node.id)
                    ? node
                    : {
                        ...node,
                        position: { x: nodePositions[node.id].x - 100, y: nodePositions[node.id].y - 30 },
                    }
            ), groups, edges),
        );

        setTimeout(() => {
            reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
        }, 50);
    }, [contentNodes, edges, groups, reactFlowInstance, setNodes]);

    const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
        setEditingNode(node);
    }, []);

    const onNodeSave = useCallback(
        (nodeId: string, data: Record<string, unknown>) => {
            setNodes((nds) =>
                nds.map((node) =>
                    node.id === nodeId
                        ? { ...node, data: { captureScreenshot: false, screenshotTiming: "after", ...data } }
                        : node,
                ),
            );
        },
        [setNodes],
    );

    return (
        <div ref={reactFlowWrapper} className="flex-1 h-full relative">
            <FlowGroupLayer
                groups={groups}
                nodes={contentNodes}
                selectedGroupId={selectedGroupId}
                isConnecting={isConnecting}
                onSelectGroup={(groupId) => {
                    setSelectedGroupId(groupId);
                    setSelectedNodes([]);
                    setSelectedEdges([]);
                    setGroupDraftTitle(groups.find((group) => group.id === groupId)?.title || "");
                }}
                onUngroup={handleUngroup}
                onToggleCollapse={handleToggleGroupCollapse}
                onDragGroup={handleDragGroup}
            />

            <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                proOptions={{ hideAttribution: true }}
                onNodesChange={readOnly ? undefined : onNodesChange}
                onEdgesChange={readOnly ? undefined : onEdgesChange}
                onConnect={readOnly ? undefined : onConnect}
                onConnectStart={readOnly ? undefined : () => setIsConnecting(true)}
                onConnectEnd={readOnly ? undefined : () => setIsConnecting(false)}
                onInit={setReactFlowInstance}
                onDrop={readOnly ? undefined : onDrop}
                onDragOver={readOnly ? undefined : onDragOver}
                onSelectionChange={onSelectionChange}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={readOnly && !allowNodeEditingInReadOnly ? undefined : onNodeDoubleClick}
                onPaneClick={() => {
                    setSelectedGroupId(null);
                    onPaneClick?.();
                }}
                nodeTypes={nodeTypes}
                fitView
                className="bg-background"
                defaultEdgeOptions={{ animated: false }}
                zoomOnDoubleClick={false}
                connectOnClick={false}
                nodesDraggable={!readOnly}
                nodesConnectable={!readOnly}
                elementsSelectable={!readOnly}
                nodesFocusable={!readOnly}
                edgesFocusable={!readOnly}
                deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            >
                <Controls />
                {showMinimap && (
                    <MiniMap nodeColor={() => "hsl(185, 80%, 55%)"} maskColor="hsl(220, 20%, 7%, 0.8)" />
                )}
                <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(220, 15%, 18%)" />
            </ReactFlow>

            <div
                className={[
                    "absolute z-10 flex gap-1.5",
                    isMobile ? "top-2 left-2 right-2 flex-row flex-wrap justify-end" : "top-2 right-2 flex-col",
                ].join(" ")}
            >
                {selectedNodes.length >= 2 && !readOnly && (
                    <button
                        onClick={handleCreateGroup}
                        className="min-h-9 px-2.5 py-1.5 rounded-md bg-card border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                        <Copy size={13} />
                        创建分组
                    </button>
                )}

                {hasSelection && !readOnly && (
                    <button
                        onClick={deleteSelected}
                        className="min-h-9 px-2.5 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-mono font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                        <Trash2 size={13} />
                        Delete
                    </button>
                )}

                <button
                    onClick={tidyUp}
                    className="min-h-9 px-2.5 py-1.5 rounded-md bg-card border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                    <AlignVerticalSpaceAround size={13} />
                    Tidy Up
                </button>

                <button
                    onClick={() => setShowMinimap((value) => !value)}
                    className={`min-h-9 px-2.5 py-1.5 rounded-md border border-border text-xs font-mono flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${showMinimap ? "bg-primary/20 text-primary border-primary/40" : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                >
                    <MapIcon size={13} />
                    {isMobile ? (showMinimap ? "Hide Map" : "Mini Map") : showMinimap ? "Hide Map" : "Mini Map"}
                </button>
            </div>

            {activeGroup && !readOnly && (
                <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg">
                    <div className="text-xs font-mono text-muted-foreground">分组名称</div>
                    <Input
                        value={groupDraftTitle}
                        onChange={(event) => setGroupDraftTitle(event.target.value)}
                        onBlur={handleGroupTitleSave}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                handleGroupTitleSave();
                            }
                        }}
                        className="h-8 w-48"
                    />
                    <button
                        onClick={() => handleUngroup(activeGroup.id)}
                        className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                        解组
                    </button>
                </div>
            )}

            <NodeEditor
                node={editingNode}
                open={Boolean(editingNode)}
                onSave={onNodeSave}
                onClose={() => setEditingNode(null)}
                readOnly={readOnly}
            />
        </div>
    );
};

export default FlowCanvas;
