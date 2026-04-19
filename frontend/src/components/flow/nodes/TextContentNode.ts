import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const TextContentNode: NodeTypeConfig = {
  type: "textContent",
  label: "Text Content",
  icon: FileText,
  color: "node-textContent",
  description: "Read textContent from a target element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "string",
  fields: [...selectorFields],
  subtitle: "text {selector}",
};

export default TextContentNode;
