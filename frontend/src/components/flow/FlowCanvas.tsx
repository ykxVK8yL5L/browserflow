import { useCallback, useRef, useState, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import BrowserNode from "./BrowserNode";
import BreakNodeComponent from "./nodes/BreakNodeComponent";
import ContinueNodeComponent from "./nodes/ContinueNodeComponent";
import IfNodeComponent from "./nodes/IfNodeComponent";
import StopNodeComponent from "./nodes/StopNodeComponent";
import CheckExistenceNodeComponent from "./nodes/CheckExistenceNodeComponent";
import { NODE_TYPES_CONFIG, buildDefaultData } from "./nodeTypes";
import NodeEditor from "./NodeEditor";
import { Trash2, AlignVerticalSpaceAround, Map as MapIcon, Copy, Clipboard } from "lucide-react";
import Dagre from "@dagrejs/dagre";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

const nodeTypes: Record<string, any> = {
  break: BreakNodeComponent,
  continue: ContinueNodeComponent,
  if: IfNodeComponent,
  stop: StopNodeComponent,
  check_existence: CheckExistenceNodeComponent,
};

NODE_TYPES_CONFIG.forEach(config => {
  if (!nodeTypes[config.type]) {
    nodeTypes[config.type] = BrowserNode;
  }
});

let id = Date.now();
const getId = () => `node_${id++}`;

// Clipboard for copy/paste (module-level so it persists)
let clipboardNodes: Node[] = [];
let clipboardEdges: Edge[] = [];

interface FlowCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  isRunning?: boolean;
  readOnly?: boolean;
  allowNodeEditingInReadOnly?: boolean;
  onFlowChange?: (nodes: Node[], edges: Edge[]) => void;
  onAddNodeRef?: (fn: (nodeType: string) => void) => void;
  onPaneClick?: () => void;
  onSetNodeExecStatusRef?: (fn: (nodeId: string, status: string, detail?: { message?: string; error?: string; duration?: number }) => void) => void;
  onResetRef?: (fn: (nodes: Node[], edges: Edge[]) => void) => void;
}

