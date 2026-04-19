import { ListOrdered } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const ForNode: NodeTypeConfig = {
  type: "for",
  label: "For",
  icon: ListOrdered,
  color: "node-for",
  description: "按数值区间循环执行 body 分支，结束后走 done 分支",
  inputDefs: [
    { key: "start", label: "Start Reference", description: "可选，引用起始值" },
    { key: "end", label: "End Reference", description: "可选，引用结束值" },
    { key: "step", label: "Step Reference", description: "可选，引用步长" },
  ],
  fields: [
    {
      key: "variableName",
      label: "Variable Name",
      type: "text",
      placeholder: "i",
      defaultValue: "i",
      valueSource: "params",
    },
    {
      key: "start",
      label: "Start",
      type: "number",
      placeholder: "0",
      defaultValue: 0,
      valueSource: "params",
    },
    {
      key: "end",
      label: "End",
      type: "number",
      placeholder: "10",
      defaultValue: 10,
      valueSource: "params",
    },
    {
      key: "step",
      label: "Step",
      type: "number",
      placeholder: "1",
      defaultValue: 1,
      valueSource: "params",
    },
    {
      key: "inclusive",
      label: "Inclusive",
      type: "select",
      options: [
        { label: "False", value: "false" },
        { label: "True", value: "true" },
      ],
      defaultValue: "false",
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
  subtitle: "{variableName} from {start} to {end}",
};

export default ForNode;
