import { Globe } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const HttpRequestNode: NodeTypeConfig = {
  type: "httpRequest",
  label: "HTTP Request",
  icon: Globe,
  color: "node-httpRequest",
  description: "Send an HTTP request and return status, headers, and response body",
  outputType: "object",
  fields: [
    {
      key: "method",
      label: "Method",
      type: "select",
      options: [
        { label: "GET", value: "GET" },
        { label: "POST", value: "POST" },
        { label: "PUT", value: "PUT" },
        { label: "PATCH", value: "PATCH" },
        { label: "DELETE", value: "DELETE" },
        { label: "HEAD", value: "HEAD" },
        { label: "OPTIONS", value: "OPTIONS" },
      ],
      defaultValue: "GET",
      valueSource: "params",
    },
    {
      key: "url",
      label: "URL",
      type: "text",
      placeholder: "https://api.example.com/data",
      defaultValue: "https://httpbin.org/get",
      valueSource: "params",
    },
    {
      key: "headers",
      label: "Headers JSON",
      type: "text",
      placeholder: '{"Authorization":"Bearer xxx"}',
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "query",
      label: "Query JSON",
      type: "text",
      placeholder: '{"page":1,"size":10}',
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "bodyType",
      label: "Body Type",
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "JSON", value: "json" },
        { label: "Text", value: "text" },
        { label: "Form", value: "form" },
      ],
      defaultValue: "json",
      valueSource: "params",
    },
    {
      key: "body",
      label: "Body",
      type: "text",
      placeholder: '{"name":"BrowserFlow"}',
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "responseType",
      label: "Response Type",
      type: "select",
      options: [
        { label: "Auto", value: "auto" },
        { label: "JSON", value: "json" },
        { label: "Text", value: "text" },
      ],
      defaultValue: "auto",
      valueSource: "params",
    },
    {
      key: "followRedirects",
      label: "Follow Redirects",
      type: "select",
      options: [
        { label: "True", value: "true" },
        { label: "False", value: "false" },
      ],
      defaultValue: "true",
      valueSource: "params",
    },
    {
      key: "timeout",
      label: "Timeout (ms)",
      type: "number",
      defaultValue: 30000,
      valueSource: "params",
    },
  ],
  subtitle: "{method} {url}",
};

export default HttpRequestNode;