import { FileText } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const FileNode: NodeTypeConfig = {
  type: "file",
  label: "File",
  icon: FileText,
  color: "node-file",
  description: "读取或写入服务器中的当前用户文件，仅允许访问 data/files/<user_id>/ 目录",
  outputType: "object",
  fields: [
    {
      key: "action",
      label: "操作",
      type: "select",
      options: [
        { label: "读取文件", value: "read" },
        { label: "写入文件", value: "write" },
      ],
      defaultValue: "read",
      valueSource: "params",
    },
    {
      key: "path",
      label: "相对路径",
      type: "text",
      placeholder: "docs/result.txt",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "sensitive",
      label: "敏感内容模式",
      type: "checkbox",
      defaultValue: false,
      valueSource: "params",
      placeholder: "启用后文件正文不写入日志/执行记录",
      visibleWhen: {
        action: "read",
      },
    },
    {
      key: "returnContent",
      label: "返回文件内容",
      type: "checkbox",
      defaultValue: true,
      valueSource: "params",
      placeholder: "关闭后不返回正文，仅返回路径/大小等元信息",
      visibleWhen: {
        action: "read",
      },
    },
    {
      key: "parseJson",
      label: "按 JSON 解析",
      type: "checkbox",
      defaultValue: false,
      valueSource: "params",
      placeholder: "启用后可使用 ${nodeId.content.key} 访问 JSON 字段",
      visibleWhen: {
        action: "read",
      },
    },
    {
      key: "content",
      label: "写入内容",
      type: "text",
      placeholder: "${node_xxx.result}",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "write",
      },
    },
    {
      key: "encoding",
      label: "编码",
      type: "text",
      placeholder: "utf-8",
      defaultValue: "utf-8",
      valueSource: "params",
    },
    {
      key: "createDirectories",
      label: "自动创建目录",
      type: "select",
      options: [
        { label: "是", value: "true" },
        { label: "否", value: "false" },
      ],
      defaultValue: "true",
      valueSource: "params",
      visibleWhen: {
        action: "write",
      },
    },
    {
      key: "overwrite",
      label: "允许覆盖",
      type: "select",
      options: [
        { label: "是", value: "true" },
        { label: "否", value: "false" },
      ],
      defaultValue: "true",
      valueSource: "params",
      visibleWhen: {
        action: "write",
      },
    },
  ],
  subtitle: "{action} {path}",
};

export default FileNode;