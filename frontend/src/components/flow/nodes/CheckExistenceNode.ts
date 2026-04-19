import { SearchCheck } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const CheckExistenceNode: NodeTypeConfig = {
  type: "check_existence",
  label: "Check Existence",
  icon: SearchCheck,
  color: "node-check_existence",
  description: "Check if a locator exists on the page",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选，引用 locator 节点输出" },
  ],
  fields: [
    {
      key: "selector",
      label: "Selector",
      type: "text",
      placeholder: ".my-element",
    },
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "Exists: {selector}?",
};

export default CheckExistenceNode;
