import { RotateCw } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const WhileNode: NodeTypeConfig = {
  type: "while",
  label: "While",
  icon: RotateCw,
  color: "node-while",
  description: "当条件为真时重复执行 body 分支，结束后走 done 分支",
  inputDefs: [
    { key: "condition", label: "Condition Reference", description: "引用上游输出作为判断左值（可选，优先于左值字段）" },
  ],
  fields: [
    {
      key: "leftValue",
      label: "Left Value",
      type: "text",
      placeholder: "变量名或 ${nodeId.field}",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "leftValueType",
      label: "Left Value Type",
      type: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "String", value: "string" },
        { label: "Number", value: "number" },
        { label: "Boolean", value: "boolean" },
        { label: "Null", value: "null" },
        { label: "JSON", value: "json" },
      ],
      defaultValue: "auto",
      valueSource: "params",
    },
    {
      key: "operator",
      label: "Operator",
      type: "select",
      options: [
        { label: "==", value: "==" },
        { label: "!=", value: "!=" },
        { label: ">", value: ">" },
        { label: ">=", value: ">=" },
        { label: "<", value: "<" },
        { label: "<=", value: "<=" },
        { label: "contains", value: "contains" },
        { label: "not contains", value: "not_contains" },
        { label: "truthy", value: "truthy" },
        { label: "falsy", value: "falsy" },
      ],
      defaultValue: "truthy",
      valueSource: "params",
    },
    {
      key: "value",
      label: "Right Value",
      type: "text",
      placeholder: "0",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "valueType",
      label: "Right Value Type",
      type: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "String", value: "string" },
        { label: "Number", value: "number" },
        { label: "Boolean", value: "boolean" },
        { label: "Null", value: "null" },
        { label: "JSON", value: "json" },
      ],
      defaultValue: "auto",
      valueSource: "params",
    },
    {
      key: "condition",
      label: "Legacy Expression",
      type: "text",
      placeholder: "${nodeId.field} > 0",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "maxIterations",
      label: "Max Iterations",
      type: "number",
      placeholder: "1000",
      defaultValue: 1000,
      valueSource: "params",
    },
  ],
  subtitle: "while {leftValue} {operator} {value}",
};

export default WhileNode;
