import { Mail } from "lucide-react";
import { type NodeTypeConfig } from "../nodeTypes";

const EmailNode: NodeTypeConfig = {
  type: "email",
  label: "Email",
  icon: Mail,
  color: "node-httpRequest",
  description: "邮箱相关节点；按 provider 分发，支持获取地址与获取邮件",
  outputType: "object",
  fields: [
    {
      key: "action",
      label: "Action",
      type: "select",
      options: [
        { label: "获取邮箱地址", value: "get_address" },
        { label: "获取邮件", value: "get_email" },
      ],
      defaultValue: "get_address",
      valueSource: "params",
    },
    {
      key: "emailAddress",
      label: "Email Address",
      type: "text",
      placeholder: "name@example.com / ${mailNode.emailAddress}",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "provider",
      label: "Provider",
      type: "select",
      options: [
        { label: "IMAP", value: "imap" },
        { label: "Inboxes", value: "inboxes" },
        { label: "Generator.Email", value: "generator.email" },
      ],
      defaultValue: "imap",
      valueSource: "params",
    },
    {
      key: "addressType",
      label: "Address Type",
      type: "select",
      options: [
        { label: "主地址", value: "primary" },
        { label: "别名", value: "alias" },
      ],
      defaultValue: "primary",
      valueSource: "params",
      visibleWhen: {
        action: "get_address",
      },
    },
    {
      key: "accountTag",
      label: "Account Tag",
      type: "text",
      placeholder: "可选，用于限定某类邮箱账号",
      defaultValue: "",
      valueSource: "params",
    },
    {
      key: "aliasLabel",
      label: "Alias Label",
      type: "text",
      placeholder: "可选，生成别名时用于备注或后续扩展",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_address",
        addressType: "alias",
      },
    },
    {
      key: "folder",
      label: "Folder",
      type: "text",
      placeholder: "INBOX",
      defaultValue: "INBOX",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "from",
      label: "From",
      type: "text",
      placeholder: "noreply@example.com",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "subject",
      label: "Subject",
      type: "text",
      placeholder: "验证码 / Verify your account",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "contains",
      label: "Contains",
      type: "text",
      placeholder: "正文包含的文本",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "timeMode",
      label: "Time Mode",
      type: "select",
      options: [
        { label: "不限制", value: "none" },
        { label: "绝对时间", value: "absolute" },
        { label: "节点时间锚点", value: "node_anchor" },
      ],
      defaultValue: "none",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "sinceTime",
      label: "Since Time",
      type: "text",
      placeholder: "2026-05-03T12:00:00Z",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        timeMode: "absolute",
      },
    },
    {
      key: "anchorNodeId",
      label: "Anchor Node ID",
      type: "text",
      placeholder: "sendCodeNode",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        timeMode: "node_anchor",
      },
    },
    {
      key: "anchorField",
      label: "Anchor Field",
      type: "select",
      options: [
        { label: "startedAt", value: "startedAt" },
        { label: "finishedAt", value: "finishedAt" },
      ],
      defaultValue: "finishedAt",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        timeMode: "node_anchor",
      },
    },
    {
      key: "lookbackSeconds",
      label: "Lookback Seconds",
      type: "number",
      defaultValue: 0,
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        timeMode: "node_anchor",
      },
    },
    {
      key: "waitTimeoutSeconds",
      label: "Wait Timeout (s)",
      type: "number",
      defaultValue: 30,
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "pollIntervalSeconds",
      label: "Poll Interval (s)",
      type: "number",
      defaultValue: 3,
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "extractMode",
      label: "Extract Mode",
      type: "select",
      options: [
        { label: "不提取", value: "none" },
        { label: "正则提取", value: "regex" },
      ],
      defaultValue: "none",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
      },
    },
    {
      key: "extractFrom",
      label: "Extract From",
      type: "select",
      options: [
        { label: "正文 text", value: "text" },
        { label: "HTML", value: "html" },
        { label: "标题 subject", value: "subject" },
      ],
      defaultValue: "text",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        extractMode: "regex",
      },
    },
    {
      key: "regexPattern",
      label: "Regex Pattern",
      type: "text",
      placeholder: "验证码[:：\\s]*([0-9]{6})",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        extractMode: "regex",
      },
    },
    {
      key: "regexFlags",
      label: "Regex Flags",
      type: "text",
      placeholder: "i",
      defaultValue: "",
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        extractMode: "regex",
      },
    },
    {
      key: "groupIndex",
      label: "Group Index",
      type: "number",
      defaultValue: 1,
      valueSource: "params",
      visibleWhen: {
        action: "get_email",
        extractMode: "regex",
      },
    },
    {
      key: "multiMatch",
      label: "Multi Match",
      type: "checkbox",
      defaultValue: false,
      valueSource: "params",
      placeholder: "启用后返回全部匹配结果",
      visibleWhen: {
        action: "get_email",
        extractMode: "regex",
      },
    },
  ],
  subtitle: "{action} {provider} {emailAddress}",
};

export default EmailNode;