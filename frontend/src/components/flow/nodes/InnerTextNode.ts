import { AlignLeft } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const InnerTextNode: NodeTypeConfig = {
  type: "innerText",
  label: "Inner Text",
  icon: AlignLeft,
  color: "node-default",
  description: "Read innerText from a target element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "string",
  fields: [...selectorFields],
  subtitle: "inner {selector}",
};

export default InnerTextNode;
