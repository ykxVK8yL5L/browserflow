import { MousePointer } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const ClickNode: NodeTypeConfig = {
  type: "click",
  label: "Click",
  icon: MousePointer,
  color: "node-click",
  description: "Click an element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    {
      key: "button",
      label: "Button",
      type: "select",
      options: [
        { label: "Left", value: "left" },
        { label: "Middle", value: "middle" },
        { label: "Right", value: "right" },
      ],
      defaultValue: "left",
    },
    { key: "clickCount", label: "Click Count", type: "number", defaultValue: 1 },
    { key: "timeout", label: "Timeout", type: "number", defaultValue: 30000 },
  ],
  subtitle: "{selector}",
};

export default ClickNode;
