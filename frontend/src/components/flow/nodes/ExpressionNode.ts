import { Braces } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ExpressionNode: NodeTypeConfig = {
  type: "expression",
  label: "Expression",
  icon: Braces,
  color: "node-Set",
  description: "使用安全表达式计算值，适合长度、索引、算术、条件判断，以及 strip/split/join 等常用处理场景",
  inputDefs: [{ key: "value", label: "Value", description: "可选主输入，可在表达式中通过 value 使用" }],
  outputType: "object",
  fields: [
    {
      key: "expression",
      label: "Expression",
      type: "text",
      placeholder: "len(results) / split(value, ',') / join(items, '-') / a if cond else b",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "variableName",
      label: "Save To Variable",
      type: "text",
      placeholder: "result",
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "{expression}",
};

export default ExpressionNode;