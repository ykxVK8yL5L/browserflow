import { SquareX } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ClosePageNode: NodeTypeConfig = {
  type: "closePage",
  label: "Close Page",
  icon: SquareX,
  color: "node-closePage",
  description: "Close a named page. The main page cannot be closed",
  outputType: "object",
  fields: [
    {
      key: "name",
      label: "Page Name",
      type: "text",
      placeholder: "detail_page",
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "close {name}",
};

export default ClosePageNode;