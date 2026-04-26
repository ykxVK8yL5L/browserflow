import { type LucideIcon } from "lucide-react";
import { nodeRegistry } from "./nodes";

export interface NodeField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "list" | "checkbox";
  valueSource?: "data" | "params";
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string | number | boolean;
  listSchema?: NodeField[];
  visibleWhen?: Record<string, string | number | boolean>;
}

export interface NodeInputDef {
  key: string;
  label: string;
  description?: string;
}

export type FlowOutputType =
  | "void"
  | "locator"
  | "locator[]"
  | "string"
  | "number"
  | "boolean"
  | "array"
  | "object";

export interface NodeTypeConfig {
  type: string;
  label: string;
  icon: LucideIcon;
  color?: string; // 可选，默认使用 "node-default"
  description: string;
  fields: NodeField[];
  inputDefs?: NodeInputDef[];
  outputType?: FlowOutputType;
  subtitle?: string;
}

/** 默认节点颜色 */
const DEFAULT_NODE_COLOR = "node-default";

/** 获取节点颜色（带默认值） */
export function getNodeColor(config: NodeTypeConfig): string {
  return config.color || DEFAULT_NODE_COLOR;
}

/** All registered node types — sourced from nodes/ folder */
export const NODE_TYPES_CONFIG: NodeTypeConfig[] = nodeRegistry;

/** Build default data object from a config's fields */
export function buildDefaultData(config: NodeTypeConfig): Record<string, unknown> {
  const data: Record<string, unknown> = {
    params: {},
    inputs: {},
    stopOnFailure: true, // 默认失败时停止执行
  };

  if (config.outputType) {
    data.outputType = config.outputType;
  }

  for (const field of config.fields) {
    if (field.type === "list" && field.listSchema) {
      data[field.key] = [];
      (data.params as Record<string, unknown>)[field.key] = [];
    } else if (field.defaultValue !== undefined) {
      data[field.key] = field.defaultValue;
      (data.params as Record<string, unknown>)[field.key] = field.defaultValue;
    }
  }
  return data;
}

/** Resolve subtitle template with node data */
export function resolveSubtitle(config: NodeTypeConfig, data: Record<string, unknown>): string {
  if (!config.subtitle) return "";
  const params = (data.params as Record<string, unknown> | undefined) ?? {};
  return config.subtitle.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? data[key] ?? ""));
}
