import { Scan } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ViewportNode: NodeTypeConfig = {
  type: "viewport",
  label: "Viewport",
  icon: Scan,
  color: "node-viewport",
  description: "Read the current page viewport size",
  outputType: "object",
  fields: [],
  subtitle: "page.viewport",
};

export default ViewportNode;
