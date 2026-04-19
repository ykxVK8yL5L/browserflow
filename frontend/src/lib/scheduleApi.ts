import { apiCall } from "./apiUtils";

export type ScheduleTriggerType = "cron" | "interval" | "once";

export interface Schedule {
  id: string;
  user_id: string;
  flow_id: string;
  identity_id?: string;
  name: string;
  enabled: boolean;
  trigger_type: ScheduleTriggerType;
  cron_expression?: string;
  interval_seconds?: number;
  run_at?: string;
  run_settings?: Record<string, unknown>;
  last_run_at?: string;
  next_run_at?: string;
  last_execution_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  name: string;
  flow_id: string;
  identity_id?: string;
  enabled: boolean;
  trigger_type: ScheduleTriggerType;
  cron_expression?: string;
  interval_seconds?: number;
  run_at?: string;
  run_settings?: Record<string, unknown>;
}

export async function getSchedules(flowId?: string): Promise<Schedule[]> {
  const query = flowId ? `?flow_id=${encodeURIComponent(flowId)}` : "";
  return apiCall<Schedule[]>(`/api/schedules${query}`);
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  return apiCall<Schedule>("/api/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSchedule(
  id: string,
  input: Partial<ScheduleInput>
): Promise<Schedule> {
  return apiCall<Schedule>(`/api/schedules/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<Schedule> {
  return apiCall<Schedule>(`/api/schedules/${id}/toggle`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function runScheduleNow(id: string): Promise<Schedule> {
  return apiCall<Schedule>(`/api/schedules/${id}/run-now`, {
    method: "POST",
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await apiCall(`/api/schedules/${id}`, {
    method: "DELETE",
  });
}
