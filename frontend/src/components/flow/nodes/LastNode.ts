import { ArrowDownToLine } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const LastNode: NodeTypeConfig = {
  type: "last",
  label: "Last",
  icon: ArrowDownToLine,
  color: "node-default",
  description: "Pick the last element from a locator. 可以直接写 selector；如果填写了 Target Reference，则优先使用上游 locator / locator[] 输出。",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选。引用 locator 或 locator[] 输出；留空时会使用下面的 selector" },
  ],
  outputType: "locator",
  fields: [...selectorFields],
  subtitle: "last {selector}",
};

export default LastNode;
