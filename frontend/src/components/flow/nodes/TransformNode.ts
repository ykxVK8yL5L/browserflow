import { Wand2 } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const TransformNode: NodeTypeConfig = {
  type: "transform",
  label: "Transform",
  icon: Wand2,
  color: "node-Set",
  description: "对输入值应用内置模板函数（与 ${ns.fn(...)} 同源），避免为每个小能力新增专用节点",
  inputDefs: [{ key: "value", label: "Value", description: "要转换的输入值（可引用上游输出/变量）" }],
  outputType: "object",
  fields: [
    {
      key: "fn",
      label: "Function",
      type: "select",
      options: [
        { label: "JSON Parse (json.parse)", value: "json.parse" },
        { label: "JSON Dumps (json.dumps)", value: "json.dumps" },
        { label: "JSON Get (json.get)", value: "json.get" },
        { label: "Regex Match (regex.match)", value: "regex.match" },
        { label: "Regex Find All (regex.findall)", value: "regex.findall" },
        { label: "Regex Find All Detail (regex.findall_detail)", value: "regex.findall_detail" },
        { label: "Regex Replace (regex.replace)", value: "regex.replace" },
        { label: "Regex Split (regex.split)", value: "regex.split" },
        { label: "Regex Test (regex.test)", value: "regex.test" },
        { label: "Time Now (time.now)", value: "time.now" },
        { label: "Epoch MS (time.epoch_ms)", value: "time.epoch_ms" },
        { label: "Time Format (time.format)", value: "time.format" },
        { label: "Time Add MS (time.add_ms)", value: "time.add_ms" },
      ],
      defaultValue: "json.parse",
      valueSource: "params",
    },
    {
      key: "args",
      label: "Args (after value)",
      type: "list",
      valueSource: "params",
      listSchema: [
        {
          key: "arg",
          label: "Arg",
          type: "text",
          placeholder: "e.g. $.path / \\d+ / replacement / %Y-%m-%d / 2",
          valueSource: "data",
        },
      ],
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
  subtitle: "{fn}",
};

export default TransformNode;
