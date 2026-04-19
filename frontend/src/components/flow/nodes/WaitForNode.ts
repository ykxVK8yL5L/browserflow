import { Hourglass } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const WaitForNode: NodeTypeConfig = {
  type: "waitFor",
  label: "Wait For Element",
  icon: Hourglass,
  color: "node-waitFor",
  description: "Wait for an element to reach a specific state",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选，引用 locator 节点输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    {
      key: "state",
      label: "State",
      type: "select",
      options: [
        { label: "Visible", value: "visible" },
        { label: "Hidden", value: "hidden" },
        { label: "Attached", value: "attached" },
        { label: "Detached", value: "detached" },
      ],
      defaultValue: "visible",
      valueSource: "params",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "30000",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{state} {selector}",
};

export default WaitForNode;
