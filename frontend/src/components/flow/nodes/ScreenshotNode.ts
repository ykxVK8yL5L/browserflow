import { Camera } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ScreenshotNode: NodeTypeConfig = {
  type: "screenshot",
  label: "Screenshot",
  icon: Camera,
  color: "node-screenshot",
  description: "Capture the page",
  fields: [],
  subtitle: "capture",
};

export default ScreenshotNode;
