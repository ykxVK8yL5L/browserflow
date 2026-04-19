import { CheckSquare } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const IsCheckedNode: NodeTypeConfig = {
  type: "isChecked",
  label: "Is Checked",
  icon: CheckSquare,
  color: "node-default",
  description: "Check whether a target element is checked",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "boolean",
  fields: [...selectorFields],
  subtitle: "checked {selector}",
};

export default IsCheckedNode;
