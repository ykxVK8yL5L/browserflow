import { Dices } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const RandomNode: NodeTypeConfig = {
  type: "random",
  label: "Random",
  icon: Dices,
  color: "node-Set",
  description: "生成随机字符串或 UUID，并可保存为流程变量供后续节点重复使用",
  outputType: "object",
  fields: [
    {
      key: "kind",
      label: "Random Type",
      type: "select",
      options: [
        { label: "字母数字", value: "alnum" },
        { label: "纯字母", value: "alpha" },
        { label: "纯数字", value: "numeric" },
        { label: "十六进制", value: "hex" },
        { label: "密码", value: "password" },
        { label: "强密码（微软规则）", value: "ms_password" },
        { label: "UUID", value: "uuid" },
      ],
      defaultValue: "alnum",
      valueSource: "params",
    },
    {
      key: "length",
      label: "Length",
      type: "number",
      placeholder: "12",
      defaultValue: 12,
      valueSource: "params",
    },
    {
      key: "count",
      label: "Count",
      type: "number",
      placeholder: "1",
      defaultValue: 1,
      valueSource: "params",
    },
    {
      key: "min",
      label: "Min Range",
      type: "number",
      placeholder: "0",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "max",
      label: "Max Range",
      type: "number",
      placeholder: "100",
      defaultValue: 100,
      valueSource: "params",
    },
    {
      key: "specialChars",
      label: "Special Chars",
      type: "text",
      placeholder: "!@#$%^&*",
      defaultValue: "!@#$%^&*",
      valueSource: "params",
    },
    {
      key: "variableName",
      label: "Save To Variable",
      type: "text",
      placeholder: "accounts",
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "{kind} × {count}",
};

export default RandomNode;
