import { ArrowRightLeft } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const SwitchPageNode: NodeTypeConfig = {
  type: "switchPage",
  label: "Switch Page",
  icon: ArrowRightLeft,
  color: "node-switchPage",
  description: "Switch the current execution context to another named page",
  outputType: "object",
  fields: [
    {
      key: "name",
      label: "Page Name",
      type: "text",
      placeholder: "main",
      defaultValue: "main",
      valueSource: "params",
    },
  ],
  subtitle: "switch {name}",
};

export default SwitchPageNode;