import { FileCode2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ScriptNode: NodeTypeConfig = {
  type: "script",
  label: "Script",
  icon: FileCode2,
  color: "node-script",
  description: "Execute JavaScript in the current page context and return the result",
  outputType: "object",
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