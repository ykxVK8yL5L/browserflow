import { SquarePlus } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const NewPageNode: NodeTypeConfig = {
  type: "newPage",
  label: "Create Page",
  icon: SquarePlus,
  color: "node-newPage",
  description: "Create a new browser page with a custom name",
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
  subtitle: "create {name}",
};

export default NewPageNode;