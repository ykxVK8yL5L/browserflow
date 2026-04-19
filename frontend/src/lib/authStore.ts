/**
 * 认证存储 - 连接后端 API
 *
 * 所有认证数据现在存储在数据库中，通过 API 调用
 */

// 动态获取 API 地址：优先使用环境变量，否则使用当前域名
// const getApiBase = () => {
//   if (import.meta.env.VITE_API_BASE) {
//     return import.meta.env.VITE_API_BASE;
//   }
//   // 开发环境使用 localhost:8000
//   if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
//     return "http://localhost:8000";
//   }
//   // 其他环境使用当前访问的地址
//   return `${window.location.protocol}//${window.location.hostname}:8000`;
// };

// const API_BASE = getApiBase();

// ─── Types ──────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  role: string;
  email?: string;
  emailVerified: boolean;
  otpEnabled: boolean;
  passkeyEnabled: boolean;
  createdAt: string;
}

export interface AuthSettings {
  registrationEnabled: boolean;
  passkeyLoginEnabled: boolean;
  otpRequired: boolean;
}

export interface Session {
  id: string;
  userAgent?: string;
  user_agent?: string;  // 后端返回的 snake_case 格式
  ipAddress?: string;
  ip_address?: string;  // 后端返回的 snake_case 格式
  active: boolean;
  createdAt: string;
  created_at?: string;  // 后端返回的 snake_case 格式
  lastActive?: string;
  last_active?: string;  // 后端返回的 snake_case 格式
  expiresAt?: string;
  expires_at?: string;  // 后端返回的 snake_case 格式
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  expiresAt?: string;
  lastUsed?: string;
  revoked: boolean;
}

// ─── Storage Keys ───────────────────────────────────────

const SESSION_KEY = "bf_session";

interface StoredSession {
  userId: string;
  username: string;
  role: string;
  sessionId: string;
  token: string;
}

// ─── Helper Functions ───────────────────────────────────

