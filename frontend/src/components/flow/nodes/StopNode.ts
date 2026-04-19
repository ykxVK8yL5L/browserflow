import { Square } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const StopNode: NodeTypeConfig = {
  type: "stop",
  label: "Stop",
  icon: Square,
  color: "node-stop",
  description: "Terminate the flow execution",
  fields: [
    {
      key: "stopType",
      label: "Stop Type",
      type: "select",
      options: [
        { label: "Success", value: "success" },
        { label: "Error", value: "error" },
      ],
      defaultValue: "success",
    },
    {
      key: "errorMessage",
      label: "Error Message",
      type: "text",
      placeholder: "Enter error message...",
    },
  ],
  subtitle: "{stopType} stop",
};

export default StopNode;
