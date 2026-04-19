import { apiCall } from "./apiUtils";

export type NotificationEvent =
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "execution_cancelled";

export type FlowNotificationLevel =
  | "flow_result"
  | "node_results"
  | "node_results_with_data"
  | "raw_data";

export type SystemNotificationEvent = "user_login";

export type NotificationChannelType = "email" | "webhook";

export interface FlowNotificationRule {
  id: string;
  recipient_id?: string;
  name: string;
  type: NotificationChannelType;
  target: string;
  enabled: boolean;
  events: NotificationEvent[];
  level?: FlowNotificationLevel;
  headers?: Record<string, string>;
  secret?: string;
}

export interface FlowNotificationSettings {
  enabled: boolean;
  rules: FlowNotificationRule[];
}

export interface NotificationChannelConfig {
  id: string;
  channel_type: NotificationChannelType;
  display_name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  supported_events: NotificationEvent[];
}

export interface NotificationRecipient {
  id: string;
  name: string;
  type: NotificationChannelType;
  target: string;
  enabled: boolean;
  headers?: Record<string, string>;
  secret?: string;
  method?: string;
  body_template?: string;
}

export interface SystemNotificationRule {
  event: SystemNotificationEvent;
  label: string;
  enabled: boolean;
  recipient_ids: string[];
}

export interface NotificationChannelDefinition {
  type: NotificationChannelType;
  label: string;
  fields: Array<{
    name: string;
    label: string;
    required: boolean;
  }>;
}

export interface NotificationSettingsResponse {
  channels: NotificationChannelConfig[];
  recipients: NotificationRecipient[];
  channel_definitions: NotificationChannelDefinition[];
  event_options: Array<{
    value: NotificationEvent;
    label: string;
  }>;
  system_event_options: Array<{
    value: SystemNotificationEvent;
    label: string;
  }>;
  system_rules: SystemNotificationRule[];
}

export interface NotificationTestSendInput {
  title: string;
  content: string;
  recipient_ids: string[];
  send_to_all: boolean;
}

export interface NotificationTestSendResult {
  recipient_id?: string;
  name?: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
}

export interface NotificationTestSendResponse {
  target_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  details: NotificationTestSendResult[];
}

export async function getNotificationSettings(): Promise<NotificationSettingsResponse> {
  return apiCall<NotificationSettingsResponse>("/api/notifications/settings");
}

export async function updateNotificationChannel(
  channelType: NotificationChannelType,
  input: Partial<Pick<NotificationChannelConfig, "enabled" | "display_name" | "config">>
): Promise<NotificationChannelConfig> {
  return apiCall<NotificationChannelConfig>(`/api/notifications/settings/channels/${channelType}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function updateNotificationRecipients(
  recipients: NotificationRecipient[]
): Promise<NotificationRecipient[]> {
  return apiCall<NotificationRecipient[]>(`/api/notifications/settings/recipients/items`, {
    method: "PUT",
    body: JSON.stringify(recipients),
  });
}

export async function updateSystemNotificationRules(
  rules: SystemNotificationRule[]
): Promise<SystemNotificationRule[]> {
  return apiCall<SystemNotificationRule[]>(`/api/notifications/settings/system/rules`, {
    method: "PUT",
    body: JSON.stringify(rules),
  });
}

export async function sendNotificationTest(
  input: NotificationTestSendInput
): Promise<NotificationTestSendResponse> {
  return apiCall<NotificationTestSendResponse>(`/api/notifications/settings/test/send`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
