import { Square } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const UncheckNode: NodeTypeConfig = {
  type: "uncheck",
  label: "Uncheck",
  icon: Square,
  color: "node-uncheck",
  description: "Uncheck a checkbox input",
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

export default UncheckNode;
