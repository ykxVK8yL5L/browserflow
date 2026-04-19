import { LoaderCircle } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const WaitForLoadStateNode: NodeTypeConfig = {
  type: "waitForLoadState",
  label: "Wait For Load State",
  icon: LoaderCircle,
  color: "node-waitForLoadState",
  description: "Wait until the page reaches a specific load state",
  outputType: "void",
  fields: [
    {
      key: "state",
      label: "Load State",
      type: "select",
      options: [
        { label: "Load", value: "load" },
        { label: "DOM Content Loaded", value: "domcontentloaded" },
        { label: "Network Idle", value: "networkidle" },
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
  subtitle: "{state}",
};

export default WaitForLoadStateNode;
