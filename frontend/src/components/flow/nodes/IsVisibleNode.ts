import { Eye } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const IsVisibleNode: NodeTypeConfig = {
  type: "isVisible",
  label: "Is Visible",
  icon: Eye,
  color: "node-default",
  description: "Check whether a target element is visible",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "boolean",
  fields: [...selectorFields],
  subtitle: "visible {selector}",
};

export default IsVisibleNode;
