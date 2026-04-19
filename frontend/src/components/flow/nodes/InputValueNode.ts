import { TextCursorInput } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const InputValueNode: NodeTypeConfig = {
  type: "inputValue",
  label: "Input Value",
  icon: TextCursorInput,
  color: "node-default",
  description: "Read input value from a target element",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "string",
  fields: [...selectorFields],
  subtitle: "value {selector}",
};

export default InputValueNode;
