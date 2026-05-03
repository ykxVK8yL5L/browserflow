import { Logs } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const LogNode: NodeTypeConfig = {
  type: "log",
  label: "Log",
  icon: Logs,
  color: "node-Set",
  description: "输出调试日志到执行日志面板，语法与 Stop 节点一致，支持模板变量",
  outputType: "object",
  fields: [
    {
      key: "level",
      label: "Level",
      type: "select",
      options: [
        { label: "Info", value: "info" },
        { label: "Debug", value: "debug" },
        { label: "Warn", value: "warn" },
        { label: "Error", value: "error" },
      ],
      defaultValue: "info",
      valueSource: "params",
    },
    {
      key: "message",
      label: "Message",
      type: "text",
      placeholder: "例如: ${test} / 当前结果: ${node1.result}",
      defaultValue: "",
      valueSource: "params",
    },
  ],
  subtitle: "{level}: {message}",
};

export default LogNode;
