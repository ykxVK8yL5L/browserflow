import { Hash } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const CountNode: NodeTypeConfig = {
  type: "count",
  label: "Count",
  icon: Hash,
  color: "node-default",
  description: "Count matched elements",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
  ],
  outputType: "number",
  fields: [...selectorFields],
  subtitle: "count {selector}",
};

export default CountNode;
