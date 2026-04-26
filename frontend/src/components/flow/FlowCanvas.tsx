import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Background,
    BackgroundVariant,
    Controls,
    MiniMap,
    ReactFlow,
    addEdge,
    applyNodeChanges,
    type Connection,
    type Edge,
    type Node,
    type NodeChange,
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
import {
    computeGroupBounds,
    createGroup,
    getGroupAncestorIds,
    getGroupDepth,
    getGroupDescendantGroupIds,
    getGroupNodeIdsDeep,
    sanitizeGroups,
} from "@/lib/flowGroups";
import BrowserNode from "./BrowserNode";
import { GROUP_TARGET_HANDLE_ID } from "./GroupProxyHandles";
import MinimalGroupNode from "./MinimalGroupNode";
import NodeEditor from "./NodeEditor";
import { buildDefaultData, NODE_TYPES_CONFIG } from "./nodeTypes";
import BreakNodeComponent from "./nodes/BreakNodeComponent";
import CheckExistenceNodeComponent from "./nodes/CheckExistenceNodeComponent";
import ContinueNodeComponent from "./nodes/ContinueNodeComponent";
import IfNodeComponent from "./nodes/IfNodeComponent";
import StopNodeComponent from "./nodes/StopNodeComponent";

const FLOW_GROUP_NODE_TYPE = "flowGroup";
const MINIMAL_GROUP_TEST_NODE_TYPE = "minimalGroupTest";
const MINIMAL_GROUP_TEST_NODE_ID = "__minimal_group_test__";
const MINIMAL_GROUP_WIDTH = 220;
const MINIMAL_GROUP_HEIGHT = 120;
const GROUP_PADDING_LEFT = 40;
const GROUP_PADDING_RIGHT = 24;
const GROUP_PADDING_TOP = 64;
const GROUP_PADDING_BOTTOM = 18;

const nodeTypes: Record<string, any> = {
    break: BreakNodeComponent,
    continue: ContinueNodeComponent,
    if: IfNodeComponent,
    stop: StopNodeComponent,
    check_existence: CheckExistenceNodeComponent,
};

NODE_TYPES_CONFIG.forEach((config) => {
    if (!nodeTypes[config.type]) {
        nodeTypes[config.type] = BrowserNode;
    }
});
nodeTypes[FLOW_GROUP_NODE_TYPE] = MinimalGroupNode;
nodeTypes[MINIMAL_GROUP_TEST_NODE_TYPE] = MinimalGroupNode;

let id = Date.now();
const getId = () => `node_${id++}`;

const COLLAPSED_GROUP_WIDTH = 280;
const COLLAPSED_GROUP_HEADER_HEIGHT = 44;

const getNodeTypeName = (node?: Node | null) =>
    typeof node?.data?.nodeType === "string" ? node.data.nodeType : node?.type;

const isStopOnFailureDisabled = (value: unknown) => {
    if (typeof value === "string") {
        return value.toLowerCase() === "false";
    }
    return value === false;
};

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
    const stopOnFailure = node?.data?.stopOnFailure;
    if (isStopOnFailureDisabled(stopOnFailure)) {
        return [undefined, "error"];
    }
    return [undefined];
};

const getPrimarySourceHandle = (node?: Node | null) => {
    const handles = getNodeSourceHandles(node);
    return handles[handles.length - 1];
};

const normalizeSourceHandle = (
    sourceId: string,
    sourceHandle: string | null | undefined,
    allNodes: Node[],
    allGroups: FlowGroup[],
    allEdges: Edge[],
) => {
    const sourceGroup = allGroups.find((group) => group.id === sourceId) || null;
    const sourceNode = sourceGroup
        ? allNodes.find((node) => node.id === inferGroupExitNodeId(sourceGroup, allGroups, allEdges)) || null
        : allNodes.find((node) => node.id === sourceId) || null;

    const validHandles = getNodeSourceHandles(sourceNode);
    if (validHandles.includes(sourceHandle ?? undefined)) {
        return sourceHandle ?? undefined;
    }

    return getPrimarySourceHandle(sourceNode);
};

const normalizeEdgesForHandles = (allEdges: Edge[], allNodes: Node[], allGroups: FlowGroup[]) =>
    allEdges.map((edge) => ({
        ...edge,
        sourceHandle: normalizeSourceHandle(edge.source, edge.sourceHandle, allNodes, allGroups, allEdges),
        targetHandle: undefined,
    }));

const filterDanglingEdges = (allEdges: Edge[], allNodes: Node[], allGroups: FlowGroup[]) => {
    const validEndpointIds = new Set([
        ...allNodes.map((node) => node.id),
        ...allGroups.map((group) => group.id),
    ]);

    return allEdges.filter((edge) => validEndpointIds.has(edge.source) && validEndpointIds.has(edge.target));
};

const sanitizeEdges = (allEdges: Edge[], allNodes: Node[], allGroups: FlowGroup[]) => (
    normalizeEdgesForHandles(filterDanglingEdges(allEdges, allNodes, allGroups), allNodes, allGroups)
);

const getGroupContentDisplayBounds = (group: FlowGroup, allNodes: Node[], allGroups: FlowGroup[]) => {
    const memberBounds: Array<{ x: number; y: number; width: number; height: number }> = [];
    const directNodeIds = new Set(group.nodeIds);

    allNodes
        .filter((node) => directNodeIds.has(node.id))
        .forEach((node) => {
            memberBounds.push({
                x: node.position.x,
                y: node.position.y,
                width: Number(node.measured?.width) || 220,
                height: Number(node.measured?.height) || 90,
            });
        });

    allGroups
        .filter((childGroup) => childGroup.parentGroupId === group.id)
        .forEach((childGroup) => {
            const childBounds = getGroupDisplayBounds(childGroup, allNodes, allGroups);
            if (childBounds) {
                memberBounds.push(childBounds);
            }
        });

    if (memberBounds.length === 0) {
        return null;
    }

    return memberBounds.reduce(
        (acc, item) => {
            acc.minX = Math.min(acc.minX, item.x);
            acc.minY = Math.min(acc.minY, item.y);
            acc.maxX = Math.max(acc.maxX, item.x + item.width);
            acc.maxY = Math.max(acc.maxY, item.y + item.height);
            return acc;
        },
        {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
        },
    );
};

const getGroupDisplayBounds = (group: FlowGroup, allNodes: Node[], allGroups: FlowGroup[]) => {
    const memberBounds = getGroupContentDisplayBounds(group, allNodes, allGroups);

    if (!memberBounds) {
        const fallbackBounds = computeGroupBounds(group, allNodes, allGroups);
        if (!fallbackBounds) return null;
        return {
            x: fallbackBounds.x,
            y: fallbackBounds.y,
            width: group.collapsed ? COLLAPSED_GROUP_WIDTH : fallbackBounds.width,
            height: group.collapsed ? COLLAPSED_GROUP_HEADER_HEIGHT : fallbackBounds.height,
        };
    }

    return {
        x: memberBounds.minX - GROUP_PADDING_LEFT,
        y: memberBounds.minY - GROUP_PADDING_TOP,
        width: group.collapsed ? COLLAPSED_GROUP_WIDTH : memberBounds.maxX - memberBounds.minX + GROUP_PADDING_LEFT + GROUP_PADDING_RIGHT,
        height: group.collapsed ? COLLAPSED_GROUP_HEADER_HEIGHT : memberBounds.maxY - memberBounds.minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    };
};

const buildGroupBoundsMap = (groups: FlowGroup[], allNodes: Node[]) => {
    const boundsMap = new Map<string, ReturnType<typeof getGroupDisplayBounds>>();
    groups.forEach((group) => {
        boundsMap.set(group.id, getGroupDisplayBounds(group, allNodes, groups));
    });
    return boundsMap;
};

const getDirectParentGroupIdForNode = (nodeId: string, groups: FlowGroup[]) => {
    const matchedGroups = groups
        .filter((group) => group.nodeIds.includes(nodeId))
        .sort((a, b) => getGroupDepth(b.id, groups) - getGroupDepth(a.id, groups));

    return matchedGroups[0]?.id;
};

