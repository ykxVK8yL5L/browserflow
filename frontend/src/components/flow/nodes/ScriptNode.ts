import { FileCode2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ScriptNode: NodeTypeConfig = {
  type: "script",
  label: "Script",
  icon: FileCode2,
  color: "node-script",
  description: "Execute JavaScript in the current page context and return the result",
  outputType: "object",
  inputDefs: [
    { key: "input", label: "Input Reference", description: "可选。引用上游输出，作为脚本参数 input 传入" },
  ],
  fields: [
    {
      key: "script",
      label: "Script",
      type: "text",
      placeholder: "() => document.title",
      defaultValue: "() => document.title",
      valueSource: "params",
    },
  ],
  subtitle: "script",
};

export default ScriptNode;