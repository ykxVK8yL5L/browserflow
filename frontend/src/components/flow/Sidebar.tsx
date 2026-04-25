import { useMemo, useState } from "react";
import { NODE_TYPES_CONFIG } from "./nodeTypes";
import { Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getSideNodeColorMap, getSideNodeIconColorMap } from "./nodes/shared/types";

const NODE_GROUPS = [
  {
    key: "navigation",
    label: "Navigation",
    types: ["navigate", "wait", "waitFor", "waitForURL", "waitForLoadState", "screenshot", "scroll"],
  },
  {
    key: "locator",
    label: "Locator & Query",
    types: [
      "document",
      "title",
      "url",
      "content",
      "viewport",
      "locator",
      "count",
      "all",
      "first",
      "last",
      "nth",
      "textContent",
      "innerText",
      "inputValue",
      "getAttribute",
      "isVisible",
      "isEnabled",
      "isChecked",
      "extract",
      "check_existence",
    ],
  },
  {
    key: "actions",
    label: "Actions",
    types: ["click", "type", "press", "hover", "check", "uncheck", "selectOption"],
  },
  {
    key: "storage",
    label: "Storage",
    types: ["cookie", "localstorage"],
  },
  {
    key: "control",
    label: "Control Flow",
    types: ["if", "foreach", "while", "for", "map", "set", "stop", "break", "continue"],
  },
];

function getGroupedNodeConfigs(keyword?: string) {
  const normalizedKeyword = (keyword || "").trim().toLowerCase();
  const filteredConfigs = !normalizedKeyword
    ? NODE_TYPES_CONFIG
    : NODE_TYPES_CONFIG.filter((config) => {
      const haystacks = [config.label, config.description, config.type]
        .filter(Boolean)
        .map((item) => item.toLowerCase());
      return haystacks.some((item) => item.includes(normalizedKeyword));
    });

  const grouped = NODE_GROUPS.map((group) => ({
    ...group,
    items: filteredConfigs.filter((config) => group.types.includes(config.type)),
  })).filter((group) => group.items.length > 0);

  const groupedTypes = new Set(grouped.flatMap((group) => group.items.map((item) => item.type)));
  const ungrouped = filteredConfigs.filter((config) => !groupedTypes.has(config.type));

  if (ungrouped.length > 0) {
    grouped.push({
      key: "others",
      label: "Others",
      types: [],
      items: ungrouped,
    });
  }

  return grouped;
}

interface SidebarProps {
  onAddNode?: (nodeType: string) => void;
}

const Sidebar = ({ onAddNode }: SidebarProps) => {
  const [keyword, setKeyword] = useState("");

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  const groupedConfigs = useMemo(() => getGroupedNodeConfigs(keyword), [keyword]);
  const hasFilter = keyword.trim().length > 0;

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <h2 className="font-mono font-bold text-foreground text-sm tracking-wider uppercase">
          Node Library
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Drag or tap + to add nodes
        </p>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            id="node-filter-input"
            name="node-filter-name"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Filter nodes..."
            className="h-9 pl-9 pr-9 text-sm"
          />
          {hasFilter && (
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <div className="p-3 flex flex-col gap-2 overflow-y-auto flex-1">
        {groupedConfigs.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-secondary/30 px-3 py-4 text-center">
            <p className="text-sm font-medium text-foreground">未找到匹配节点</p>
            <p className="mt-1 text-xs text-muted-foreground">试试节点名称、类型或描述关键词</p>
          </div>
        )}
        {groupedConfigs.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="px-1">
              <p className="text-[10px] font-mono font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {group.label}
              </p>
            </div>
            {group.items.map((config) => {
              const Icon = config.icon;
              return (
                <div
                  key={config.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, config.type)}
                  onClick={() => onAddNode?.(config.type)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md border bg-secondary/50 cursor-pointer transition-all ${getSideNodeColorMap(config.type)}`}
                >
                  <Icon size={16} className={getSideNodeIconColorMap(config.type)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-medium text-foreground">
                      {config.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {config.description}
                    </p>
                  </div>
                  <Plus size={14} className="text-muted-foreground shrink-0" />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
};

export default Sidebar;
