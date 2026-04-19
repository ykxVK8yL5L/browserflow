import { Link2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const UrlNode: NodeTypeConfig = {
  type: "url",
  label: "URL",
  icon: Link2,
  color: "node-url",
  description: "Read the current page URL",
  outputType: "string",
  fields: [],
  subtitle: "page.url",
};

export default UrlNode;
