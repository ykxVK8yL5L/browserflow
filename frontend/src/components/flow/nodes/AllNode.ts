import { List } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const AllNode: NodeTypeConfig = {
  type: "all",
  label: "All",
  icon: List,
  color: "node-default",
  description: "Expand a locator into a locator list. 可以直接写 selector；如果填写了 Target Reference，则优先使用上游 locator 输出。",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选。引用 locator 输出；留空时会使用下面的 selector" },
  ],
  outputType: "locator[]",
  fields: [...selectorFields],
  subtitle: "all {selector}",
};

export default AllNode;
