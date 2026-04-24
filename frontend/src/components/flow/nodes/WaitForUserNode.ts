import { MessageSquareMore } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const WaitForUserNode: NodeTypeConfig = {
  type: "waitForUser",
  label: "Wait For User",
  icon: MessageSquareMore,
  color: "node-wait",
  description: "暂停流程并等待用户在前端输入内容后继续执行",
  inputDefs: [
    { key: "title", label: "Title Reference", description: "可选，动态标题" },
    { key: "message", label: "Message Reference", description: "可选，动态提示内容" },
    { key: "placeholder", label: "Placeholder Reference", description: "可选，动态占位提示" },
    { key: "defaultValue", label: "Default Value Reference", description: "可选，动态默认值" },
  ],
  outputType: "object",
  fields: [
    {
      key: "title",
      label: "Title",
      type: "text",
      placeholder: "Enter verification code",
      defaultValue: "Waiting for user input",
      valueSource: "params",
    },
    {
      key: "message",
      label: "Message",
      type: "text",
      placeholder: "Please enter the value to continue",
      defaultValue: "Please provide the required value to continue execution.",
      valueSource: "params",
    },
    {
      key: "inputType",
      label: "Input Type",
      type: "select",
      options: [
        { label: "Text", value: "text" },
        { label: "Textarea", value: "textarea" },
        { label: "Password", value: "password" },
      ],
      defaultValue: "text",
      valueSource: "params",
    },
    {
      key: "placeholder",
      label: "Placeholder",
      type: "text",
      placeholder: "123456",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "defaultValue",
      label: "Default Value",
      type: "text",
      placeholder: "",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "confirmText",
      label: "Confirm Button",
      type: "text",
      placeholder: "Submit",
      defaultValue: "Submit",
      valueSource: "params",
    },
    {
      key: "cancelText",
      label: "Cancel Button",
      type: "text",
      placeholder: "Cancel",
      defaultValue: "Cancel",
      valueSource: "params",
    },
    {
      key: "required",
      label: "Required",
      type: "checkbox",
      placeholder: "必须输入后才能继续",
      defaultValue: true,
      valueSource: "params",
    },
    {
      key: "timeoutMs",
      label: "Timeout (ms)",
      type: "number",
      placeholder: "0",
      defaultValue: 0,
      valueSource: "params",
    },
  ],
  subtitle: "{inputType}",
};

export default WaitForUserNode;