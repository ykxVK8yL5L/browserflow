import { Clock } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const WaitNode: NodeTypeConfig = {
  type: "wait",
  label: "Wait",
  icon: Clock,
  color: "node-wait",
  description: "Wait for duration",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选，引用 locator 节点输出" },
  ],
  outputType: "void",
  fields: [
    { key: "duration", label: "Duration (ms)", type: "number", placeholder: "1000", defaultValue: 1000 },
  ],
  subtitle: "{duration}ms",
};

export default WaitNode;