async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getSession()?.token;
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  
  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${endpoint}`, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || "Request failed");
  }
  
  return response.json();
}

// ─── Auth Settings ──────────────────────────────────────

export async function getAuthSettings(): Promise<AuthSettings> {
  try {
    const res = await apiCall<{
      registration_enabled: boolean;
      passkey_login_enabled: boolean;
      otp_required: boolean;
    }>("/api/auth/settings");
    
    return {
      registrationEnabled: res.registration_enabled,
      passkeyLoginEnabled: res.passkey_login_enabled,
      otpRequired: res.otp_required,
    };
  } catch {
    return {
      registrationEnabled: true,
      passkeyLoginEnabled: false,
      otpRequired: true,
    };
  }
}

export async function hasAnyUsers(): Promise<boolean> {
  try {
    const res = await apiCall<{ hasUsers: boolean }>("/api/auth/has-users");
    return res.hasUsers;
  } catch {
    return false;
  }
}

// ─── Session Management ─────────────────────────────────

function getSession(): StoredSession | null {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// ─── Registration ───────────────────────────────────────

export async function register(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiCall<{
      ok: boolean;
      user: User;
      token: string;
      sessionId: string;
    }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    
    if (res.ok && res.user) {
      saveSession({
        userId: res.user.id,
        username: res.user.username,
        role: res.user.role,
        sessionId: res.sessionId,
        token: res.token,
      });
      return { ok: true };
    }
    
    return { ok: false, error: "Failed" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Login ──────────────────────────────────────────────

export async function login(
  username: string,
  password: string
): Promise<{ ok: boolean; error?: string; requiresOtp?: boolean; userId?: string }> {
  try {
    const res = await apiCall<{
      ok: boolean;
      user?: User;
      token?: string;
      sessionId?: string;
      requiresOtp?: boolean;
      userId?: string;
    }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    
    if (res.requiresOtp && res.userId) {
      return { ok: true, requiresOtp: true, userId: res.userId };
    }
    
    if (res.ok && res.user) {
      saveSession({
        userId: res.user.id,
        username: res.user.username,
        role: res.user.role,
        sessionId: res.sessionId,
        token: res.token,
      });
      return { ok: true };
    }
    
    return { ok: false, error: "Failed" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── OTP Verification ───────────────────────────────────

export async function verifyLoginOtp(
  userId: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiCall<{
      ok: boolean;
      user: User;
      token: string;
      sessionId: string;
    }>(`/api/auth/login/otp?userId=${userId}`, {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    
    if (res.ok && res.user) {
      saveSession({
        userId: res.user.id,
        username: res.user.username,
        role: res.user.role,
        sessionId: res.sessionId,
        token: res.token,
      });
      return { ok: true };
    }
    
    return { ok: false, error: "Failed" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Passkey Login (保留接口，后续实现) ────────────────

export async function loginWithPasskey(
  username: string
): Promise<{ ok: boolean; error?: string; requiresOtp?: boolean; userId?: string }> {
  try {
    // 1. 开始登录流程，获取 challenge
    const beginRes = await apiCall<{ user_id?: string; quick_login?: boolean } & any>(
      "/api/passkey/login/begin",
      {
        method: "POST",
        body: JSON.stringify({ username: username || "" }),
      }
    );

    // 2. 使用 WebAuthn API 获取凭证
    const publicKeyCredentialRequestOptions: any = {
      ...beginRes,
      challenge: Uint8Array.from(atob(beginRes.challenge.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
      allowCredentials: beginRes.allowCredentials?.map((cred: any) => ({
        ...cred,
        id: Uint8Array.from(atob(cred.id.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)),
      })),
    };

    const assertion = await navigator.credentials.get({ publicKey: publicKeyCredentialRequestOptions }) as PublicKeyCredential;

    if (!assertion) {
      return { ok: false, error: "No credential returned" };
    }

    // 3. 将凭证发送到服务器验证
    const credential = {
      id: assertion.id,
      rawId: btoa(String.fromCharCode(...new Uint8Array(assertion.rawId))),
      response: {
        clientDataJSON: btoa(String.fromCharCode(...new Uint8Array((assertion.response as AuthenticatorAssertionResponse).clientDataJSON))),
        authenticatorData: btoa(String.fromCharCode(...new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData))),
        signature: btoa(String.fromCharCode(...new Uint8Array((assertion.response as AuthenticatorAssertionResponse).signature))),
        userHandle: btoa(String.fromCharCode(...new Uint8Array((assertion.response as AuthenticatorAssertionResponse).userHandle || []))),
      },
      type: assertion.type,
    };

    const completeRes = await apiCall<any>(
      "/api/passkey/login/complete",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: beginRes.user_id,
          quick_login: beginRes.quick_login || false,
          credential,
        }),
      }
    );

    if (completeRes.requires_otp) {
      return { ok: true, requiresOtp: true, userId: completeRes.user_id };
    }

    if (completeRes.token && completeRes.user) {
      saveSession({
        userId: completeRes.user.id,
        username: completeRes.user.username,
        role: completeRes.user.role,
        sessionId: completeRes.sessionId,
        token: completeRes.token,
      });
      return { ok: true };
    }

    return { ok: false, error: "Login failed" };
  } catch (err) {
    console.error("Passkey login error:", err);
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Passkey Registration ──────────────────────────────────
export async function beginPasskeyRegistration(): Promise<any> {
  try {
    const res = await apiCall<any>("/api/passkey/register/begin", {
      method: "POST",
    });
    return res;
  } catch (err) {
    console.error("Begin passkey registration error:", err);
    return null;
  }
}

export async function completePasskeyRegistration(credential: any): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiCall("/api/passkey/register/complete", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function deletePasskey(): Promise<{ ok: boolean; error?: string }> {
  try {
    await apiCall("/api/passkey/", {
      method: "DELETE",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── OTP Setup ──────────────────────────────────────────
export async function setupOtp(userId: string): Promise<{ secret: string; uri: string; qr: string } | null> {
  try {
    return await apiCall<{ secret: string; uri: string; qr: string }>("/api/auth/otp/setup", {
      method: "POST",
    });
  } catch (err) {
    console.error("setupOtp error:", err);
    return null;
  }
}

export async function confirmOtpSetup(
  userId: string,
  secret: string,
  code: string
): Promise<{ ok: boolean; recoveryCodes?: string[]; firstSetup?: boolean; error?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; recoveryCodes?: string[]; firstSetup?: boolean }>(
      "/api/auth/otp/confirm",
      {
        method: "POST",
        body: JSON.stringify({ secret, code }),
      }
    );
    return res;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function resetOtp(
  userId: string,
  password?: string,
  code?: string
): Promise<{ ok: boolean; error?: string; secret?: string; uri?: string; qr?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; secret?: string; uri?: string; qr?: string }>(
      "/api/auth/otp/reset",
      {
        method: "POST",
        body: JSON.stringify({ password, code }),
      }
    );
    return res;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Recovery Codes ─────────────────────────────────────

export async function getRecoveryCodes(
  userId: string
): Promise<{ total: number; usedCodes: string[]; available: number } | null> {
  try {
    const res = await apiCall<{
      total: number;
      usedCodes: string[];
      available: number;
    }>("/api/auth/recovery-codes");
    return { total: res.total, usedCodes: res.usedCodes, available: res.available };
  } catch {
    return null;
  }
}

export async function regenerateRecoveryCodes(
  userId: string,
  code: string
): Promise<string[] | null> {
  try {
    const res = await apiCall<{ ok: boolean; recoveryCodes: string[] }>(
      "/api/auth/recovery-codes/regenerate",
      {
        method: "POST",
        body: JSON.stringify({ code }),
      }
    );
    return res.recoveryCodes;
  } catch {
    return null;
  }
}

export async function confirmRecoveryCodesDownloaded(): Promise<boolean> {
  try {
    await apiCall("/api/auth/recovery-codes/confirm-downloaded", {
      method: "POST",
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Sessions ───────────────────────────────────────────

export async function getUserSessions(): Promise<Session[]> {
  try {
    const res = await apiCall<Session[]>("/api/auth/sessions");
    return res;
  } catch {
    return [];
  }
}

export async function revokeSession(sessionId: string): Promise<boolean> {
  try {
    await apiCall(`/api/auth/sessions/${sessionId}/revoke`, { method: "POST" });
    return true;
  } catch {
    return false;
  }
}

export async function revokeAllOtherSessions(
  userId: string,
  currentSessionId: string
): Promise<boolean> {
  try {
    await apiCall("/api/auth/sessions/revoke-others", {
      method: "POST",
      body: JSON.stringify({ current_session_id: currentSessionId }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function cleanRevokedSessions(): Promise<number> {
  try {
    const res = await apiCall<{ deleted: number }>("/api/auth/sessions/clean-revoked", {
      method: "DELETE",
    });
    return res.deleted;
  } catch {
    return 0;
  }
}

// ─── API Keys ───────────────────────────────────────────
export async function createApiKey(
  userId: string,
  name: string,
  expiresInDays: number | null
): Promise<{ key: string; apiKey: ApiKey } | null> {
  try {
    const res = await apiCall<{
      id: string;
      name: string;
      keyPrefix: string;
      created_at: string;
      expires_at?: string;
      last_used?: string;
      revoked: boolean;
      key: string;
    }>("/api/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, expires_in_days: expiresInDays }),
    });
    return {
      key: res.key,
      apiKey: {
        id: res.id,
        name: res.name,
        keyPrefix: res.keyPrefix,
        createdAt: res.created_at,
        expiresAt: res.expires_at,
        lastUsed: res.last_used,
        revoked: res.revoked,
      },
    };
  } catch {
    return null;
  }
}

export async function getUserApiKeys(): Promise<ApiKey[]> {
  try {
    const res = await apiCall<ApiKey[]>("/api/auth/api-keys");
    return res;
  } catch {
    return [];
  }
}

export async function revokeApiKey(keyId: string): Promise<boolean> {
  try {
    await apiCall(`/api/auth/api-keys/${keyId}/revoke`, { method: "POST" });
    return true;
  } catch {
    return false;
  }
}

export async function deleteApiKey(keyId: string): Promise<boolean> {
  try {
    await apiCall(`/api/auth/api-keys/${keyId}`, { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

// ─── Email Binding ───────────────────────────────────────
export async function sendEmailCode(email: string): Promise<{ ok: boolean; message?: string; dev_code?: string; error?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; message: string; dev_code?: string }>(
      "/api/auth/email/send-code",
      {
        method: "POST",
        body: JSON.stringify({ email }),
      }
    );
    return { ok: true, message: res.message, dev_code: res.dev_code };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function verifyEmail(email: string, code: string): Promise<{ ok: boolean; user?: User; error?: string }> {
  try {
    const res = await apiCall<{
      ok: boolean;
      user: { id: string; username: string; role: string; email?: string; email_verified: boolean; otp_enabled: boolean; passkey_enabled: boolean; created_at: string }
    }>(
      "/api/auth/email/verify",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      }
    );
    return {
      ok: true,
      user: {
        id: res.user.id,
        username: res.user.username,
        role: res.user.role,
        email: res.user.email,
        emailVerified: res.user.email_verified,
        otpEnabled: res.user.otp_enabled,
        passkeyEnabled: res.user.passkey_enabled,
        createdAt: res.user.created_at,
      },
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Logout ─────────────────────────────────────────────

export async function logout() {
  const session = getSession();
  if (session?.sessionId) {
    try {
      await apiCall("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore errors
    }
  }
  clearSession();
}

// ─── Export Session Getter ──────────────────────────────

export { getSession };

// ─── Current User ───────────────────────────────────────

export async function getCurrentUser(): Promise<User | null> {
  try {
    const res = await apiCall<{
      id: string;
      username: string;
      role: string;
      email?: string;
      email_verified: boolean;
      otp_enabled: boolean;
      passkey_enabled: boolean;
      created_at: string;
    }>("/api/auth/me");
    
    return {
      id: res.id,
      username: res.username,
      role: res.role,
      email: res.email,
      emailVerified: res.email_verified,
      otpEnabled: res.otp_enabled,
      passkeyEnabled: res.passkey_enabled,
      createdAt: res.created_at,
    };
  } catch {
    return null;
  }
}

// ─── Auth Settings Management ──────────────────────────────
export async function setAuthSettings(
  settings: Partial<AuthSettings>
): Promise<{ ok: boolean; error?: string }> {
  try {
    // 调用后端 API 更新设置
    await apiCall("/api/auth/settings", {
      method: "POST",
      body: JSON.stringify({
        registration_enabled: settings.registrationEnabled,
        passkey_login_enabled: settings.passkeyLoginEnabled,
        otp_required: settings.otpRequired,
      }),
    });
    // 更新本地缓存
    const current = await getAuthSettings();
    localStorage.setItem(
      "bf_auth_settings",
      JSON.stringify({ ...current, ...settings })
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── Password Change ────────────────────────────────────────
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  secondFactorCode?: string
): Promise<{ ok: boolean; error?: string; otpRequired?: boolean }> {
  try {
    await apiCall("/api/auth/password/change", {
      method: "POST",
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
        second_factor_code: secondFactorCode,
      }),
    });
    return { ok: true };
  } catch (err) {
    const errorMsg = (err as Error).message;
    // 如果错误是 "OTP code required"，返回特殊标记
    if (errorMsg.includes("OTP code required")) {
      return { ok: false, error: errorMsg, otpRequired: true };
    }
    return { ok: false, error: errorMsg };
  }
}

// ─── Password Recovery ────────────────────────────────────────
export interface RecoveryMethods {
  has_email: boolean;
  has_otp: boolean;
  has_passkey: boolean;
  has_recovery_codes: boolean;
  has_old_password: boolean;
  required_methods: number;
}

export async function startPasswordRecovery(
  username: string
): Promise<{ ok: boolean; methods?: RecoveryMethods; error?: string }> {
  try {
    const res = await apiCall<RecoveryMethods>("/api/auth/recovery/start", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    return { ok: true, methods: res };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendRecoveryEmailCode(
  username: string
): Promise<{ ok: boolean; dev_code?: string; message?: string; error?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; dev_code?: string; message: string }>(
      "/api/auth/recovery/send-email-code",
      {
        method: "POST",
        body: JSON.stringify({ username }),
      }
    );
    return { ok: true, dev_code: res.dev_code, message: res.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function verifyPasswordRecovery(data: {
  username: string;
  verification_methods: string[];
  email_code?: string;
  otp_code?: string;
  recovery_code?: string;
  old_password?: string;
}): Promise<{ ok: boolean; verification_token?: string; verified_methods?: string[]; error?: string }> {
  try {
    const res = await apiCall<{
      ok: boolean;
      verification_token: string;
      verified_methods: string[];
    }>("/api/auth/recovery/verify", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return { ok: true, verification_token: res.verification_token, verified_methods: res.verified_methods };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function startRecoveryOtpReset(
  username: string,
  verificationToken: string
): Promise<{ ok: boolean; secret?: string; uri?: string; qr?: string; error?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; secret: string; uri: string; qr: string }>(
      "/api/auth/recovery/reset-otp",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          verification_token: verificationToken,
        }),
      }
    );
    return { ok: true, secret: res.secret, uri: res.uri, qr: res.qr };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function confirmRecoveryOtpReset(
  username: string,
  verificationToken: string,
  secret: string,
  code: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await apiCall<{ ok: boolean; message: string }>(
      "/api/auth/recovery/confirm-otp",
      {
        method: "POST",
        body: JSON.stringify({
          username,
          verification_token: verificationToken,
          secret,
          code,
        }),
      }
    );
    return { ok: true, message: res.message };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function resetPassword(
  username: string,
  newPassword: string,
  verificationToken: string
): Promise<{ ok: boolean; message?: string; error?: string; otp_reset_required?: boolean }> {
  try {
    const res = await apiCall<{ ok: boolean; message: string; otp_reset_required?: boolean }>("/api/auth/recovery/reset", {
      method: "POST",
      body: JSON.stringify({
        username,
        new_password: newPassword,
        verification_token: verificationToken,
      }),
    });
    return { ok: true, message: res.message, otp_reset_required: res.otp_reset_required };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
