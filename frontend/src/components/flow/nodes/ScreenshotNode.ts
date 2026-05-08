import { Camera } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ScreenshotNode: NodeTypeConfig = {
  type: "screenshot",
  label: "Screenshot",
  icon: Camera,
  color: "node-screenshot",
  description: "Capture the page",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "可选。引用上游 locator 时截取元素；留空时截取页面" },
  ],
  fields: [],
  subtitle: "capture",
};

export default ScreenshotNode;
