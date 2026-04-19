import { Keyboard } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const TypeNode: NodeTypeConfig = {
  type: "type",
  label: "Type",
  icon: Keyboard,
  color: "node-type",
  description: "Type into an input",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
    { key: "text", label: "Text Reference", description: "引用上游文本输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    { key: "text", label: "Text", type: "text", placeholder: "Hello", defaultValue: "Hello" },
    { key: "delay", label: "Delay", type: "number", defaultValue: 0 },
    { key: "timeout", label: "Timeout", type: "number", defaultValue: 30000 },
  ],
  subtitle: '"{text}"',
};

export default TypeNode;