const buildRenderableNodes = (
    allNodes: Node[],
    groups: FlowGroup[],
    hiddenNodeIds: Set<string>,
    hiddenGroupIds: Set<string>,
) => {
    const boundsMap = buildGroupBoundsMap(groups, stripDerivedGroupNodes(allNodes));
    const renderableNodes = allNodes
        .filter((node) => {
            if (node.type === FLOW_GROUP_NODE_TYPE) {
                return !hiddenGroupIds.has(node.id);
            }

            return !hiddenNodeIds.has(node.id);
        })
        .map((node) => {
            if (node.type === FLOW_GROUP_NODE_TYPE) {
                const group = groups.find((item) => item.id === node.id);
                const parentGroupId = group?.parentGroupId;
                const parentBounds = parentGroupId ? boundsMap.get(parentGroupId) : null;

                if (!group || !parentGroupId || !parentBounds || hiddenGroupIds.has(parentGroupId) || groups.find((item) => item.id === parentGroupId)?.collapsed) {
                    return {
                        ...node,
                        parentId: undefined,
                        extent: undefined,
                    };
                }

                return {
                    ...node,
                    parentId: parentGroupId,
                    extent: undefined,
                    position: {
                        x: node.position.x - parentBounds.x,
                        y: node.position.y - parentBounds.y,
                    },
                };
            }

            const parentGroupId = getDirectParentGroupIdForNode(node.id, groups);
            const parentBounds = parentGroupId ? boundsMap.get(parentGroupId) : null;
            const parentGroup = parentGroupId ? groups.find((group) => group.id === parentGroupId) : null;

            if (!parentGroupId || !parentBounds || !parentGroup || parentGroup.collapsed || hiddenGroupIds.has(parentGroupId)) {
                return {
                    ...node,
                    parentId: undefined,
                    extent: undefined,
                };
            }

            return {
                ...node,
                parentId: parentGroupId,
                extent: undefined,
                position: {
                    x: node.position.x - parentBounds.x,
                    y: node.position.y - parentBounds.y,
                },
            };
        });

    const groupNodes = renderableNodes
        .filter((node) => node.type === FLOW_GROUP_NODE_TYPE)
        .sort((left, right) => getGroupDepth(left.id, groups) - getGroupDepth(right.id, groups));

    const contentNodes = renderableNodes.filter((node) => node.type !== FLOW_GROUP_NODE_TYPE);

    return [...groupNodes, ...contentNodes];
};

const stripDerivedGroupNodes = (allNodes: Node[]) => allNodes.filter((node) => node.type !== FLOW_GROUP_NODE_TYPE);

const buildGroupNodes = (
    groups: FlowGroup[],
    allNodes: Node[],
    allEdges: Edge[],
    selectedGroupIds: string[],
    highlightedGroupIds: string[],
    isConnecting: boolean,
    onSelectGroup: (groupId: string, event: React.MouseEvent) => void,
    onDragGroup: (groupId: string, nextClientX: number, nextClientY: number, prevClientX: number, prevClientY: number) => void,
): Node[] => {
    return [...groups]
        .sort((a, b) => getGroupDepth(a.id, groups) - getGroupDepth(b.id, groups))
        .map((group) => {
            const bounds = getGroupDisplayBounds(group, allNodes, groups);
            if (!bounds) return null;
            const selected = selectedGroupIds.includes(group.id);
            const highlighted = highlightedGroupIds.includes(group.id);
            const exitNode = allNodes.find((node) => node.id === inferGroupExitNodeId(group, groups, allEdges)) || null;
            const entryNodeId = inferGroupEntryNodeId(group, groups, allEdges);
            return {
                id: group.id,
                type: FLOW_GROUP_NODE_TYPE,
                position: { x: bounds.x, y: bounds.y },
                selected,
                draggable: true,
                selectable: true,
                focusable: true,
                deletable: true,
                connectable: true,
                zIndex: 100 + getGroupDepth(group.id, groups),
                data: {
                    groupId: group.id,
                    title: group.title,
                    description: group.description,
                    color: group.color,
                    highlighted,
                    collapsed: group.collapsed,
                    isConnecting,
                    proxy: {
                        showTarget: Boolean(entryNodeId),
                        sourceHandles: getNodeSourceHandles(exitNode),
                        width: bounds.width,
                        height: bounds.height,
                    },
                },
                style: {
                    width: bounds.width,
                    height: bounds.height,
                    opacity: 1,
                    background: "transparent",
                    zIndex: 100 + getGroupDepth(group.id, groups),
                },
            } as Node;
        })
        .filter((node): node is Node => Boolean(node));
};

const areHandleArraysEqual = (left: Array<string | undefined>, right: Array<string | undefined>) => {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
};

const areStringArraysEqual = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
};

type FlowGroupActionEventDetail = {
    button?: number;
    ctrlKey?: boolean;
    metaKey?: boolean;
    action?: "select" | "toggleCollapse" | "ungroup" | "rename" | "saveAsTemplate";
    groupId?: string;
    shiftKey?: boolean;
};

