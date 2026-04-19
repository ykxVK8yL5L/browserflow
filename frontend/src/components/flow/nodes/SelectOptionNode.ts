import { ListChecks } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";
import { selectorFields } from "./shared/selectorFields";

const SelectOptionNode: NodeTypeConfig = {
  type: "selectOption",
  label: "Select Option",
  icon: ListChecks,
  color: "node-selectOption",
  description: "Select an option in a dropdown",
  inputDefs: [
    { key: "target", label: "Target Reference", description: "引用 locator 节点输出" },
    { key: "value", label: "Value Reference", description: "引用上游选项值输出" },
  ],
  outputType: "void",
  fields: [
    ...selectorFields,
    {
      key: "value",
      label: "Value",
      type: "text",
      placeholder: "option-value",
      defaultValue: "",
    },
    {
      key: "timeout",
      label: "Timeout",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{value}",
};

export default SelectOptionNode;
