import { 
  fetchUserAgents, 
  createUserAgent, 
  updateUserAgent, 
  deleteUserAgent, 
  type UserAgent 
} from "./userAgentApi";

// ─── State ──────────────────────────────────────────────

let userAgents: UserAgent[] = [];

// ─── Actions ────────────────────────────────────────────
export type { UserAgent };

export async function loadUserAgents(): Promise<UserAgent[]> {
  userAgents = await fetchUserAgents();
  return userAgents;
}

export async function addUserAgent(value: string, isDefault: boolean = false): Promise<UserAgent> {
  const ua = await createUserAgent({ value, is_default: isDefault });
  userAgents = await fetchUserAgents(); // 刷新列表
  return ua;
}

export async function editUserAgent(id: string, value: string, isDefault: boolean): Promise<UserAgent> {
  const ua = await updateUserAgent(id, { value, is_default: isDefault });
  userAgents = await fetchUserAgents(); // 刷新列表
  return ua;
}

export async function removeUserAgent(id: string): Promise<void> {
  await deleteUserAgent(id);
  userAgents = await fetchUserAgents(); // 刷新列表
}

export function getUserAgents(): UserAgent[] {
  return userAgents;
}

export function getDefaultUserAgent(): UserAgent | undefined {
  return userAgents.find(ua => ua.is_default);
}