const getNodeContentBounds = (group: FlowGroup, allNodes: Node[], allGroups: FlowGroup[]) => {
    const groupNodeIds = new Set(getGroupNodeIdsDeep(group.id, allGroups));
    const memberNodes = allNodes.filter((node) => groupNodeIds.has(node.id));
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

const findGroupByFlowNodeId = (groups: FlowGroup[], nodeId?: string | null) => {
    if (!nodeId) return null;
    return groups.find((group) => group.id === nodeId) || null;
};

const getDisplayGroupPath = (
    endpointId: string | null | undefined,
    groups: FlowGroup[],
    getGroupNodeIdSet: (groupId: string) => Set<string>,
) => {
    if (!endpointId) return [] as string[];

    const endpointGroup = groups.find((group) => group.id === endpointId) || null;
    if (endpointGroup) {
        return [...getGroupAncestorIds(endpointGroup.id, groups).reverse(), endpointGroup.id];
    }

    return groups
        .filter((group) => getGroupNodeIdSet(group.id).has(endpointId))
        .sort((a, b) => getGroupDepth(a.id, groups) - getGroupDepth(b.id, groups))
        .map((group) => group.id);
};

const inferGroupEntryNodeId = (group: FlowGroup, groups: FlowGroup[], allEdges: Edge[]) => {
    const deepNodeIds = getGroupNodeIdsDeep(group.id, groups);
    if (group.entryNodeId && deepNodeIds.includes(group.entryNodeId)) {
        return group.entryNodeId;
    }

    const groupNodeIds = new Set(deepNodeIds);
    const internalTargets = new Set(
        allEdges
            .filter((edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target))
            .map((edge) => edge.target),
    );

    return deepNodeIds.find((nodeId) => !internalTargets.has(nodeId)) || deepNodeIds[0];
};

const inferGroupExitNodeId = (group: FlowGroup, groups: FlowGroup[], allEdges: Edge[]) => {
    const deepNodeIds = getGroupNodeIdsDeep(group.id, groups);
    if (group.exitNodeId && deepNodeIds.includes(group.exitNodeId)) {
        return group.exitNodeId;
    }

    const groupNodeIds = new Set(deepNodeIds);
    const internalSources = new Set(
        allEdges
            .filter((edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target))
            .map((edge) => edge.source),
    );

    return [...deepNodeIds].reverse().find((nodeId) => !internalSources.has(nodeId)) || deepNodeIds[deepNodeIds.length - 1];
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

const GROUP_SELECTION_ANCHOR_PREFIX = "group:";
const NODE_SELECTION_ANCHOR_PREFIX = "node:";

const createGroupSelectionAnchor = (groupId: string) => `${GROUP_SELECTION_ANCHOR_PREFIX}${groupId}`;
const createNodeSelectionAnchor = (nodeId: string) => `${NODE_SELECTION_ANCHOR_PREFIX}${nodeId}`;

const parseSelectionAnchor = (anchor: string | null) => {
    if (!anchor) return null;
    if (anchor.startsWith(GROUP_SELECTION_ANCHOR_PREFIX)) {
        return { type: "group" as const, id: anchor.slice(GROUP_SELECTION_ANCHOR_PREFIX.length) };
    }
    if (anchor.startsWith(NODE_SELECTION_ANCHOR_PREFIX)) {
        return { type: "node" as const, id: anchor.slice(NODE_SELECTION_ANCHOR_PREFIX.length) };
    }
    return { type: "node" as const, id: anchor };
};

const getGroupShiftSelectionNodeIds = (
    anchorGroupId: string,
    targetGroupId: string,
    groups: FlowGroup[],
    nodes: Node[],
    getGroupNodeIdSet: (groupId: string) => Set<string>,
) => {
    const anchorGroup = groups.find((group) => group.id === anchorGroupId) || null;
    const targetGroup = groups.find((group) => group.id === targetGroupId) || null;
    if (!anchorGroup || !targetGroup) return null;

    const anchorParentId = anchorGroup.parentGroupId || null;
    const targetParentId = targetGroup.parentGroupId || null;
    if (anchorParentId !== targetParentId) return null;

    const siblingGroups = groups
        .filter((group) => (group.parentGroupId || null) === anchorParentId)
        .sort((a, b) => {
            const aNodes = [...getGroupNodeIdSet(a.id)];
            const bNodes = [...getGroupNodeIdSet(b.id)];
            const aMinY = Math.min(...aNodes.map((nodeId) => nodes.find((node) => node.id === nodeId)?.position.y ?? Number.POSITIVE_INFINITY));
            const bMinY = Math.min(...bNodes.map((nodeId) => nodes.find((node) => node.id === nodeId)?.position.y ?? Number.POSITIVE_INFINITY));
            return aMinY - bMinY;
        });

    const anchorIndex = siblingGroups.findIndex((group) => group.id === anchorGroupId);
    const targetIndex = siblingGroups.findIndex((group) => group.id === targetGroupId);
    if (anchorIndex === -1 || targetIndex === -1) return null;

    const [startIndex, endIndex] = anchorIndex < targetIndex
        ? [anchorIndex, targetIndex]
        : [targetIndex, anchorIndex];

    const selectedGroupIds = siblingGroups.slice(startIndex, endIndex + 1).map((group) => group.id);
    const selectedNodeIds = new Set<string>();
    selectedGroupIds.forEach((groupId) => {
        getGroupNodeIdSet(groupId).forEach((nodeId) => selectedNodeIds.add(nodeId));
    });

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
    onSaveGroupAsTemplate?: (payload: {
        group: FlowGroup;
        nodes: Node[];
        edges: Edge[];
        groups: FlowGroup[];
    }) => void;
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
    onSaveGroupAsTemplate,
}: FlowCanvasProps) => {
    const isMobile = useIsMobile();
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const groupDragStartPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
    const draggingGroupIdRef = useRef<string | null>(null);
    const suppressFlowChangeRef = useRef(0);
    const rangeSelectionAnchorRef = useRef<string | null>(null);
    const suppressNextSelectionClearRef = useRef(false);
    const pendingCreatedGroupSelectionRef = useRef<string | null>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState(stripDerivedGroupNodes(initialNodes));
    const [edges, setEdges, onEdgesChange] = useEdgesState(sanitizeEdges(initialEdges, initialNodes, initialGroups));
    const [groups, setGroups] = useState<FlowGroup[]>(initialGroups);
    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
    const [showMinimap, setShowMinimap] = useState(false);
    const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
    const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
    const [editingNode, setEditingNode] = useState<Node | null>(null);
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
    const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
    const [groupDraftTitle, setGroupDraftTitle] = useState("");
    const [isRenamingGroup, setIsRenamingGroup] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const latestSelectionRef = useRef<{
        nodeIds: string[];
        edgeIds: string[];
        groupIds: string[];
        groupId: string | null;
    }>({
        nodeIds: [],
        edgeIds: [],
        groupIds: [],
        groupId: null,
    });
    const onFlowNodesChange = useCallback(
        (changes: NodeChange<Node>[]) => {
            const removedGroupIds = changes
                .filter((change): change is Extract<NodeChange<Node>, { type: "remove" }> => change.type === "remove")
                .map((change) => change.id)
                .filter((groupId) => groups.some((group) => group.id === groupId));

            if (removedGroupIds.length > 0) {
                const descendantGroupIds = new Set<string>();
                const removedNodeIds = new Set<string>();

                removedGroupIds.forEach((groupId) => {
                    descendantGroupIds.add(groupId);
                    getGroupDescendantGroupIds(groupId, groups).forEach((descendantGroupId) => {
                        descendantGroupIds.add(descendantGroupId);
                    });
                    getGroupNodeIdsDeep(groupId, groups).forEach((nodeId) => {
                        removedNodeIds.add(nodeId);
                    });
                });

                if (removedNodeIds.size > 0) {
                    setNodes((currentNodes) => currentNodes.filter((node) => !removedNodeIds.has(node.id)));
                    setEdges((currentEdges) => currentEdges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)));
                }

                setGroups((currentGroups) => currentGroups.filter((group) => !descendantGroupIds.has(group.id)));
                setSelectedGroupId((currentGroupId) => (currentGroupId && descendantGroupIds.has(currentGroupId) ? null : currentGroupId));
                setSelectedGroupIds((currentGroupIds) => currentGroupIds.filter((groupId) => !descendantGroupIds.has(groupId)));
                setSelectedNodes((currentNodeIds) => currentNodeIds.filter((nodeId) => !removedNodeIds.has(nodeId)));
                setSelectedEdges((currentEdgeIds) => currentEdgeIds.filter((edgeId) => !changes.some((change) => change.type === "remove" && change.id === edgeId)));
                setGroupDraftTitle("");
                setIsRenamingGroup(false);
            }

            const filteredChanges = changes.filter((change) => {
                if (change.type !== "position" && change.type !== "dimensions") {
                    return !("id" in change && groups.some((group) => group.id === change.id));
                }

                return !groups.some((group) => group.id === change.id);
            });

            if (filteredChanges.length === 0) return;

            setNodes((currentNodes) => {
                const boundsMap = buildGroupBoundsMap(groups, currentNodes);
                const normalizedChanges = filteredChanges.map((change) => {
                    if (change.type !== "position" || !change.position) {
                        return change;
                    }

                    const parentGroupId = getDirectParentGroupIdForNode(change.id, groups);
                    if (!parentGroupId) {
                        return change;
                    }

                    const parentGroup = groups.find((group) => group.id === parentGroupId) || null;
                    const parentBounds = boundsMap.get(parentGroupId);
                    if (!parentGroup || parentGroup.collapsed || !parentBounds) {
                        return change;
                    }

                    return {
                        ...change,
                        position: {
                            x: change.position.x + parentBounds.x,
                            y: change.position.y + parentBounds.y,
                        },
                    };
                });

                return applyNodeChanges(normalizedChanges, currentNodes);
            });
        },
        [groups, setEdges, setNodes],
    );
    const contentNodes = useMemo(() => stripDerivedGroupNodes(nodes), [nodes]);
    const groupNodeIdsMap = useMemo(
        () => new Map(groups.map((group) => [group.id, new Set(getGroupNodeIdsDeep(group.id, groups))])),
        [groups],
    );
    const getGroupNodeIdSet = useCallback(
        (groupId: string) => groupNodeIdsMap.get(groupId) || new Set<string>(),
        [groupNodeIdsMap],
    );
    const getGroupById = useCallback(
        (groupId: string) => groups.find((group) => group.id === groupId) || null,
        [groups],
    );
    const getIntersectedGroupIds = useCallback(
        (nodeIds: Iterable<string>) => {
            const selectedNodeIdSet = new Set(nodeIds);
            return groups
                .filter((group) => {
                    const groupNodeIds = getGroupNodeIdSet(group.id);
                    return groupNodeIds.size > 0 && [...groupNodeIds].some((nodeId) => selectedNodeIdSet.has(nodeId));
                })
                .map((group) => group.id);
        },
        [getGroupNodeIdSet, groups],
    );
    const highlightedGroupIds = useMemo(
        () => Array.from(new Set([...selectedGroupIds, ...getIntersectedGroupIds(selectedNodes)])),
        [getIntersectedGroupIds, selectedGroupIds, selectedNodes],
    );
    const selectedStandaloneNodeIds = useMemo(() => {
        const nodeIdsCoveredBySelectedGroups = new Set<string>();
        selectedGroupIds.forEach((groupId) => {
            getGroupNodeIdSet(groupId).forEach((nodeId) => nodeIdsCoveredBySelectedGroups.add(nodeId));
        });

        return selectedNodes.filter((nodeId) => !nodeIdsCoveredBySelectedGroups.has(nodeId));
    }, [getGroupNodeIdSet, selectedGroupIds, selectedNodes]);
    const groupableSelectionCount = selectedGroupIds.length + selectedStandaloneNodeIds.length;
    const expandNodeIdsWithGroups = useCallback(
        (nodeIds: Iterable<string>) => {
            const expandedNodeIdSet = new Set(nodeIds);
            const groupIds = getIntersectedGroupIds(expandedNodeIdSet);
            groupIds.forEach((groupId) => {
                getGroupNodeIdSet(groupId).forEach((nodeId) => expandedNodeIdSet.add(nodeId));
            });
            return [...expandedNodeIdSet];
        },
        [getGroupNodeIdSet, getIntersectedGroupIds],
    );

    const cloneGroupsWithIdMap = useCallback((sourceGroups: FlowGroup[], idMap: Map<string, string>) => {
        const groupIdMap = new Map<string, string>();
        sourceGroups.forEach((group) => {
            groupIdMap.set(
                group.id,
                createGroup({
                    title: group.title,
                    nodeIds: [],
                    parentGroupId: undefined,
                    description: group.description,
                    color: group.color,
                }).id,
            );
        });

        return sourceGroups
            .map((group) => ({
                ...group,
                id: groupIdMap.get(group.id) || group.id,
                parentGroupId: group.parentGroupId ? groupIdMap.get(group.parentGroupId) : undefined,
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
        setEdges((eds) => sanitizeEdges([...eds.map((edge) => ({ ...edge, selected: false })), ...newEdges], [...nodes, ...newNodes], [...groups, ...newGroups]));
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

    useEffect(() => {
        setEdges((eds) => eds.map((edge) => ({ ...edge, animated: isRunning })));
    }, [isRunning, setEdges]);

    useEffect(() => {
        suppressFlowChangeRef.current += 1;
        setNodes(stripDerivedGroupNodes(initialNodes));
    }, [initialNodes, setNodes]);

    useEffect(() => {
        suppressFlowChangeRef.current += 1;
        setEdges(sanitizeEdges(initialEdges, initialNodes, initialGroups));
    }, [initialEdges, initialGroups, initialNodes, setEdges]);

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

    useEffect(() => {
        latestSelectionRef.current = {
            nodeIds: selectedNodes,
            edgeIds: selectedEdges,
            groupIds: selectedGroupIds,
            groupId: selectedGroupId,
        };
    }, [selectedEdges, selectedGroupId, selectedGroupIds, selectedNodes]);

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
            setNodes(stripDerivedGroupNodes(newNodes));
            setEdges(sanitizeEdges(newEdges, newNodes, newGroups));
            setGroups(newGroups);
        });
    }, [onResetRef, setEdges, setNodes]);

    const onConnect = useCallback(
        (params: Connection) => {
            const sourceGroup = findGroupByFlowNodeId(groups, params.source);
            const targetGroup = findGroupByFlowNodeId(groups, params.target);

            let source = params.source || "";
            let target = params.target || "";
            let sourceHandle = params.sourceHandle;
            let targetHandle = params.targetHandle;

            if (sourceGroup) {
                const exitNodeId = inferGroupExitNodeId(sourceGroup, groups, edges);
                if (!exitNodeId) {
                    toast.error("该分组没有可用的输出节点");
                    return;
                }
                const exitNode = contentNodes.find((node) => node.id === exitNodeId) || null;
                source = exitNodeId;
                sourceHandle = sourceHandle ?? getPrimarySourceHandle(exitNode);
            }

            if (targetGroup) {
                const entryNodeId = inferGroupEntryNodeId(targetGroup, groups, edges);
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
                sourceHandle: normalizeSourceHandle(source, sourceHandle, contentNodes, groups, edges),
                target,
                targetHandle: undefined,
                data: {
                    condition:
                        sourceHandle === "true"
                            ? "true"
                            : sourceHandle === "false"
                                ? "false"
                                : undefined,
                },
            };
            setEdges((eds) => sanitizeEdges(addEdge(edge, eds), contentNodes, groups));
        },
        [contentNodes, edges, groups, setEdges],
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
            const isSelectionEmpty = selectedNodeItems.length === 0 && selectedEdgeItems.length === 0;

            if (pendingCreatedGroupSelectionRef.current) {
                const pendingGroupId = pendingCreatedGroupSelectionRef.current;
                const selectedIds = new Set(selectedNodeItems.map((node) => node.id));

                if (isSelectionEmpty) {
                    return;
                }

                if (!selectedIds.has(pendingGroupId)) {
                    return;
                }

                pendingCreatedGroupSelectionRef.current = null;
            }

            if (suppressNextSelectionClearRef.current && isSelectionEmpty) {
                suppressNextSelectionClearRef.current = false;
                return;
            }

            if (isSelectionEmpty) {
                rangeSelectionAnchorRef.current = null;
                setSelectedNodes([]);
                setSelectedEdges([]);
                setSelectedGroupIds([]);
                setSelectedGroupId(null);
                setIsRenamingGroup(false);
                return;
            }

            const selectedGroupNodeIds = selectedNodeItems
                .map((node) => node.id)
                .filter((nodeId) => groups.some((group) => group.id === nodeId));
            const selectedContentNodeIds = selectedNodeItems
                .map((node) => node.id)
                .filter((nodeId) => !selectedGroupNodeIds.includes(nodeId));
            const nextSelectedEdgeIds = selectedEdgeItems.map((edge) => edge.id);
            const nextSelectedGroupId = selectedGroupNodeIds.length === 1 ? selectedGroupNodeIds[0] : null;

            if (
                areStringArraysEqual(latestSelectionRef.current.nodeIds, selectedContentNodeIds)
                && areStringArraysEqual(latestSelectionRef.current.edgeIds, nextSelectedEdgeIds)
                && areStringArraysEqual(latestSelectionRef.current.groupIds, selectedGroupNodeIds)
                && latestSelectionRef.current.groupId === nextSelectedGroupId
            ) {
                return;
            }

            setSelectedNodes(selectedContentNodeIds);
            setSelectedEdges(nextSelectedEdgeIds);
            setSelectedGroupIds(selectedGroupNodeIds);
            setSelectedGroupId(nextSelectedGroupId);

            if (selectedContentNodeIds.length === 1 && selectedGroupNodeIds.length === 0) {
                rangeSelectionAnchorRef.current = createNodeSelectionAnchor(selectedContentNodeIds[0]);
            } else if (selectedGroupNodeIds.length === 1 && selectedContentNodeIds.length === 0) {
                rangeSelectionAnchorRef.current = createGroupSelectionAnchor(selectedGroupNodeIds[0]);
                setGroupDraftTitle(groups.find((group) => group.id === selectedGroupNodeIds[0])?.title || "");
                setIsRenamingGroup(false);
            }

            if ((selectedContentNodeIds.length > 0 || selectedEdgeItems.length > 0) && selectedGroupNodeIds.length === 0) {
                setSelectedGroupId(null);
                setSelectedGroupIds([]);
                setIsRenamingGroup(false);
            }
        },
        [groups],
    );

    const handleGroupSelect = useCallback(
        (groupId: string, event: React.MouseEvent) => {
            if (readOnly) return;

            const isModKey = event.metaKey || event.ctrlKey;
            suppressNextSelectionClearRef.current = true;

            if (isModKey) {
                const nextSelectedGroupIds = selectedGroupIds.includes(groupId)
                    ? selectedGroupIds.filter((id) => id !== groupId)
                    : [...selectedGroupIds, groupId];
                const nextSelectedNodeIds = selectedNodes.filter((nodeId) => !getIntersectedGroupIds([nodeId]).includes(groupId));
                const nextSelectedNodeIdSet = new Set(nextSelectedNodeIds);
                const nextSelectedEdgeIds = edges
                    .filter((edge) => nextSelectedNodeIdSet.has(edge.source) && nextSelectedNodeIdSet.has(edge.target))
                    .map((edge) => edge.id);

                setEdges((prev) =>
                    prev.map((edgeItem) => ({
                        ...edgeItem,
                        selected: nextSelectedEdgeIds.includes(edgeItem.id),
                    })),
                );
                setSelectedGroupIds(nextSelectedGroupIds);
                setSelectedGroupId(nextSelectedGroupIds.length === 1 ? nextSelectedGroupIds[0] : null);
                setSelectedNodes(nextSelectedNodeIds);
                setSelectedEdges(nextSelectedEdgeIds);
                setGroupDraftTitle(nextSelectedGroupIds.length === 1 ? groups.find((group) => group.id === nextSelectedGroupIds[0])?.title || "" : "");
                setIsRenamingGroup(false);
                rangeSelectionAnchorRef.current = createGroupSelectionAnchor(groupId);
                return;
            }

            const anchor = parseSelectionAnchor(rangeSelectionAnchorRef.current);
            if (!event.shiftKey || !anchor || anchor.type !== "group" || anchor.id === groupId) {
                rangeSelectionAnchorRef.current = createGroupSelectionAnchor(groupId);
                setSelectedGroupId(groupId);
                setSelectedGroupIds([groupId]);
                setEdges((prev) => prev.map((edgeItem) => ({ ...edgeItem, selected: false })));
                setSelectedNodes([]);
                setSelectedEdges([]);
                setGroupDraftTitle(groups.find((group) => group.id === groupId)?.title || "");
                setIsRenamingGroup(false);
                return;
            }

            const selectedRangeNodeIds = getGroupShiftSelectionNodeIds(
                anchor.id,
                groupId,
                groups,
                contentNodes,
                getGroupNodeIdSet,
            );

            if (!selectedRangeNodeIds || selectedRangeNodeIds.length === 0) {
                rangeSelectionAnchorRef.current = createGroupSelectionAnchor(groupId);
                setSelectedGroupId(groupId);
                setSelectedGroupIds([groupId]);
                setEdges((prev) => prev.map((edgeItem) => ({ ...edgeItem, selected: false })));
                setSelectedNodes([]);
                setSelectedEdges([]);
                setGroupDraftTitle(groups.find((group) => group.id === groupId)?.title || "");
                setIsRenamingGroup(false);
                return;
            }

            const expandedSelection = expandNodeIdsWithGroups(selectedRangeNodeIds);
            const selectedNodeIdSet = new Set(expandedSelection);
            const nextSelectedGroupIds = groups.filter((group) => [...getGroupNodeIdSet(group.id)].some((nodeId) => selectedNodeIdSet.has(nodeId))).map((group) => group.id);

            setEdges((prev) => prev.map((edgeItem) => ({ ...edgeItem, selected: false })));
            setSelectedNodes([]);
            setSelectedEdges([]);
            setSelectedGroupId(null);
            setSelectedGroupIds(nextSelectedGroupIds);
            setIsRenamingGroup(false);
        },
        [contentNodes, edges, expandNodeIdsWithGroups, getGroupNodeIdSet, getIntersectedGroupIds, groups, readOnly, selectedGroupIds, selectedNodes, setEdges, setNodes],
    );

    const handleNodeClick = useCallback(
        (event: React.MouseEvent, node: Node) => {
            if (readOnly) return;
            const clickedGroup = groups.find((group) => group.id === node.id) || null;
            if (clickedGroup) {
                handleGroupSelect(clickedGroup.id, event);
                return;
            }

            const anchor = parseSelectionAnchor(rangeSelectionAnchorRef.current);
            const anchorNodeId = anchor?.type === "node" ? anchor.id : null;
            if (!event.shiftKey || !anchorNodeId || anchorNodeId === node.id) {
                rangeSelectionAnchorRef.current = createNodeSelectionAnchor(node.id);

                if (!event.metaKey && !event.ctrlKey) {
                    setSelectedGroupId(null);
                    setSelectedGroupIds([]);
                    setSelectedEdges([]);
                    setGroupDraftTitle("");
                    setIsRenamingGroup(false);
                }

                return;
            }

            const forwardSelection = findBranchRangeNodeIds(anchorNodeId, node.id, edges);
            const backwardSelection = findBranchRangeNodeIds(node.id, anchorNodeId, edges);
            const pathNodeIds = forwardSelection || backwardSelection;

            if (!pathNodeIds || pathNodeIds.length < 2) {
                rangeSelectionAnchorRef.current = createNodeSelectionAnchor(node.id);
                return;
            }

            const expandedSelection = expandNodeIdsWithGroups(pathNodeIds);
            const selectedNodeIdSet = new Set(expandedSelection);
            const nextSelectedGroupIds = groups.filter((group) => [...getGroupNodeIdSet(group.id)].some((nodeId) => selectedNodeIdSet.has(nodeId))).map((group) => group.id);
            const selectedFlowNodeIdSet = new Set([...expandedSelection, ...nextSelectedGroupIds]);
            const selectedEdgeIdSet = new Set(
                edges
                    .filter((edge) => selectedNodeIdSet.has(edge.source) && selectedNodeIdSet.has(edge.target))
                    .map((edge) => edge.id),
            );

            setNodes((prev) =>
                prev.map((currentNode) =>
                    ({ ...currentNode, selected: selectedFlowNodeIdSet.has(currentNode.id) })
                ),
            );
            setEdges((prev) =>
                prev.map((edgeItem) => ({
                    ...edgeItem,
                    selected: selectedEdgeIdSet.has(edgeItem.id),
                })),
            );
            setSelectedNodes(expandedSelection);
            setSelectedEdges([...selectedEdgeIdSet]);
            setSelectedGroupId(null);
            setSelectedGroupIds(nextSelectedGroupIds);
        },
        [edges, expandNodeIdsWithGroups, getGroupNodeIdSet, groups, handleGroupSelect, readOnly, selectedGroupIds, selectedNodes, setEdges, setNodes],
    );

    const deleteSelected = useCallback(() => {
        if (readOnly) return;

        let remainingNodes = contentNodes;
        const selectedGroup = groups.find((group) => group.id === selectedGroupId) || null;

        if (selectedGroup) {
            const descendantGroupIds = new Set([selectedGroup.id, ...getGroupDescendantGroupIds(selectedGroup.id, groups)]);
            const groupNodeIds = getGroupNodeIdSet(selectedGroup.id);
            remainingNodes = contentNodes.filter((node) => !groupNodeIds.has(node.id));
            setNodes((prev) => prev.filter((node) => !groupNodeIds.has(node.id)));
            setEdges((eds) => eds.filter((edge) => !groupNodeIds.has(edge.source) && !groupNodeIds.has(edge.target)));
            setGroups((prev) => prev.filter((group) => !descendantGroupIds.has(group.id)));
            setSelectedGroupId(null);
            setSelectedGroupIds([]);
            setGroupDraftTitle("");
            setIsRenamingGroup(false);
            setSelectedNodes([]);
            setSelectedEdges([]);
            return;
        }

        if (selectedNodes.length > 0) {
            remainingNodes = contentNodes.filter((node) => !selectedNodes.includes(node.id));
            setNodes((prev) => prev.filter((node) => !selectedNodes.includes(node.id)));
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
        setSelectedGroupIds([]);
        setIsRenamingGroup(false);
    }, [contentNodes, groups, readOnly, selectedEdges, selectedGroupId, selectedNodes, setEdges, setNodes]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            console.log("Key down event:", event.key);
            if (readOnly) return;

            const target = event.target as HTMLElement;
            if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
            const isWithinCanvas = Boolean(reactFlowWrapper.current?.contains(target)) || target === document.body;
            if (!isWithinCanvas) return;

            // React Flow already handles Backspace/Delete for deleting selected nodes/edges. This doesn't work well with our custom group nodes.
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
                    ? contentNodes.filter((node) => getGroupNodeIdSet(selectedGroup.id).has(node.id))
                    : contentNodes.filter((node) => node.selected);
                if (currentSelectedNodes.length === 0) return;
                event.preventDefault();
                const selectedIds = new Set(currentSelectedNodes.map((node) => node.id));
                clipboardNodes = currentSelectedNodes.map((node) => ({ ...node }));
                clipboardEdges = edges.filter(
                    (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target),
                );
                clipboardGroups = selectedGroup
                    ? groups
                        .filter((group) => group.id === selectedGroup.id || getGroupAncestorIds(group.id, groups).includes(selectedGroup.id))
                        .map((group) => ({
                            ...group,
                            nodeIds: group.nodeIds.filter((nodeId) => selectedIds.has(nodeId)),
                        }))
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
        if (readOnly || groupableSelectionCount < 2) return;

        const selectedGroupIdSet = new Set(selectedGroupIds);
        const standaloneNodeIdSet = new Set(selectedStandaloneNodeIds);
        const selectedParentGroupIds = new Set<string | undefined>([
            ...selectedGroupIds.map((groupId) => groups.find((group) => group.id === groupId)?.parentGroupId),
            ...selectedStandaloneNodeIds.map((nodeId) => getDirectParentGroupIdForNode(nodeId, groups)),
        ]);

        if (selectedParentGroupIds.size !== 1) {
            toast.error("只能对同一父级下的节点/分组进行嵌套分组");
            return;
        }

        const [parentGroupId] = [...selectedParentGroupIds];

        const next = createGroup({
            title: `分组 ${groups.length + 1}`,
            nodeIds: selectedStandaloneNodeIds,
            parentGroupId,
        });
        setGroups((prev) =>
            sanitizeGroups(
                [
                    ...prev.map((group) =>
                        group.id === parentGroupId
                            ? {
                                ...group,
                                nodeIds: group.nodeIds.filter((nodeId) => !standaloneNodeIdSet.has(nodeId)),
                            }
                            : selectedGroupIdSet.has(group.id)
                                ? {
                                    ...group,
                                    parentGroupId: next.id,
                                }
                                : group,
                    ),
                    next,
                ],
                new Set(contentNodes.map((node) => node.id)),
            ),
        );
        pendingCreatedGroupSelectionRef.current = next.id;
        setNodes((prev) => prev.map((node) => ({ ...node, selected: false })));
        setEdges((prev) => prev.map((edge) => ({ ...edge, selected: false })));
        setSelectedGroupId(next.id);
        setSelectedGroupIds([next.id]);
        setSelectedNodes([]);
        setSelectedEdges([]);
        setGroupDraftTitle(next.title);
        setIsRenamingGroup(false);
        rangeSelectionAnchorRef.current = createGroupSelectionAnchor(next.id);
        toast.success("已创建分组");
    }, [contentNodes, groupableSelectionCount, groups, readOnly, selectedGroupIds, selectedStandaloneNodeIds]);

    const handleUngroup = useCallback(
        (groupId: string) => {
            const targetGroup = groups.find((group) => group.id === groupId);
            if (!targetGroup) return;

            const currentBounds = getGroupDisplayBounds(targetGroup, contentNodes, groups);
            const directChildren = groups.filter((group) => group.parentGroupId === groupId);
            const targetParentId = targetGroup.parentGroupId;
            const releasedContentBounds = getGroupContentDisplayBounds(targetGroup, contentNodes, groups);
            const nextGroups = groups
                .filter((group) => group.id !== groupId)
                .map((group) =>
                    group.parentGroupId === groupId
                        ? { ...group, parentGroupId: targetParentId }
                        : group,
                );

            setGroups(nextGroups);

            const groupNodeIdSet = getGroupNodeIdSet(targetGroup.id);
            const downstreamStartNodeIds = edges
                .filter((edge) => groupNodeIdSet.has(edge.source) && !groupNodeIdSet.has(edge.target))
                .map((edge) => edge.target);

            if (currentBounds && releasedContentBounds && downstreamStartNodeIds.length > 0) {
                const currentBottom = currentBounds.y + currentBounds.height;
                const nextBottom = releasedContentBounds.maxY;
                const deltaY = nextBottom - currentBottom;

                if (deltaY !== 0) {
                    const downstreamNodeIds = collectDownstreamNodeIds(downstreamStartNodeIds, edges, groupNodeIdSet);

                    if (downstreamNodeIds.size > 0) {
                        setNodes((prev) =>
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
                        );
                    }
                }
            }

            const nextSelectedGroupId = selectedGroupId === groupId ? targetParentId || directChildren[0]?.id || null : selectedGroupId;
            pendingCreatedGroupSelectionRef.current = nextSelectedGroupId;
            setNodes((prev) => prev.map((node) => ({ ...node, selected: false })));
            setEdges((prev) => prev.map((edge) => ({ ...edge, selected: false })));
            setSelectedNodes([]);
            setSelectedEdges([]);

            if (selectedGroupId === groupId) {
                setSelectedGroupId(nextSelectedGroupId);
                setSelectedGroupIds(nextSelectedGroupId ? [nextSelectedGroupId] : []);
                setGroupDraftTitle((targetParentId && getGroupById(targetParentId)?.title) || directChildren[0]?.title || "");
                setIsRenamingGroup(false);
                rangeSelectionAnchorRef.current = nextSelectedGroupId ? createGroupSelectionAnchor(nextSelectedGroupId) : null;
            }
            toast.success("已解组");
        },
        [contentNodes, edges, getGroupById, getGroupNodeIdSet, groups, selectedGroupId, setEdges, setNodes],
    );

    const handleToggleGroupCollapse = useCallback((groupId: string) => {
        const targetGroup = groups.find((group) => group.id === groupId);
        if (!targetGroup) return;

        const currentBounds = getGroupDisplayBounds(targetGroup, contentNodes, groups);
        const nextGroup = { ...targetGroup, collapsed: !targetGroup.collapsed };
        const nextBounds = getGroupDisplayBounds(nextGroup, contentNodes, groups);

        setGroups((prev) =>
            prev.map((group) =>
                group.id === groupId ? { ...group, collapsed: !group.collapsed } : group,
            ),
        );

        if (!currentBounds || !nextBounds) return;

        const deltaY = nextBounds.height - currentBounds.height;
        if (deltaY === 0) return;

        const groupNodeIdSet = getGroupNodeIdSet(targetGroup.id);
        const downstreamStartNodeIds = edges
            .filter((edge) => groupNodeIdSet.has(edge.source) && !groupNodeIdSet.has(edge.target))
            .map((edge) => edge.target);

        if (downstreamStartNodeIds.length === 0) return;

        const downstreamNodeIds = collectDownstreamNodeIds(downstreamStartNodeIds, edges, groupNodeIdSet);
        if (downstreamNodeIds.size === 0) return;

        setNodes((prev) =>
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
        );
    }, [contentNodes, edges, getGroupNodeIdSet, groups, setNodes]);

    useEffect(() => {
        const handleGroupAction = (event: Event) => {
            const customEvent = event as CustomEvent<FlowGroupActionEventDetail>;
            const action = customEvent.detail?.action;
            const groupId = customEvent.detail?.groupId;
            if (!groupId || readOnly) return;

            if (action === "select") {
                handleGroupSelect(groupId, {
                    button: customEvent.detail?.button ?? 0,
                    ctrlKey: Boolean(customEvent.detail?.ctrlKey),
                    metaKey: Boolean(customEvent.detail?.metaKey),
                    shiftKey: Boolean(customEvent.detail?.shiftKey),
                    preventDefault: () => { },
                    stopPropagation: () => { },
                } as React.MouseEvent);
                return;
            }

            if (action === "toggleCollapse") {
                handleToggleGroupCollapse(groupId);
                return;
            }

            if (action === "ungroup") {
                handleUngroup(groupId);
                return;
            }

            if (action === "rename") {
                const targetGroup = groups.find((group) => group.id === groupId);
                if (!targetGroup) return;
                setSelectedGroupId(groupId);
                setSelectedGroupIds([groupId]);
                setSelectedNodes([]);
                setSelectedEdges([]);
                setGroupDraftTitle(targetGroup.title || "");
                setIsRenamingGroup(true);
                return;
            }

            if (action === "saveAsTemplate") {
                const targetGroup = groups.find((group) => group.id === groupId);
                if (!targetGroup) return;

                const groupNodeIds = new Set(getGroupNodeIdsDeep(groupId, groups));
                const descendantGroupIds = new Set([groupId, ...getGroupDescendantGroupIds(groupId, groups)]);
                const templateNodes = contentNodes
                    .filter((node) => groupNodeIds.has(node.id))
                    .map((node) => ({
                        ...node,
                        selected: false,
                    }));
                const templateEdges = edges
                    .filter((edge) => groupNodeIds.has(edge.source) && groupNodeIds.has(edge.target))
                    .map((edge) => ({
                        ...edge,
                        selected: false,
                    }));
                const templateGroups = groups
                    .filter((group) => descendantGroupIds.has(group.id))
                    .map((group) => ({ ...group }));

                onSaveGroupAsTemplate?.({
                    group: { ...targetGroup },
                    nodes: templateNodes,
                    edges: templateEdges,
                    groups: templateGroups,
                });
            }
        };

        window.addEventListener("flow-group-action", handleGroupAction as EventListener);
        return () => {
            window.removeEventListener("flow-group-action", handleGroupAction as EventListener);
        };
    }, [contentNodes, edges, getGroupNodeIdSet, groups, handleGroupSelect, handleToggleGroupCollapse, handleUngroup, onSaveGroupAsTemplate, readOnly]);

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

            const nodeIdSet = getGroupNodeIdSet(targetGroup.id);
            setNodes((prev) =>
                prev.map((node) =>
                    nodeIdSet.has(node.id)
                        ? {
                            ...node,
                            position: {
                                x: node.position.x + deltaX,
                                y: node.position.y + deltaY,
                            },
                        }
                        : node,
                ),
            );
        },
        [edges, getGroupNodeIdSet, groups, readOnly, reactFlowInstance, setNodes],
    );

    const onGroupNodeDragStart = useCallback((_: React.MouseEvent, node: Node) => {
        if (node.type !== FLOW_GROUP_NODE_TYPE) return;
        draggingGroupIdRef.current = node.id;
        groupDragStartPositionsRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
        });
    }, []);

    const onGroupNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
        if (readOnly || node.type !== FLOW_GROUP_NODE_TYPE) return;

        const startPosition = groupDragStartPositionsRef.current.get(node.id);
        groupDragStartPositionsRef.current.delete(node.id);
        if (!startPosition) return;

        const deltaX = node.position.x - startPosition.x;
        const deltaY = node.position.y - startPosition.y;
        if (deltaX === 0 && deltaY === 0) return;

        const targetGroup = groups.find((group) => group.id === node.id);
        if (!targetGroup) return;

        const nodeIdSet = getGroupNodeIdSet(targetGroup.id);
        if (nodeIdSet.size === 0) return;

        setNodes((prev) =>
            prev.map((currentNode) =>
                nodeIdSet.has(currentNode.id)
                    ? {
                        ...currentNode,
                        position: {
                            x: currentNode.position.x + deltaX,
                            y: currentNode.position.y + deltaY,
                        },
                    }
                    : currentNode,
            ),
        );

        draggingGroupIdRef.current = null;
    }, [getGroupNodeIdSet, groups, readOnly, setNodes]);

    const collapsedGroupByNodeId = useMemo(() => {
        const nextMap = new Map<string, FlowGroup>();
        [...groups]
            .sort((a, b) => getGroupDepth(a.id, groups) - getGroupDepth(b.id, groups))
            .forEach((group) => {
                if (!group.collapsed) return;
                getGroupNodeIdSet(group.id).forEach((nodeId) => {
                    nextMap.set(nodeId, group);
                });
            });

        return nextMap;
    }, [getGroupNodeIdSet, groups]);

    const collapsedGroupIds = useMemo(
        () => new Set(groups.filter((group) => group.collapsed).map((group) => group.id)),
        [groups],
    );

    const hiddenNodeIds = useMemo(() => new Set(collapsedGroupByNodeId.keys()), [collapsedGroupByNodeId]);
    const hiddenGroupIds = useMemo(
        () => new Set(
            groups
                .filter((group) => getGroupAncestorIds(group.id, groups).some((ancestorId) => collapsedGroupIds.has(ancestorId)))
                .map((group) => group.id),
        ),
        [collapsedGroupIds, groups],
    );
    const minimalGroupTestNode = useMemo<Node>(
        () => ({
            id: MINIMAL_GROUP_TEST_NODE_ID,
            type: MINIMAL_GROUP_TEST_NODE_TYPE,
            position: { x: 80, y: 80 },
            draggable: true,
            selectable: true,
            focusable: true,
            data: {
                title: "Minimal Group Test",
            },
        }),
        [],
    );
    const visibleNodes = useMemo(() => {
        const contentVisibleNodes = buildRenderableNodes(contentNodes, groups, hiddenNodeIds, hiddenGroupIds);
        const derivedGroupNodes = buildGroupNodes(
            groups,
            contentNodes,
            edges,
            selectedGroupIds,
            highlightedGroupIds,
            isConnecting,
            handleGroupSelect,
            handleDragGroup,
        );
        const nextVisibleNodes = buildRenderableNodes(
            [...contentVisibleNodes.filter((node) => node.type !== FLOW_GROUP_NODE_TYPE), ...derivedGroupNodes],
            groups,
            hiddenNodeIds,
            hiddenGroupIds,
        );

        // if (!nextVisibleNodes.some((node) => node.id === MINIMAL_GROUP_TEST_NODE_ID)) {
        //     nextVisibleNodes.push(minimalGroupTestNode);
        // }

        return nextVisibleNodes;
    }, [contentNodes, edges, groups, handleDragGroup, handleGroupSelect, hiddenGroupIds, hiddenNodeIds, highlightedGroupIds, isConnecting, minimalGroupTestNode, selectedGroupIds]);
    const visibleEdges = useMemo<Edge[]>(() => (
        edges
            .map<Edge | null>((edge) => {
                const sourceCollapsedGroup = collapsedGroupByNodeId.get(edge.source);
                const targetCollapsedGroup = collapsedGroupByNodeId.get(edge.target);

                if (sourceCollapsedGroup && targetCollapsedGroup) {
                    if (sourceCollapsedGroup.id === targetCollapsedGroup.id) {
                        return null;
                    }
                }

                const sourcePath = getDisplayGroupPath(edge.source, groups, getGroupNodeIdSet);
                const targetPath = getDisplayGroupPath(edge.target, groups, getGroupNodeIdSet);

                let sharedDepth = 0;
                while (
                    sharedDepth < sourcePath.length
                    && sharedDepth < targetPath.length
                    && sourcePath[sharedDepth] === targetPath[sharedDepth]
                ) {
                    sharedDepth += 1;
                }

                const sourceGroupId = sourcePath[sharedDepth];
                const targetGroupId = targetPath[sharedDepth];

                const displaySourceId = sourceCollapsedGroup?.id || sourceGroupId || edge.source;
                const displayTargetId = targetCollapsedGroup?.id || targetGroupId || edge.target;

                if (displaySourceId === displayTargetId) {
                    return null;
                }

                return {
                    ...edge,
                    source: displaySourceId,
                    sourceHandle: edge.sourceHandle,
                    target: displayTargetId,
                    targetHandle: displayTargetId !== edge.target ? GROUP_TARGET_HANDLE_ID : edge.targetHandle,
                };
            })
            .filter((edge): edge is Edge => edge !== null)
    ), [collapsedGroupByNodeId, edges, getGroupNodeIdSet, groups]);

    const handleGroupTitleSave = useCallback(() => {
        if (!selectedGroupId) return;
        const title = groupDraftTitle.trim();
        if (!title) return;
        setGroups((prev) => prev.map((group) => (group.id === selectedGroupId ? { ...group, title } : group)));
        setIsRenamingGroup(false);
    }, [groupDraftTitle, selectedGroupId]);

    const tidyUp = useCallback(() => {
        const graph = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
        graph.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

        const collapsedGroups = groups.filter((group) => group.collapsed);
        const collapsedGroupByNodeId = new Map<string, FlowGroup>();
        [...collapsedGroups]
            .sort((a, b) => getGroupDepth(a.id, groups) - getGroupDepth(b.id, groups))
            .forEach((group) => {
                getGroupNodeIdSet(group.id).forEach((nodeId) => {
                    collapsedGroupByNodeId.set(nodeId, group);
                });
            });

        const getLayoutNodeId = (nodeId: string) => {
            const collapsedGroup = collapsedGroupByNodeId.get(nodeId);
            return collapsedGroup ? collapsedGroup.id : nodeId;
        };

        const collapsedGroupBounds = new Map<string, ReturnType<typeof computeGroupBounds>>();
        collapsedGroups.forEach((group) => {
            collapsedGroupBounds.set(group.id, computeGroupBounds(group, contentNodes, groups));
        });

        const addedLayoutNodeIds = new Set<string>();

        collapsedGroups.forEach((group) => {
            const layoutNodeId = group.id;
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
            const leftHandles = new Set(["", "true", "body"]);
            const rightHandles = new Set(["false", "done", "error"]);
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
            const layoutNodeId = group.id;
            const layoutNode = graph.node(layoutNodeId);
            const currentBounds = collapsedGroupBounds.get(group.id);
            if (!layoutNode || !currentBounds) return;

            const targetBounds = {
                x: layoutNode.x - COLLAPSED_GROUP_WIDTH / 2,
                y: layoutNode.y - COLLAPSED_GROUP_HEADER_HEIGHT / 2,
            };
            const deltaX = targetBounds.x - currentBounds.x;
            const deltaY = targetBounds.y - currentBounds.y;

            getGroupNodeIdSet(group.id).forEach((nodeId) => {
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

        const BRANCH_BASE_OFFSET = 120;
        const DIRECT_BRANCH_MIN_GAP = 140;
        const DIRECT_BRANCH_EXTRA_GAP = 90;

        contentNodes.forEach((node) => {
            const outgoing = edges.filter((edge) => edge.source === node.id);
            const primaryEdge = outgoing.find(
                (edge) => !edge.sourceHandle || edge.sourceHandle === "true" || edge.sourceHandle === "body",
            );
            const secondaryEdge = outgoing.find(
                (edge) => edge.sourceHandle === "false" || edge.sourceHandle === "done" || edge.sourceHandle === "error",
            );
            if (!primaryEdge || !secondaryEdge) return;

            const primaryTargetPos = nodePositions[primaryEdge.target];
            const secondaryTargetPos = nodePositions[secondaryEdge.target];
            if (!primaryTargetPos || !secondaryTargetPos) return;

            if (primaryTargetPos.x >= secondaryTargetPos.x) {
                const primaryReachable = collectReachable(primaryEdge.target);
                const secondaryReachable = collectReachable(secondaryEdge.target);
                const overlap = new Set([...primaryReachable].filter((nodeId) => secondaryReachable.has(nodeId)));
                const primaryOnly = new Set([...primaryReachable].filter((nodeId) => !overlap.has(nodeId)));
                const secondaryOnly = new Set([...secondaryReachable].filter((nodeId) => !overlap.has(nodeId)));
                const gap = Math.max(
                    DIRECT_BRANCH_MIN_GAP,
                    Math.abs(primaryTargetPos.x - secondaryTargetPos.x) / 2 + DIRECT_BRANCH_EXTRA_GAP,
                );
                shiftReachableNodes(primaryOnly, -gap);
                shiftReachableNodes(secondaryOnly, gap);
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
            if (!edge.sourceHandle || edge.sourceHandle === "true" || edge.sourceHandle === "body") {
                traverse(edge.target, trueReachable);
            }
            if (edge.sourceHandle === "false" || edge.sourceHandle === "done" || edge.sourceHandle === "error") {
                traverse(edge.target, falseReachable);
            }
        });

        contentNodes.forEach((node) => {
            const pos = nodePositions[node.id];
            if (!pos) return;
            const isTrue = trueReachable.has(node.id);
            const isFalse = falseReachable.has(node.id);
            if (isTrue && !isFalse) pos.x -= BRANCH_BASE_OFFSET;
            else if (isFalse && !isTrue) pos.x += BRANCH_BASE_OFFSET;
        });

        contentNodes.forEach((node) => {
            const outgoing = edges.filter((edge) => edge.source === node.id);
            const primaryEdge = outgoing.find(
                (edge) => !edge.sourceHandle || edge.sourceHandle === "true" || edge.sourceHandle === "body",
            );
            const secondaryEdge = outgoing.find(
                (edge) => edge.sourceHandle === "false" || edge.sourceHandle === "done" || edge.sourceHandle === "error",
            );
            if (!primaryEdge || !secondaryEdge) return;

            const nodePos = nodePositions[node.id];
            const primaryTargetPos = nodePositions[primaryEdge.target];
            const secondaryTargetPos = nodePositions[secondaryEdge.target];
            if (!nodePos || !primaryTargetPos || !secondaryTargetPos) return;

            nodePos.x = (primaryTargetPos.x + secondaryTargetPos.x) / 2;
        });

        [...groups]
            .filter((group) => !group.collapsed)
            .sort((a, b) => getGroupDepth(b.id, groups) - getGroupDepth(a.id, groups))
            .forEach((group) => {
                const currentBounds = getGroupDisplayBounds(group, contentNodes, groups);
                if (!currentBounds) return;

                const targetCenterX = currentBounds.x + GROUP_PADDING_LEFT + (currentBounds.width - GROUP_PADDING_LEFT - GROUP_PADDING_RIGHT) / 2;
                const groupNodeIds = getGroupNodeIdSet(group.id);
                const memberNodes = contentNodes.filter((node) => groupNodeIds.has(node.id) && nodePositions[node.id]);

                if (memberNodes.length === 0) return;

                const layoutBounds = memberNodes.reduce(
                    (acc, node) => {
                        const pos = nodePositions[node.id];
                        if (!pos) return acc;

                        const width = Number(node.measured?.width) || 200;
                        const height = Number(node.measured?.height) || 60;
                        const left = pos.x - width / 2;
                        const right = left + width;
                        const top = pos.y - height / 2;
                        const bottom = top + height;

                        acc.minX = Math.min(acc.minX, left);
                        acc.maxX = Math.max(acc.maxX, right);
                        acc.minY = Math.min(acc.minY, top);
                        acc.maxY = Math.max(acc.maxY, bottom);
                        return acc;
                    },
                    {
                        minX: Number.POSITIVE_INFINITY,
                        maxX: Number.NEGATIVE_INFINITY,
                        minY: Number.POSITIVE_INFINITY,
                        maxY: Number.NEGATIVE_INFINITY,
                    },
                );

                if (!Number.isFinite(layoutBounds.minX) || !Number.isFinite(layoutBounds.maxX)) {
                    return;
                }

                const currentCenterX = (layoutBounds.minX + layoutBounds.maxX) / 2;
                const deltaX = targetCenterX - currentCenterX;
                if (deltaX === 0) return;

                memberNodes.forEach((node) => {
                    const pos = nodePositions[node.id];
                    if (!pos) return;
                    pos.x += deltaX;
                });
            });

        const nextNodes = nodes.map((node) => {
            const position = nodePositions[node.id];
            if (!position) return node;
            const nodeWidth = Number(node.measured?.width) || 200;
            const nodeHeight = Number(node.measured?.height) || 60;
            return {
                ...node,
                position: {
                    x: position.x - nodeWidth / 2,
                    y: position.y - nodeHeight / 2,
                },
            };
        });

        setNodes(nextNodes);
        onFlowChange?.(stripDerivedGroupNodes(nextNodes), edges, groups);

        setTimeout(() => {
            reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
        }, 50);
    }, [contentNodes, edges, getGroupNodeIdSet, groups, nodes, onFlowChange, reactFlowInstance, setNodes]);

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
            <ReactFlow
                nodes={visibleNodes}
                edges={visibleEdges}
                proOptions={{ hideAttribution: true }}
                onNodesChange={readOnly ? undefined : onFlowNodesChange}
                onEdgesChange={readOnly ? undefined : onEdgesChange}
                onConnect={readOnly ? undefined : onConnect}
                onConnectStart={readOnly ? undefined : () => setIsConnecting(true)}
                onConnectEnd={readOnly ? undefined : () => setIsConnecting(false)}
                onInit={setReactFlowInstance}
                onDrop={readOnly ? undefined : onDrop}
                onDragOver={readOnly ? undefined : onDragOver}
                onNodeDragStart={readOnly ? undefined : onGroupNodeDragStart}
                onNodeDragStop={readOnly ? undefined : onGroupNodeDragStop}
                onSelectionChange={onSelectionChange}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={readOnly && !allowNodeEditingInReadOnly ? undefined : onNodeDoubleClick}
                onPaneClick={() => {
                    setNodes((prev) => prev.map((node) => ({ ...node, selected: false })));
                    setEdges((prev) => prev.map((edge) => ({ ...edge, selected: false })));
                    setSelectedNodes([]);
                    setSelectedEdges([]);
                    setSelectedGroupId(null);
                    setSelectedGroupIds([]);
                    setIsRenamingGroup(false);
                    onPaneClick?.();
                }}
                onDelete={deleteSelected}
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
                {groupableSelectionCount >= 2 && !readOnly && (
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

            {activeGroup && !readOnly && isRenamingGroup && (
                <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-lg">
                    <div className="text-xs font-mono text-muted-foreground">重命名分组</div>
                    <Input
                        id="active-group-title"
                        name="activeGroupTitle"
                        value={groupDraftTitle}
                        autoFocus
                        onChange={(event) => setGroupDraftTitle(event.target.value)}
                        onBlur={handleGroupTitleSave}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                handleGroupTitleSave();
                            }
                            if (event.key === "Escape") {
                                setGroupDraftTitle(activeGroup.title);
                                setIsRenamingGroup(false);
                            }
                        }}
                        className="h-8 w-48"
                    />
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
