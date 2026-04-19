import { ToggleRight } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const IsEnabledNode: NodeTypeConfig = {
  type: "isEnabled",
  label: "Is Enabled",
  icon: ToggleRight,
  color: "node-default",
  description: "Check whether a target element is enabled",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "boolean",
  fields: [...selectorFields],
  subtitle: "enabled {selector}",
};

export default IsEnabledNode;
