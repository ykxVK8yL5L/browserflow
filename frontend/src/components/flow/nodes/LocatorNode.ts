import { Search } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const LocatorNode: NodeTypeConfig = {
  type: "locator",
  label: "Locator",
  icon: Search,
  color: "node-default",
  description: "Create a reusable locator reference. 默认使用第一个匹配元素；如果需要多个结果请配合 All，指定下标请用 Nth，取最后一个请用 Last。",
  outputType: "locator",
  fields: [
    ...selectorFields,
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{selector}",
};

export default LocatorNode;
