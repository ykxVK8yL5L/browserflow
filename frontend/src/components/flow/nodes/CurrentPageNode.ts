import { MonitorSmartphone } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const CurrentPageNode: NodeTypeConfig = {
  type: "currentPage",
  label: "Current Page",
  icon: MonitorSmartphone,
  color: "node-default",
  description: "Read the current active page name, URL, and available page list",
  outputType: "object",
  fields: [],
  subtitle: "page.current",
};

export default CurrentPageNode;