import { Map as MapIcon } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const MapNode: NodeTypeConfig = {
  type: "map",
  label: "Map",
  icon: MapIcon,
  color: "node-map",
  description: "Map an input array into a new array with an expression or arrow function",
  inputDefs: [
    { key: "items", label: "Items Reference", description: "引用上游数组输出" },
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
    {
      key: "expression",
      label: "Expression",
      type: "text",
      placeholder: "el => ({ text: el.textContent, id: el.id })",
      defaultValue: "item",
      valueSource: "params",
    },
  ],
  subtitle: "{expression}",
};

export default MapNode;
