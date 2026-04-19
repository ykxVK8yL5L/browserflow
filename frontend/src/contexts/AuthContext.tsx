import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { getSession, login as doLogin, register as doRegister, logout as doLogout } from "@/lib/authStore";

interface StoredSession {
  userId: string;
  username: string;
  role: string;
  sessionId: string;
  token: string;
}

interface AuthCtx {
  user: StoredSession | null;
  login: (u: string, p: string) => Promise<{ ok: boolean; error?: string; requiresOtp?: boolean; userId?: string }>;
  register: (u: string, p: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<StoredSession | null>(getSession());

  // 监听 storage 变化（多标签页同步）
  useEffect(() => {
    const handleStorageChange = () => {
      setUser(getSession());
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const login = useCallback(async (u: string, p: string) => {
    const res = await doLogin(u, p);
    if (res.ok && !res.requiresOtp) setUser(getSession());
    return res;
  }, []);

  const register = useCallback(async (u: string, p: string) => {
    const res = await doRegister(u, p);
    if (res.ok) setUser(getSession());
    return res;
  }, []);

  const logout = useCallback(() => {
    doLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
