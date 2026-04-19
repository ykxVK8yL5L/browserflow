import { Pointer } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const HoverNode: NodeTypeConfig = {
  type: "hover",
  label: "Hover",
  icon: Pointer,
  color: "node-click",
  description: "Hover over a target element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{selector}",
};

export default HoverNode;
