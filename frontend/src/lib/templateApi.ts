import { apiCall } from "./apiUtils";

export interface TemplateSettings {
  feature_enabled: boolean;
  index_url: string;
}

export interface TemplateCategory {
  key: string;
  label: string;
  description: string;
}

export interface TemplateIndexItem {
  id: string;
  category: string;
  name: string;
  description: string;
  tags: string[];
  author: string;
  sort_order: number;
  path: string;
  url: string;
}

export interface TemplateIndexResponse {
  version: number;
  categories: TemplateCategory[];
  items: TemplateIndexItem[];
}

export interface TemplateFlow {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
}

export interface LocalTemplateIndexItem {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  created_at?: string;
  updated_at?: string;
}

export interface LocalTemplateIndexResponse {
  items: LocalTemplateIndexItem[];
}

export interface SaveLocalTemplateInput {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
}

export async function getTemplateSettings(): Promise<TemplateSettings> {
  return apiCall<TemplateSettings>("/api/templates/settings");
}

export async function updateTemplateSettings(input: Partial<TemplateSettings>): Promise<TemplateSettings> {
  return apiCall<TemplateSettings>("/api/templates/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getTemplateIndex(): Promise<TemplateIndexResponse> {
  return apiCall<TemplateIndexResponse>("/api/templates/index");
}

export async function getTemplateItem(templateId: string): Promise<TemplateFlow> {
  return apiCall<TemplateFlow>(`/api/templates/item?template_id=${encodeURIComponent(templateId)}`);
}

export async function getLocalTemplateIndex(): Promise<LocalTemplateIndexResponse> {
  return apiCall<LocalTemplateIndexResponse>("/api/templates/local/index");
}

export async function getLocalTemplateItem(templateId: string): Promise<TemplateFlow> {
  return apiCall<TemplateFlow>(`/api/templates/local/item?template_id=${encodeURIComponent(templateId)}`);
}

export async function saveLocalTemplate(input: SaveLocalTemplateInput): Promise<TemplateFlow> {
  return apiCall<TemplateFlow>("/api/templates/local/item", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteLocalTemplate(templateId: string): Promise<void> {
  await apiCall<void>(`/api/templates/local/item?template_id=${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}
