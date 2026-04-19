import { Check } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const CheckNode: NodeTypeConfig = {
  type: "check",
  label: "Check",
  icon: Check,
  color: "node-click",
  description: "Check a checkbox or radio input",
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

export default CheckNode;
