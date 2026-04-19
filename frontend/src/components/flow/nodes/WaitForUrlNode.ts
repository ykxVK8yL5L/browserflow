import { Link2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const WaitForUrlNode: NodeTypeConfig = {
  type: "waitForURL",
  label: "Wait For URL",
  icon: Link2,
  color: "node-waitForURL",
  description: "Wait until the page URL matches a target value",
  outputType: "void",
  fields: [
    {
      key: "url",
      label: "URL / Pattern",
      type: "text",
      placeholder: "https://example.com/dashboard",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "waitUntil",
      label: "Wait Until",
      type: "select",
      options: [
        { label: "Load", value: "load" },
        { label: "DOM Content Loaded", value: "domcontentloaded" },
        { label: "Network Idle", value: "networkidle" },
        { label: "Commit", value: "commit" },
      ],
      defaultValue: "load",
      valueSource: "params",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "30000",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{url}",
};

export default WaitForUrlNode;
