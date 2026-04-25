export interface FlowGroup {
  id: string;
  title: string;
  description?: string;
  color?: string;
  collapsed?: boolean;
  parentGroupId?: string;
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

const GROUP_PADDING_LEFT = 40;
const GROUP_PADDING_RIGHT = 24;
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
  parentGroupId?: string;
  description?: string;
  color?: string;
}): FlowGroup {
  return {
    id: getNextGroupId(),
    title: input.title,
    description: input.description,
    color: input.color || GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)],
    collapsed: false,
    parentGroupId: input.parentGroupId,
    nodeIds: [...new Set(input.nodeIds)],
  };
}

export function getChildGroups(groups: FlowGroup[] | undefined, parentGroupId?: string): FlowGroup[] {
  return (groups || []).filter((group) => (group.parentGroupId || undefined) === (parentGroupId || undefined));
}

export function getGroupDepth(groupId: string, groups: FlowGroup[] | undefined): number {
  const groupMap = new Map((groups || []).map((group) => [group.id, group]));
  let depth = 0;
  let cursor = groupMap.get(groupId)?.parentGroupId;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    depth += 1;
    cursor = groupMap.get(cursor)?.parentGroupId;
  }

  return depth;
}

export function getGroupAncestorIds(groupId: string, groups: FlowGroup[] | undefined): string[] {
  const groupMap = new Map((groups || []).map((group) => [group.id, group]));
  const ancestors: string[] = [];
  let cursor = groupMap.get(groupId)?.parentGroupId;
  const visited = new Set<string>();

  while (cursor && !visited.has(cursor)) {
    ancestors.push(cursor);
    visited.add(cursor);
    cursor = groupMap.get(cursor)?.parentGroupId;
  }

  return ancestors;
}

export function getGroupDescendantGroupIds(groupId: string, groups: FlowGroup[] | undefined): string[] {
  const result: string[] = [];
  const queue = [groupId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    const children = getChildGroups(groups, currentId);
    children.forEach((child) => {
      result.push(child.id);
      queue.push(child.id);
    });
  }

  return result;
}

export function getGroupNodeIdsDeep(groupId: string, groups: FlowGroup[] | undefined): string[] {
  const groupMap = new Map((groups || []).map((group) => [group.id, group]));
  const root = groupMap.get(groupId);
  if (!root) return [];

  const nodeIds = new Set<string>(root.nodeIds || []);
  const queue = [groupId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;
    getChildGroups(groups, currentId).forEach((child) => {
      child.nodeIds.forEach((nodeId) => nodeIds.add(nodeId));
      queue.push(child.id);
    });
  }

  return [...nodeIds];
}

export function sanitizeGroups(groups: FlowGroup[] | undefined, validNodeIds: Set<string>): FlowGroup[] {
  const normalized = (groups || []).map((group) => ({
    ...group,
    nodeIds: [...new Set((group.nodeIds || []).filter((nodeId) => validNodeIds.has(nodeId)))],
    parentGroupId: group.parentGroupId || undefined,
    entryNodeId: validNodeIds.has(group.entryNodeId || "") ? group.entryNodeId : undefined,
    exitNodeId: validNodeIds.has(group.exitNodeId || "") ? group.exitNodeId : undefined,
  }));

  const validGroupIds = new Set(normalized.map((group) => group.id));
  const groupMap = new Map(normalized.map((group) => [group.id, group]));

  normalized.forEach((group) => {
    if (!group.parentGroupId || !validGroupIds.has(group.parentGroupId) || group.parentGroupId === group.id) {
      group.parentGroupId = undefined;
      return;
    }

    const visited = new Set<string>([group.id]);
    let cursor = group.parentGroupId;
    while (cursor) {
      if (visited.has(cursor)) {
        group.parentGroupId = undefined;
        break;
      }
      visited.add(cursor);
      cursor = groupMap.get(cursor)?.parentGroupId;
    }
  });

  let filtered = normalized;
  let changed = true;
  while (changed) {
    changed = false;
    const filteredIds = new Set(filtered.map((group) => group.id));
    const childCount = new Map<string, number>();

    filtered.forEach((group) => {
      if (group.parentGroupId && filteredIds.has(group.parentGroupId)) {
        childCount.set(group.parentGroupId, (childCount.get(group.parentGroupId) || 0) + 1);
      }
    });

    const next = filtered.filter((group) => group.nodeIds.length > 0 || (childCount.get(group.id) || 0) > 0);
    if (next.length !== filtered.length) {
      changed = true;
      filtered = next.map((group) => ({
        ...group,
        parentGroupId: group.parentGroupId && next.some((candidate) => candidate.id === group.parentGroupId)
          ? group.parentGroupId
          : undefined,
      }));
    }
  }

  return filtered;
}

export function remapImportedGroups(
  groups: FlowGroup[] | undefined,
  idMap: Map<string, string>,
): FlowGroup[] {
  const groupIdMap = new Map<string, string>();
  (groups || []).forEach((group) => {
    groupIdMap.set(group.id, getNextGroupId());
  });

  return sanitizeGroups(
    (groups || []).map((group) => ({
      ...group,
      collapsed: Boolean(group.collapsed),
      id: groupIdMap.get(group.id) || getNextGroupId(),
      parentGroupId: group.parentGroupId ? groupIdMap.get(group.parentGroupId) : undefined,
      entryNodeId: group.entryNodeId ? idMap.get(group.entryNodeId) : undefined,
      exitNodeId: group.exitNodeId ? idMap.get(group.exitNodeId) : undefined,
      nodeIds: (group.nodeIds || [])
        .map((nodeId) => idMap.get(nodeId))
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    })),
    new Set((groups || []).flatMap((group) => (group.nodeIds || []).map((nodeId) => idMap.get(nodeId)).filter(Boolean) as string[])),
  );
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
  groups?: FlowGroup[],
): GroupBounds | null {
  const memberBounds: GroupBounds[] = [];
  const nodeIds = new Set(groups ? group.nodeIds : group.nodeIds);
  const memberNodes = nodes.filter((node) => nodeIds.has(node.id));

  memberNodes.forEach((node) => {
    const width = Number(node.measured?.width) || 220;
    const height = Number(node.measured?.height) || 90;
    memberBounds.push({
      x: node.position.x,
      y: node.position.y,
      width,
      height,
    });
  });

  if (groups) {
    getChildGroups(groups, group.id).forEach((childGroup) => {
      const childBounds = computeGroupBounds(childGroup, nodes, groups);
      if (childBounds) {
        memberBounds.push(childBounds);
      }
    });
  }

  if (memberBounds.length === 0) {
    return null;
  }

  const bounds = memberBounds.reduce(
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

  return {
    x: bounds.minX - GROUP_PADDING_LEFT,
    y: bounds.minY - GROUP_PADDING_TOP,
    width: bounds.maxX - bounds.minX + GROUP_PADDING_LEFT + GROUP_PADDING_RIGHT,
    height: bounds.maxY - bounds.minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
  };
}
