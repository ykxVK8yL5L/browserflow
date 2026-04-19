import { GitBranch } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const IfNode: NodeTypeConfig = {
  type: "if",
  label: "If Condition",
  icon: GitBranch,
  color: "node-logic",
  description: "Evaluate a condition using input value + operator, or fallback to expression mode",
  inputDefs: [
    { key: "condition", label: "Condition Reference", description: "引用上游输出作为判断左值（可选，优先于左值字段）" },
  ],
  fields: [
    {
      key: "leftValue",
      label: "Left Value",
      type: "text",
      placeholder: "${nodeId.field} 或直接输入值",
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
      defaultValue: "==",
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
      placeholder: "${nodeId.field} == 'value'",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "onError",
      label: "On Error",
      type: "select",
      options: [
        { label: "Fail Node", value: "fail" },
        { label: "Return False", value: "false" },
      ],
      defaultValue: "fail",
      valueSource: "params",
    },
  ],
  subtitle: "if {operator} {value}",
};

export default IfNode;
