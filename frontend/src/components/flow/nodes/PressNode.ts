import { KeyboardIcon } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const PressNode: NodeTypeConfig = {
  type: "press",
  label: "Press Key",
  icon: KeyboardIcon,
  color: "node-press",
  description: "Press a keyboard key on a target element or the current page",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
    { key: "key", label: "Key Reference", description: "引用上游按键文本输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    {
      key: "key",
      label: "Key",
      type: "text",
      placeholder: "Enter",
      defaultValue: "Enter",
    },
    {
      key: "delay",
      label: "Delay",
      type: "number",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{key}",
};

export default PressNode;
