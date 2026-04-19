import { Cookie } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const CookieNode: NodeTypeConfig = {
  type: "cookie",
  label: "Cookie",
  icon: Cookie,
  color: "node-default",
  description: "获取或设置浏览器 Cookie",
  fields: [
    {
      key: "action",
      label: "操作",
      type: "select",
      options: [
        { value: "get", label: "获取 Cookie" },
        { value: "set", label: "设置 Cookie" },
        { value: "clear", label: "清除 Cookie" },
      ],
      defaultValue: "get",
    },
    {
      key: "url",
      label: "URL (可选)",
      type: "text",
      placeholder: "https://example.com",
      defaultValue: "",
    },
    {
      key: "name",
      label: "Cookie 名称",
      type: "text",
      placeholder: "session_id",
      defaultValue: "",
    },
    {
      key: "value",
      label: "Cookie 值",
      type: "text",
      placeholder: "abc123",
      defaultValue: "",
    },
    {
      key: "path",
      label: "路径",
      type: "text",
      placeholder: "/",
      defaultValue: "/",
    },
    {
      key: "domain",
      label: "域名",
      type: "text",
      placeholder: ".example.com",
      defaultValue: "",
    },
    {
      key: "expires",
      label: "过期时间 (秒)",
      type: "number",
      placeholder: "3600",
      defaultValue: "",
    },
    {
      key: "secure",
      label: "Secure",
      type: "select",
      options: [
        { value: "", label: "默认" },
        { value: "true", label: "是" },
        { value: "false", label: "否" },
      ],
      defaultValue: "",
    },
    {
      key: "httpOnly",
      label: "HttpOnly",
      type: "select",
      options: [
        { value: "", label: "默认" },
        { value: "true", label: "是" },
        { value: "false", label: "否" },
      ],
      defaultValue: "",
    },
    {
      key: "sameSite",
      label: "SameSite",
      type: "select",
      options: [
        { value: "", label: "默认" },
        { value: "Strict", label: "Strict" },
        { value: "Lax", label: "Lax" },
        { value: "None", label: "None" },
      ],
      defaultValue: "",
    },
  ],
  subtitle: "{action}",
};

export default CookieNode;
