import { Braces } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const SetNode: NodeTypeConfig = {
  type: "set",
  label: "Set",
  icon: Braces,
  color: "node-Set",
  description: "声明或更新流程变量，支持在后续节点和 foreach 中持续读写",
  inputDefs: [
    { key: "value", label: "Value Reference", description: "可引用上游输出、foreach item 或变量" },
  ],
  outputType: "object",
  fields: [
    {
      key: "variableName",
      label: "Variable Name",
      type: "text",
      placeholder: "results",
      defaultValue: "results",
      valueSource: "params",
    },
    {
      key: "operation",
      label: "Operation",
      type: "select",
      options: [
        { label: "Set", value: "set" },
        { label: "Append", value: "append" },
        { label: "Merge", value: "merge" },
        { label: "Clear", value: "clear" },
      ],
      defaultValue: "set",
      valueSource: "params",
    },
    {
      key: "valueType",
      label: "Value Type",
      type: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "String", value: "string" },
        { label: "Number", value: "number" },
        { label: "Boolean", value: "boolean" },
        { label: "Array", value: "array" },
        { label: "Object", value: "object" },
        { label: "Null", value: "null" },
      ],
      defaultValue: "auto",
      valueSource: "params",
    },
    {
      key: "value",
      label: "Literal Value",
      type: "text",
      placeholder: "[] / {} / hello",
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "{variableName} ← {operation}",
};

export default SetNode;