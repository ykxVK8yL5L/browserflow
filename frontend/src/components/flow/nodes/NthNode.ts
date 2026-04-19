import { ListOrdered } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const NthNode: NodeTypeConfig = {
  type: "nth",
  label: "Nth",
  icon: ListOrdered,
  color: "node-nth",
  description: "Pick an indexed element from a locator. 可以直接写 selector；如果填写了 Target Reference，则优先使用上游 locator / locator[] 输出。",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选。引用 locator 或 locator[] 输出；留空时会使用下面的 selector" },
    { key: "index", label: "Index Reference", description: "可选，引用上游数字输出" },
  ],
  outputType: "locator",
  fields: [
    ...selectorFields,
    { key: "index", label: "Index", type: "number", defaultValue: 0 },
  ],
  subtitle: "nth {index}",
};

export default NthNode;
