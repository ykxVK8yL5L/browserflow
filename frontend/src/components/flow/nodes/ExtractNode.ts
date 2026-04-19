import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ExtractNode: NodeTypeConfig = {
  type: "extract",
  label: "Extract",
  icon: FileText,
  color: "node-extract",
  description: "Extract multiple data points from the page",
  fields: [
    {
      key: "extractions",
      label: "Extractions",
      type: "list",
      listSchema: [
        {
          key: "selector",
          label: "Selector",
          type: "text",
          placeholder: ".price",
        },
        {
          key: "variableName",
          label: "Variable Name",
          type: "text",
          placeholder: "price",
        },
        {
          key: "attribute",
          label: "Attribute",
          type: "text",
          placeholder: "textContent",
          defaultValue: "textContent",
        },
      ],
    },
  ],
  subtitle: "Extracts multiple values to context",
};

export default ExtractNode;
