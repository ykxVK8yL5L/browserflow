export interface FlowGroup {
  id: string;
  title: string;
  description?: string;
  color?: string;
  collapsed?: boolean;
  entryNodeId?: string;
  exitNodeId?: string;
  nodeIds: string[];
}

export interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GROUP_PADDING_X = 24;
const GROUP_PADDING_TOP = 64;
const GROUP_PADDING_BOTTOM = 18;

const GROUP_COLORS = [
  "rgba(59, 130, 246, 0.14)",
  "rgba(16, 185, 129, 0.14)",
  "rgba(245, 158, 11, 0.14)",
  "rgba(168, 85, 247, 0.14)",
  "rgba(236, 72, 153, 0.14)",
];

let groupSeed = Date.now();

export function getNextGroupId(): string {
  groupSeed += 1;
  return `group_${groupSeed}`;
}

export function createGroup(input: {
  title: string;
  nodeIds: string[];
  description?: string;
  color?: string;
}): FlowGroup {
  return {
    id: getNextGroupId(),
    title: input.title,
    description: input.description,
    color: input.color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
    collapsed: false,
    nodeIds: [...new Set(input.nodeIds)],
  };
}

export function sanitizeGroups(groups: FlowGroup[] | undefined, validNodeIds: Set<string>): FlowGroup[] {
  return (groups || [])
    .map((group) => ({
      ...group,
      nodeIds: (group.nodeIds || []).filter((nodeId) => validNodeIds.has(nodeId)),
      entryNodeId: validNodeIds.has(group.entryNodeId || "") ? group.entryNodeId : undefined,
      exitNodeId: validNodeIds.has(group.exitNodeId || "") ? group.exitNodeId : undefined,
    }))
    .filter((group) => group.nodeIds.length > 0);
}

export function remapImportedGroups(
  groups: FlowGroup[] | undefined,
  idMap: Map<string, string>,
): FlowGroup[] {
  return (groups || [])
    .map((group) => ({
      ...group,
      collapsed: Boolean(group.collapsed),
      id: getNextGroupId(),
      entryNodeId: group.entryNodeId ? idMap.get(group.entryNodeId) : undefined,
      exitNodeId: group.exitNodeId ? idMap.get(group.exitNodeId) : undefined,
      nodeIds: (group.nodeIds || [])
        .map((nodeId) => idMap.get(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    }))
    .filter((group) => group.nodeIds.length > 0);
}

export function removeNodeIdsFromGroups(groups: FlowGroup[], nodeIds: string[]): FlowGroup[] {
  if (nodeIds.length === 0) return groups;
  const removing = new Set(nodeIds);
  return sanitizeGroups(
    groups.map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((nodeId) => !removing.has(nodeId)),
    })),
    new Set(groups.flatMap((group) => group.nodeIds.filter((nodeId) => !removing.has(nodeId)))),
  );
}

export function computeGroupBounds(
  group: FlowGroup,
  nodes: Array<{ id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number } }>,
): GroupBounds | null {
  const memberNodes = nodes.filter((node) => group.nodeIds.includes(node.id));
  if (memberNodes.length === 0) {
    return null;
  }

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

  return {
    x: bounds.minX - GROUP_PADDING_X,
    y: bounds.minY - GROUP_PADDING_TOP,
    width: bounds.maxX - bounds.minX + GROUP_PADDING_X * 2,
    height: bounds.maxY - bounds.minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
  };
}
