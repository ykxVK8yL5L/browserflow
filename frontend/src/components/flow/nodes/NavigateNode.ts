import { Globe } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const NavigateNode: NodeTypeConfig = {
  type: "navigate",
  label: "Navigate",
  icon: Globe,
  color: "node-navigate",
  description: "Go to a URL",
  fields: [
    { key: "url", label: "URL", type: "text", placeholder: "https://example.com", defaultValue: "https://example.com" },
  ],
  subtitle: "{url}",
};

export default NavigateNode;