const FlowCanvas = ({ initialNodes = [], initialEdges = [], isRunning = false, readOnly = false, allowNodeEditingInReadOnly = false, onFlowChange, onAddNodeRef, onPaneClick, onSetNodeExecStatusRef, onResetRef }: FlowCanvasProps) => {
  const isMobile = useIsMobile();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const suppressFlowChangeRef = useRef(0);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [showMinimap, setShowMinimap] = useState(false);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [editingNode, setEditingNode] = useState<Node | null>(null);

  // Toggle edge animation based on running state
  useEffect(() => {
    setEdges((eds) => eds.map((e) => ({ ...e, animated: isRunning })));
  }, [isRunning, setEdges]);

  useEffect(() => {
    suppressFlowChangeRef.current += 1;
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    suppressFlowChangeRef.current += 1;
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Auto-save flow changes
  useEffect(() => {
    if (suppressFlowChangeRef.current > 0) {
      suppressFlowChangeRef.current -= 1;
      return;
    }
    onFlowChange?.(nodes, edges);
  }, [nodes, edges, onFlowChange]);

  // Keyboard shortcuts: Ctrl+A (select all), Ctrl+C (copy), Ctrl+V (paste)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (readOnly) return;

      const target = e.target as HTMLElement

      if (target.tagName === 'INPUT') {
        return
      }

      if (!target.hasAttribute('data-id')) {
        return
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === "a") {
        e.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
      }

      if (e.key === "c") {
        const selNodes = nodes.filter((n) => n.selected);
        if (selNodes.length === 0) return;
        e.preventDefault();
        const selIds = new Set(selNodes.map((n) => n.id));
        clipboardNodes = selNodes.map((n) => ({ ...n }));
        clipboardEdges = edges.filter((ed) => selIds.has(ed.source) && selIds.has(ed.target));
        toast.success(`Copied ${selNodes.length} node(s)`);
      }

      if (e.key === "v") {
        if (clipboardNodes.length === 0) return;
        e.preventDefault();
        const idMap = new Map<string, string>();
        clipboardNodes.forEach((n) => idMap.set(n.id, getId()));

        const newNodes: Node[] = clipboardNodes.map((n) => ({
          ...n,
          id: idMap.get(n.id)!,
          selected: true,
          position: { x: n.position.x + 50, y: n.position.y + 50 },
          data: { ...n.data, _execStatus: undefined, _execMessage: undefined, _execError: undefined, _execDuration: undefined },
        }));

        const newEdges: Edge[] = clipboardEdges.map((ed) => ({
          ...ed,
          id: `e_${idMap.get(ed.source)}_${idMap.get(ed.target)}`,
          source: idMap.get(ed.source)!,
          target: idMap.get(ed.target)!,
          selected: false,
        }));

        // Deselect existing, add pasted
        setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
        setEdges((eds) => [...eds, ...newEdges]);

        // Shift clipboard for next paste
        clipboardNodes = clipboardNodes.map((n) => ({ ...n, position: { x: n.position.x + 50, y: n.position.y + 50 } }));
        toast.success(`Pasted ${newNodes.length} node(s)`);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setNodes, setEdges, nodes, edges, readOnly]);

  const addNodeToCenter = useCallback(
    (nodeType: string) => {
      const config = NODE_TYPES_CONFIG.find((n) => n.type === nodeType);
      if (!config) return;

      // Place at the center of the current viewport
      let position = { x: 250, y: 100 };

      if (reactFlowInstance) {
        const wrapper = reactFlowWrapper.current;
        if (wrapper) {
          const bounds = wrapper.getBoundingClientRect();
          // Use absolute screen coords for the center of the wrapper
          position = reactFlowInstance.screenToFlowPosition({
            x: bounds.left + bounds.width / 2,
            y: bounds.top + bounds.height / 2,
          });
        }
      }

      // Small random offset so stacked adds don't overlap exactly
      position.x += (Math.random() - 0.5) * 40;
      position.y += (Math.random() - 0.5) * 40;

      const newId = getId();
      const newNode: Node = {
        id: newId,
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
    [reactFlowInstance, setNodes]
  );

  const setNodeExecStatus = useCallback(
    (nodeId: string, status: string, detail?: { message?: string; error?: string; duration?: number }) => {
      if (nodeId === "__reset__") {
        setNodes((nds) => nds.map((n) => ({
          ...n, data: { ...n.data, _execStatus: "idle", _execMessage: "", _execError: "", _execDuration: undefined }
        })));
        return;
      }
      setNodes((nds) =>
        nds.map((n) => n.id === nodeId ? {
          ...n, data: {
            ...n.data,
            _execStatus: status,
            _execMessage: detail?.message || "",
            _execError: detail?.error || "",
            _execDuration: detail?.duration,
          }
        } : n)
      );
    },
    [setNodes]
  );

  if (onSetNodeExecStatusRef) {
    onSetNodeExecStatusRef(setNodeExecStatus);
  }

  if (onAddNodeRef) {
    onAddNodeRef(addNodeToCenter);
  }

  if (onResetRef) {
    onResetRef((newNodes: Node[], newEdges: Edge[]) => {
      suppressFlowChangeRef.current += 2;
      setNodes(newNodes);
      setEdges(newEdges);
    });
  }

  const onConnect = useCallback(
    (params: Connection) => {
      const edge = {
        ...params,
        data: {
          condition: params.sourceHandle === "true" ? "true" :
            params.sourceHandle === "false" ? "false" : undefined,
        },
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (readOnly) return;
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance || !reactFlowWrapper.current) return;

      const config = NODE_TYPES_CONFIG.find((n) => n.type === type);
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
    [reactFlowInstance, setNodes, readOnly]
  );

  const onSelectionChange = useCallback(
    ({ nodes: selNodes, edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
      setSelectedNodes(selNodes.map((n) => n.id));
      setSelectedEdges(selEdges.map((e) => e.id));
    },
    []
  );

  const deleteSelected = useCallback(() => {
    if (readOnly) return;
    if (selectedNodes.length > 0) {
      setNodes((nds) => nds.filter((n) => !selectedNodes.includes(n.id)));
      // Also remove edges connected to deleted nodes
      setEdges((eds) =>
        eds.filter(
          (e) => !selectedNodes.includes(e.source) && !selectedNodes.includes(e.target)
        )
      );
    }
    if (selectedEdges.length > 0) {
      setEdges((eds) => eds.filter((e) => !selectedEdges.includes(e.id)));
    }
    setSelectedNodes([]);
    setSelectedEdges([]);
  }, [selectedNodes, selectedEdges, setNodes, setEdges, readOnly]);

  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;

  const tidyUp = useCallback(() => {
    const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 100 });

    nodes.forEach((node) => {
      g.setNode(node.id, { width: 200, height: 60 });
    });

    // Sort edges to prioritize left/right branch handles consistently in dagre
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
      g.setEdge(edge.source, edge.target);
    });

    Dagre.layout(g);

    // Post-process to ensure branches are positioned to the left/right and propagate to descendants
    const nodePositions: Record<string, { x: number, y: number }> = {};
    nodes.forEach((node) => {
      const pos = g.node(node.id);
      nodePositions[node.id] = { x: pos.x, y: pos.y };
    });

    const trueReachable = new Set<string>();
    const falseReachable = new Set<string>();

    const traverse = (startNodeId: string, reachableSet: Set<string>) => {
      const queue = [startNodeId];
      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (reachableSet.has(currentId)) continue;
        reachableSet.add(currentId);
        edges.forEach(e => {
          if (e.source === currentId) queue.push(e.target);
        });
      }
    };

    edges.forEach(e => {
      if (e.sourceHandle === 'true' || e.sourceHandle === 'body') {
        traverse(e.target, trueReachable);
      }
      if (e.sourceHandle === 'false' || e.sourceHandle === 'done') {
        traverse(e.target, falseReachable);
      }
    });

    nodes.forEach(node => {
      const pos = nodePositions[node.id];
      if (!pos) return;

      const isTrue = trueReachable.has(node.id);
      const isFalse = falseReachable.has(node.id);

      if (isTrue && !isFalse) {
        pos.x -= 300;
      } else if (isFalse && !isTrue) {
        pos.x += 300;
      }
    });

    const layoutedNodes = nodes.map((node) => {
      const pos = nodePositions[node.id];
      return {
        ...node,
        position: { x: pos.x - 100, y: pos.y - 30 },
      };
    });

    setNodes(layoutedNodes);

    // Fit view after layout
    setTimeout(() => {
      reactFlowInstance?.fitView({ padding: 0.2, duration: 300 });
    }, 50);
  }, [nodes, edges, setNodes, reactFlowInstance]);

  const onNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setEditingNode(node);
    },
    []
  );

  const onNodeSave = useCallback(
    (id: string, data: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: { captureScreenshot: false, screenshotTiming: "after", ...data } } : n))
      );
    },
    [setNodes]
  );

  return (
    <div ref={reactFlowWrapper} className="flex-1 h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        proOptions={{ hideAttribution: true }}
        onNodesChange={readOnly ? undefined : onNodesChange}
        onEdgesChange={readOnly ? undefined : onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        onInit={setReactFlowInstance}
        onDrop={readOnly ? undefined : onDrop}
        onDragOver={readOnly ? undefined : onDragOver}
        onSelectionChange={onSelectionChange}
        onNodeDoubleClick={readOnly && !allowNodeEditingInReadOnly ? undefined : onNodeDoubleClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        className="bg-background"
        defaultEdgeOptions={{ animated: false }}
        zoomOnDoubleClick={false}
        connectOnClick={!readOnly}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      >
        <Controls />
        {showMinimap && (
          <MiniMap
            nodeColor={() => "hsl(185, 80%, 55%)"}
            maskColor="hsl(220, 20%, 7%, 0.8)"
          />
        )}
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="hsl(220, 15%, 18%)"
        />
      </ReactFlow>

      <div
        className={[
          "absolute z-10 flex gap-1.5",
          isMobile
            ? "top-2 left-2 right-2 flex-row flex-wrap justify-end"
            : "top-2 right-2 flex-col",
        ].join(" ")}
      >
        {hasSelection && !readOnly && (
          <button
            onClick={deleteSelected}
            className="min-h-9 px-2.5 py-1.5 rounded-md bg-destructive text-destructive-foreground text-xs font-mono font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            <Trash2 size={13} />
            {isMobile ? "Delete" : "Delete"}
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
          onClick={() => setShowMinimap((v) => !v)}
          className={`min-h-9 px-2.5 py-1.5 rounded-md border border-border text-xs font-mono flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${showMinimap ? "bg-primary/20 text-primary border-primary/40" : "bg-card text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
        >
          <MapIcon size={13} />
          {isMobile ? (showMinimap ? "Hide Map" : "Mini Map") : (showMinimap ? "Hide Map" : "Mini Map")}
        </button>
      </div>

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
