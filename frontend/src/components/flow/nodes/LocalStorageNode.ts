import { Database } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const LocalStorageNode: NodeTypeConfig = {
  type: "localstorage",
  label: "LocalStorage",
  icon: Database,
  color: "node-default",
  description: "获取、设置或清除浏览器 localStorage",
  fields: [
    {
      key: "action",
      label: "操作",
      type: "select",
      options: [
        { value: "get", label: "获取" },
        { value: "set", label: "设置" },
        { value: "clear", label: "清除" },
      ],
      defaultValue: "get",
    },
    {
      key: "key",
      label: "Key",
      type: "text",
      placeholder: "token",
      defaultValue: "",
    },
    {
      key: "value",
      label: "Value",
      type: "text",
      placeholder: "your value",
      defaultValue: "",
    },
  ],
  subtitle: "{action} {key}",
};

export default LocalStorageNode;