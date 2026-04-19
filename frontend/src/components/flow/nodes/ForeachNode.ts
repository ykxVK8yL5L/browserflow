import { Repeat } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ForeachNode: NodeTypeConfig = {
  type: "foreach",
  label: "Foreach",
  icon: Repeat,
  color: "node-foreach",
  description: "Iterate over an input array and run downstream child chain for each item",
  inputDefs: [
    { key: "items", label: "Items Reference", description: "引用上游数组或 locator[] 输出" },
  ],
  outputType: "array",
  fields: [
    {
      key: "itemName",
      label: "Item Alias",
      type: "text",
      placeholder: "item",
      defaultValue: "item",
      valueSource: "params",
    },
  ],
  subtitle: "as {itemName}",
};

export default ForeachNode;
